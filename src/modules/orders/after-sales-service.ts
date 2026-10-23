import type { PoolClient } from "pg";

import type { SessionUser } from "../../domain/auth/session.js";
import { AppError } from "../../http/errors.js";
import { transaction, query } from "../../db/pool.js";
import { enqueueDomainEvent } from "../events/outbox.js";

async function restockAfterSalesOrder(client: PoolClient, input: { actorUserId: string; orderId: string }) {
  const orderItems = await client.query<{ product_id: string; quantity: number; variant_id: string | null }>(
    "SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1 FOR UPDATE",
    [input.orderId],
  );
  for (const item of orderItems.rows) {
    const updated = item.variant_id
      ? await client.query("UPDATE product_variants SET stock_quantity = stock_quantity + $2, updated_at = now() WHERE id = $1", [item.variant_id, item.quantity])
      : await client.query("UPDATE products SET stock_quantity = stock_quantity + $2, updated_at = now() WHERE id = $1", [item.product_id, item.quantity]);
    if (updated.rowCount !== 1) throw new AppError(503, "BACKEND_UNAVAILABLE");
    await client.query(
      `INSERT INTO inventory_movements(product_id, variant_id, delta, reason, actor_user_id, order_id)
       VALUES ($1, $2, $3, 'AFTER_SALES_RESTOCK', $4, $5)`,
      [item.product_id, item.variant_id, item.quantity, input.actorUserId, input.orderId],
    );
  }
  await client.query(
    "UPDATE inventory_reservations SET status = 'RELEASED', released_at = now() WHERE order_id = $1 AND status = 'CONFIRMED'",
    [input.orderId],
  );
  const redemptions = await client.query<{ coupon_id: string }>(
    "DELETE FROM coupon_redemptions WHERE order_id = $1 RETURNING coupon_id",
    [input.orderId],
  );
  for (const redemption of redemptions.rows) {
    await client.query("UPDATE coupons SET usage_count = GREATEST(usage_count - 1, 0), updated_at = now() WHERE id = $1", [redemption.coupon_id]);
  }
  await enqueueDomainEvent(client, {
    aggregateId: input.orderId,
    aggregateType: "ORDER",
    eventType: "InventoryUpdated",
    payload: { orderId: input.orderId, reason: "AFTER_SALES_RESTOCK" },
  });
}

export const afterSalesStatuses = ["PENDING", "APPROVED", "REJECTED", "RECEIVED", "REFUND_PENDING", "REFUNDED", "CANCELLED"] as const;
export const afterSalesTypes = ["CANCELLATION", "RETURN"] as const;

export type AfterSalesStatus = (typeof afterSalesStatuses)[number];
export type AfterSalesType = (typeof afterSalesTypes)[number];

type OrderForAfterSales = {
  buyer_id: string;
  id: string;
  order_number: string;
  payment_status: string;
  seller_id: string;
  status: string;
};

type RequestRow = {
  buyer_id: string;
  buyer_name: string;
  created_at: Date;
  id: string;
  order_id: string;
  order_number: string;
  reason: string;
  request_type: AfterSalesType;
  reviewed_at: Date | null;
  seller_id: string;
  seller_name: string;
  seller_note: string | null;
  status: AfterSalesStatus;
  updated_at: Date;
};

function isOperationsUser(user: SessionUser): boolean {
  return user.roles.includes("ADMIN") || user.roles.includes("SUPPORT");
}

function canRequest(order: OrderForAfterSales, requestType: AfterSalesType): boolean {
  if (requestType === "RETURN") return order.status === "DELIVERED";
  return ["PAID", "PROCESSING"].includes(order.status) && order.payment_status === "APPROVED";
}

export function canTransitionAfterSales(
  actor: "BUYER" | "OPERATIONS" | "SELLER",
  current: AfterSalesStatus,
  target: AfterSalesStatus,
  requestType: AfterSalesType,
): boolean {
  if (actor === "OPERATIONS") {
    return (current === "PENDING" && ["APPROVED", "REJECTED"].includes(target))
      || (current === "APPROVED" && requestType === "CANCELLATION" && target === "REFUND_PENDING")
      || (current === "RECEIVED" && requestType === "RETURN" && target === "REFUND_PENDING");
  }
  if (actor === "SELLER") return requestType === "RETURN" && current === "APPROVED" && target === "RECEIVED";
  return current === "PENDING" && target === "CANCELLED";
}

function mapRequest(row: RequestRow) {
  return {
    buyerName: row.buyer_name,
    createdAt: row.created_at.toISOString(),
    id: row.id,
    orderId: row.order_id,
    orderNumber: row.order_number,
    reason: row.reason,
    requestType: row.request_type,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    sellerName: row.seller_name,
    sellerNote: row.seller_note,
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
  };
}

async function orderForRequest(client: PoolClient, orderId: string): Promise<OrderForAfterSales> {
  const result = await client.query<OrderForAfterSales>(
    `SELECT id, order_number, buyer_id, seller_id, status, payment_status
       FROM orders WHERE id = $1 FOR UPDATE`,
    [orderId],
  );
  const order = result.rows[0];
  if (!order) throw new AppError(404, "NOT_FOUND");
  return order;
}

export async function createAfterSalesRequest(input: { orderId: string; reason: string; requestType: AfterSalesType; user: SessionUser }) {
  return transaction(async (client) => {
    const order = await orderForRequest(client, input.orderId);
    if (order.buyer_id !== input.user.id || !canRequest(order, input.requestType)) {
      throw new AppError(409, "CONFLICT");
    }
    const created = await client.query<{ id: string }>(
      `INSERT INTO after_sales_requests(order_id, buyer_id, seller_id, request_type, reason)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [order.id, order.buyer_id, order.seller_id, input.requestType, input.reason],
    );
    const request = created.rows[0];
    if (!request) throw new AppError(409, "CONFLICT");
    await client.query(
      `INSERT INTO after_sales_status_history(after_sales_request_id, to_status, actor_user_id, note)
       VALUES ($1, 'PENDING', $2, $3)`,
      [request.id, input.user.id, input.reason],
    );
    await client.query(
      `INSERT INTO audit_events(actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1, 'AFTER_SALES_REQUEST_CREATED', 'AFTER_SALES_REQUEST', $2,
               jsonb_build_object('orderId', $3::text, 'type', $4::text))`,
      [input.user.id, request.id, order.id, input.requestType],
    );
    await enqueueDomainEvent(client, {
      aggregateId: request.id,
      aggregateType: "AFTER_SALES_REQUEST",
      eventType: "NotificationRequested",
      payload: { afterSalesRequestId: request.id, orderId: order.id, recipientUserId: order.seller_id, template: "AFTER_SALES_REQUEST_CREATED" },
    });
    return { id: request.id, status: "PENDING" as const };
  });
}

export async function listAfterSalesRequests(input: { limit: number; scope: "mine" | "received" | "queue"; user: SessionUser }) {
  if (input.scope === "received" && !input.user.roles.includes("SELLER") && !isOperationsUser(input.user)) throw new AppError(403, "FORBIDDEN");
  if (input.scope === "queue" && !isOperationsUser(input.user)) throw new AppError(403, "FORBIDDEN");
  const condition = input.scope === "mine" ? "requests.buyer_id = $1"
    : input.scope === "received" ? "requests.seller_id = $1"
      : "requests.status IN ('PENDING', 'APPROVED', 'RECEIVED', 'REFUND_PENDING')";
  const values: unknown[] = input.scope === "queue" ? [input.limit] : [input.user.id, input.limit];
  const limitPlaceholder = input.scope === "queue" ? "$1" : "$2";
  const result = await query<RequestRow>(
    `SELECT requests.id, requests.order_id, requests.buyer_id, requests.seller_id, requests.request_type, requests.status,
            requests.reason, requests.seller_note, requests.reviewed_at, requests.created_at, requests.updated_at,
            orders.order_number, buyers.full_name AS buyer_name, sellers.store_name AS seller_name
       FROM after_sales_requests requests
       JOIN orders ON orders.id = requests.order_id
       JOIN users buyers ON buyers.id = requests.buyer_id AND buyers.deleted_at IS NULL
       JOIN seller_profiles sellers ON sellers.user_id = requests.seller_id
      WHERE ${condition}
      ORDER BY requests.created_at DESC
      LIMIT ${limitPlaceholder}`,
    values,
  );
  return result.rows.map(mapRequest);
}

export async function transitionAfterSalesRequest(input: { id: string; note?: string | undefined; status: AfterSalesStatus; user: SessionUser }) {
  return transaction(async (client) => {
    const result = await client.query<RequestRow>(
      `SELECT requests.id, requests.order_id, requests.buyer_id, requests.seller_id, requests.request_type, requests.status,
              requests.reason, requests.seller_note, requests.reviewed_at, requests.created_at, requests.updated_at,
              orders.order_number, buyers.full_name AS buyer_name, sellers.store_name AS seller_name
         FROM after_sales_requests requests
         JOIN orders ON orders.id = requests.order_id
         JOIN users buyers ON buyers.id = requests.buyer_id AND buyers.deleted_at IS NULL
         JOIN seller_profiles sellers ON sellers.user_id = requests.seller_id
        WHERE requests.id = $1
        FOR UPDATE`,
      [input.id],
    );
    const request = result.rows[0];
    if (!request) throw new AppError(404, "NOT_FOUND");
    const actor = isOperationsUser(input.user) ? "OPERATIONS" : request.seller_id === input.user.id && input.user.roles.includes("SELLER") ? "SELLER" : request.buyer_id === input.user.id ? "BUYER" : null;
    if (!actor || !canTransitionAfterSales(actor, request.status, input.status, request.request_type)) throw new AppError(409, "CONFLICT");
    const updated = await client.query<RequestRow>(
      `UPDATE after_sales_requests
          SET status = $2,
              seller_note = CASE WHEN $3::text = 'SELLER' THEN $4 ELSE seller_note END,
              reviewed_by = CASE WHEN $3::text = 'OPERATIONS' THEN $5 ELSE reviewed_by END,
              reviewed_at = CASE WHEN $3::text = 'OPERATIONS' THEN now() ELSE reviewed_at END,
              updated_at = now()
        WHERE id = $1
        RETURNING id, order_id, buyer_id, seller_id, request_type, status, reason, seller_note, reviewed_at, created_at, updated_at`,
      [request.id, input.status, actor, input.note ?? null, input.user.id],
    );
    const value = updated.rows[0];
    if (!value) throw new AppError(503, "BACKEND_UNAVAILABLE");
    await client.query(
      `INSERT INTO after_sales_status_history(after_sales_request_id, from_status, to_status, actor_user_id, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [request.id, request.status, input.status, input.user.id, input.note ?? null],
    );
    await client.query(
      `INSERT INTO audit_events(actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1, 'AFTER_SALES_STATUS_CHANGED', 'AFTER_SALES_REQUEST', $2,
               jsonb_build_object('from', $3::text, 'to', $4::text, 'orderId', $5::text))`,
      [input.user.id, request.id, request.status, input.status, request.order_id],
    );
    if (input.status === "REFUND_PENDING") {
      await restockAfterSalesOrder(client, { actorUserId: input.user.id, orderId: request.order_id });
    }
    await enqueueDomainEvent(client, {
      aggregateId: request.id,
      aggregateType: "AFTER_SALES_REQUEST",
      eventType: "NotificationRequested",
      payload: { afterSalesRequestId: request.id, orderId: request.order_id, recipientUserId: request.buyer_id, template: "AFTER_SALES_STATUS_CHANGED", toStatus: input.status },
    });
    return { id: request.id, status: input.status };
  });
}
