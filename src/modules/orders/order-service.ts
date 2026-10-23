import type { PoolClient } from "pg";

import { transaction, query } from "../../db/pool.js";
import { canTransitionOrder, type OrderStatus } from "../../domain/orders/order-status.js";
import type { Role, SessionUser } from "../../domain/auth/session.js";
import { AppError } from "../../http/errors.js";
import { enqueueDomainEvent } from "../events/outbox.js";
import { releasePendingOrderResources } from "../inventory/reservation-service.js";

type OrderRow = {
  buyer_id: string;
  created_at: Date;
  delivered_at: Date | null;
  id: string;
  order_number: string;
  payment_status: string;
  seller_id: string;
  shipped_at: Date | null;
  shipping_carrier: string | null;
  shipping_cents: number;
  shipping_estimated_max_business_days: number | null;
  shipping_estimated_min_business_days: number | null;
  shipping_service: string;
  status: OrderStatus;
  total_cents: number;
  tracking_code: string | null;
};

type ShipmentInput = { carrier: string; trackingCode: string };

function isElevated(user: SessionUser): boolean {
  return user.roles.includes("ADMIN") || user.roles.includes("SUPPORT");
}

export async function listOrders(input: { limit: number; offset: number; scope: "mine" | "received"; user: SessionUser }) {
  if (input.scope === "received" && !input.user.roles.includes("SELLER") && !isElevated(input.user)) {
    throw new AppError(403, "FORBIDDEN");
  }
  const condition = input.scope === "received" ? "orders.seller_id = $1" : "orders.buyer_id = $1";
  const result = await query<OrderRow>(
    `SELECT id, order_number, buyer_id, seller_id, status, payment_status, total_cents, created_at,
            shipping_cents, shipping_service, shipping_estimated_min_business_days, shipping_estimated_max_business_days,
            shipping_carrier, tracking_code, shipped_at, delivered_at
       FROM orders
      WHERE ${condition}
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [input.user.id, input.limit, input.offset],
  );
  return result.rows.map((order) => ({
    createdAt: order.created_at.toISOString(),
    id: order.id,
    number: order.order_number,
    paymentStatus: order.payment_status,
    shipping: {
      amountCents: order.shipping_cents,
      carrier: order.shipping_carrier,
      deliveredAt: order.delivered_at?.toISOString() ?? null,
      estimatedMaxBusinessDays: order.shipping_estimated_max_business_days,
      estimatedMinBusinessDays: order.shipping_estimated_min_business_days,
      service: order.shipping_service,
      shippedAt: order.shipped_at?.toISOString() ?? null,
      trackingCode: order.tracking_code,
    },
    status: order.status,
    totalCents: order.total_cents,
  }));
}

export async function getOrder(user: SessionUser, orderId: string) {
  const result = await query<OrderRow>(
    `SELECT id, order_number, buyer_id, seller_id, status, payment_status, total_cents, created_at,
            shipping_cents, shipping_service, shipping_estimated_min_business_days, shipping_estimated_max_business_days,
            shipping_carrier, tracking_code, shipped_at, delivered_at
       FROM orders WHERE id = $1`,
    [orderId],
  );
  const order = result.rows[0];
  if (!order) {
    throw new AppError(404, "NOT_FOUND");
  }
  if (!isElevated(user) && order.buyer_id !== user.id && order.seller_id !== user.id) {
    throw new AppError(403, "FORBIDDEN");
  }
  const items = await query<{
    quantity: number;
    title_snapshot: string;
    unit_price_cents: number;
  }>(
    "SELECT title_snapshot, unit_price_cents, quantity FROM order_items WHERE order_id = $1 ORDER BY created_at ASC",
    [orderId],
  );
  const history = await query<{
    created_at: Date;
    from_status: string | null;
    reason: string | null;
    to_status: string;
  }>(
    `SELECT from_status, to_status, reason, created_at
       FROM order_status_history
      WHERE order_id = $1
      ORDER BY created_at ASC`,
    [orderId],
  );
  return {
    createdAt: order.created_at.toISOString(),
    id: order.id,
    items: items.rows.map((item) => ({ quantity: item.quantity, title: item.title_snapshot, unitPriceCents: item.unit_price_cents })),
    number: order.order_number,
    paymentStatus: order.payment_status,
    shipping: {
      amountCents: order.shipping_cents,
      carrier: order.shipping_carrier,
      deliveredAt: order.delivered_at?.toISOString() ?? null,
      estimatedMaxBusinessDays: order.shipping_estimated_max_business_days,
      estimatedMinBusinessDays: order.shipping_estimated_min_business_days,
      service: order.shipping_service,
      shippedAt: order.shipped_at?.toISOString() ?? null,
      trackingCode: order.tracking_code,
    },
    status: order.status,
    statusHistory: history.rows.map((entry) => ({
      createdAt: entry.created_at.toISOString(),
      fromStatus: entry.from_status,
      reason: entry.reason,
      toStatus: entry.to_status,
    })),
    totalCents: order.total_cents,
  };
}

function canActorSetStatus(user: SessionUser, order: OrderRow, target: OrderStatus): boolean {
  if (isElevated(user)) {
    return !["PAID", "FAILED", "REFUNDED"].includes(target);
  }
  if (order.seller_id === user.id && user.roles.includes("SELLER")) {
    return ["PROCESSING", "SHIPPED", "DELIVERED"].includes(target);
  }
  return order.buyer_id === user.id && target === "CANCELLED";
}

export async function transitionOrderStatus(input: {
  orderId: string;
  reason?: string | undefined;
  shipment?: ShipmentInput | undefined;
  targetStatus: OrderStatus;
  user: SessionUser;
}): Promise<{ status: OrderStatus }> {
  return transaction(async (client: PoolClient) => {
    const result = await client.query<OrderRow>(
      `SELECT id, order_number, buyer_id, seller_id, status, payment_status, total_cents, created_at,
              shipping_cents, shipping_service, shipping_estimated_min_business_days, shipping_estimated_max_business_days,
              shipping_carrier, tracking_code, shipped_at, delivered_at
         FROM orders WHERE id = $1 FOR UPDATE`,
      [input.orderId],
    );
    const order = result.rows[0];
    if (!order) {
      throw new AppError(404, "NOT_FOUND");
    }
    if (!canActorSetStatus(input.user, order, input.targetStatus) || !canTransitionOrder(order.status, input.targetStatus)) {
      throw new AppError(409, "CONFLICT");
    }
    if (input.targetStatus === "CANCELLED" && (order.status !== "PENDING_PAYMENT" || order.payment_status !== "PENDING")) {
      throw new AppError(409, "CONFLICT");
    }
    if (input.targetStatus === "SHIPPED") {
      if (!input.shipment) {
        throw new AppError(400, "INVALID_REQUEST");
      }
      const openCancellation = await client.query<{ id: string }>(
        `SELECT id FROM after_sales_requests
          WHERE order_id = $1 AND request_type = 'CANCELLATION'
            AND status IN ('PENDING', 'APPROVED', 'REFUND_PENDING')
          LIMIT 1`,
        [order.id],
      );
      if (openCancellation.rows[0]) {
        throw new AppError(409, "CONFLICT");
      }
      await client.query(
        `UPDATE orders
            SET status = $2, shipping_carrier = $3, tracking_code = $4, shipped_at = now(), updated_at = now()
          WHERE id = $1`,
        [order.id, input.targetStatus, input.shipment.carrier, input.shipment.trackingCode],
      );
    } else {
      if (input.shipment) {
        throw new AppError(400, "INVALID_REQUEST");
      }
      await client.query(
        `UPDATE orders
            SET status = $2::varchar,
                delivered_at = CASE WHEN $2::varchar = 'DELIVERED'::varchar THEN now() ELSE delivered_at END,
                updated_at = now()
          WHERE id = $1`,
        [order.id, input.targetStatus],
      );
    }
    await client.query(
      `INSERT INTO order_status_history(order_id, from_status, to_status, actor_user_id, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [order.id, order.status, input.targetStatus, input.user.id, input.reason ?? null],
    );
    await client.query(
      `INSERT INTO audit_events(actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1, 'ORDER_STATUS_CHANGED', 'ORDER', $2, jsonb_build_object('from', $3::text, 'to', $4::text))`,
      [input.user.id, order.id, order.status, input.targetStatus],
    );
    if (input.targetStatus === "CANCELLED") {
      const released = await releasePendingOrderResources(client, order.id);
      if (released) {
        await enqueueDomainEvent(client, {
          aggregateId: order.id,
          aggregateType: "ORDER",
          eventType: "InventoryUpdated",
          payload: { orderId: order.id, reason: "ORDER_CANCELLED" },
        });
      }
    }
    await enqueueDomainEvent(client, {
      aggregateId: order.id,
      aggregateType: "ORDER",
      eventType: "NotificationRequested",
      payload: { orderId: order.id, recipientUserId: order.buyer_id, template: "ORDER_STATUS_CHANGED", toStatus: input.targetStatus },
    });
    return { status: input.targetStatus };
  });
}

export function canReadOrderWithRole(role: Role): boolean {
  return ["CUSTOMER", "SELLER", "ADMIN", "SUPPORT"].includes(role);
}
