import { createHash, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { config } from "../../config.js";
import { calculateOrderTotal, calculatePercentageDiscount } from "../../domain/commerce/money.js";
import { transaction } from "../../db/pool.js";
import { AppError } from "../../http/errors.js";
import { enqueueDomainEvent } from "../events/outbox.js";

type CheckoutItemRow = {
  product_id: string;
  product_stock: number;
  seller_approval_status: string | null;
  seller_id: string;
  title: string;
  unit_price_cents: number;
  quantity: number;
  variant_id: string | null;
  variant_stock: number | null;
};

type CouponRow = {
  discount_type: "FIXED" | "PERCENTAGE";
  discount_value: number;
  expires_at: Date | null;
  id: string;
  minimum_order_cents: number;
  scope: "PLATFORM" | "SELLER";
  seller_id: string | null;
  starts_at: Date;
  usage_count: number;
  usage_limit: number | null;
};

export type CheckoutResult = {
  order: {
    id: string;
    number: string;
    paymentStatus: string;
    status: string;
    totalCents: number;
  };
};

function requestFingerprint(input: Omit<CheckoutInput, "userId">): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function newOrderNumber(): string {
  return `EH-${new Date().getUTCFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
}

async function loadCoupon(
  client: PoolClient,
  couponCode: string | undefined,
  sellerId: string,
  subtotalCents: number,
): Promise<{ coupon: CouponRow | null; discountCents: number }> {
  if (!couponCode) {
    return { coupon: null, discountCents: 0 };
  }
  const result = await client.query<CouponRow>(
    `SELECT id, scope, seller_id, discount_type, discount_value, minimum_order_cents,
            usage_limit, usage_count, starts_at, expires_at
       FROM coupons
      WHERE upper(code) = upper($1)
        AND active = true
      FOR UPDATE`,
    [couponCode],
  );
  const coupon = result.rows[0];
  const now = new Date();
  if (
    !coupon ||
    coupon.starts_at > now ||
    (coupon.expires_at && coupon.expires_at <= now) ||
    subtotalCents < coupon.minimum_order_cents ||
    (coupon.usage_limit !== null && coupon.usage_count >= coupon.usage_limit) ||
    (coupon.scope === "SELLER" && coupon.seller_id !== sellerId)
  ) {
    throw new AppError(409, "COUPON_INVALID");
  }
  const rawDiscount = coupon.discount_type === "PERCENTAGE"
    ? calculatePercentageDiscount(subtotalCents, coupon.discount_value)
    : coupon.discount_value;
  return { coupon, discountCents: Math.min(rawDiscount, subtotalCents) };
}

async function findReplay(
  client: PoolClient,
  userId: string,
  idempotencyKey: string,
  fingerprint: string,
): Promise<CheckoutResult | null> {
  const existing = await client.query<{ request_hash: string | null; response_body: CheckoutResult }>(
    `SELECT request_hash, response_body
       FROM idempotency_records
      WHERE user_id = $1 AND operation = 'CHECKOUT' AND idempotency_key = $2
      FOR UPDATE`,
    [userId, idempotencyKey],
  );
  const record = existing.rows[0];
  if (!record) {
    return null;
  }
  if (record.request_hash !== fingerprint) {
    throw new AppError(409, "IDEMPOTENCY_CONFLICT");
  }
  return record.response_body;
}

export type CheckoutInput = {
  addressId: string;
  couponCode?: string | undefined;
  idempotencyKey: string;
  paymentMethod: "PIX" | "CREDIT_CARD" | "BOLETO";
  userId: string;
};

export async function createCheckout(input: CheckoutInput): Promise<{ replayed: boolean; result: CheckoutResult }> {
  const shippingCents = config.shipping.fixedCents;
  if (shippingCents === undefined || config.payments.commissionBasisPoints === undefined) {
    throw new AppError(503, "CHECKOUT_UNAVAILABLE");
  }
  if (config.payments.provider !== "mercado_pago" && config.payments.provider !== "stripe") {
    throw new AppError(503, "PAYMENT_CONFIGURATION_UNAVAILABLE");
  }
  const fingerprint = requestFingerprint({
    addressId: input.addressId,
    couponCode: input.couponCode,
    idempotencyKey: input.idempotencyKey,
    paymentMethod: input.paymentMethod,
  });
  return transaction(async (client) => {
    const replay = await findReplay(client, input.userId, input.idempotencyKey, fingerprint);
    if (replay) {
      return { replayed: true, result: replay };
    }
    const address = await client.query<{ id: string }>(
      "SELECT id FROM addresses WHERE id = $1 AND user_id = $2 FOR KEY SHARE",
      [input.addressId, input.userId],
    );
    if (!address.rows[0]) {
      throw new AppError(404, "NOT_FOUND");
    }
    const cart = await client.query<{ id: string }>(
      `SELECT id FROM carts
        WHERE user_id = $1 AND status = 'ACTIVE'
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [input.userId],
    );
    const cartId = cart.rows[0]?.id;
    if (!cartId) {
      throw new AppError(409, "CHECKOUT_UNAVAILABLE");
    }
    const items = await client.query<CheckoutItemRow>(
      `SELECT cart_items.product_id, cart_items.variant_id, cart_items.quantity,
              products.seller_id, products.title, products.price_cents AS unit_price_cents,
              products.stock_quantity AS product_stock,
              product_variants.stock_quantity AS variant_stock,
              seller_profiles.approval_status AS seller_approval_status
         FROM cart_items
         JOIN products ON products.id = cart_items.product_id
         LEFT JOIN product_variants ON product_variants.id = cart_items.variant_id
         JOIN seller_profiles ON seller_profiles.user_id = products.seller_id
        WHERE cart_items.cart_id = $1
          AND products.status = 'ACTIVE'
          AND products.deleted_at IS NULL
        FOR UPDATE OF cart_items, products`,
      [cartId],
    );
    if (items.rows.length === 0) {
      throw new AppError(409, "CHECKOUT_UNAVAILABLE");
    }
    const firstItem = items.rows[0];
    if (!firstItem) {
      throw new AppError(409, "CHECKOUT_UNAVAILABLE");
    }
    const sellerId = firstItem.seller_id;
    if (items.rows.some((item) => item.seller_id !== sellerId)) {
      throw new AppError(409, "CONFLICT");
    }
    if (items.rows.some((item) => item.seller_approval_status !== "APPROVED")) {
      throw new AppError(409, "FORBIDDEN");
    }
    if (items.rows.some((item) => item.quantity > (item.variant_stock ?? item.product_stock))) {
      throw new AppError(409, "INVENTORY_UNAVAILABLE");
    }
    const subtotalCents = items.rows.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0);
    const { coupon, discountCents } = await loadCoupon(client, input.couponCode, sellerId, subtotalCents);
    const totalCents = calculateOrderTotal(subtotalCents, shippingCents, discountCents);
    const orderNumber = newOrderNumber();
    const createdOrder = await client.query<{ id: string }>(
      `INSERT INTO orders(order_number, buyer_id, seller_id, address_id, status, payment_status,
                          subtotal_cents, shipping_cents, discount_cents, total_cents, coupon_id)
       VALUES ($1, $2, $3, $4, 'PENDING_PAYMENT', 'PENDING', $5, $6, $7, $8, $9)
       RETURNING id`,
      [orderNumber, input.userId, sellerId, input.addressId, subtotalCents, shippingCents, discountCents, totalCents, coupon?.id ?? null],
    );
    const order = createdOrder.rows[0];
    if (!order) {
      throw new AppError(503, "BACKEND_UNAVAILABLE");
    }
    const orderId = order.id;
    await client.query(
      `INSERT INTO order_status_history(order_id, from_status, to_status, actor_user_id, reason)
       VALUES ($1, NULL, 'CREATED', $2, 'Pedido iniciado no checkout'),
              ($1, 'CREATED', 'PENDING_PAYMENT', $2, 'Aguardando confirmação do pagamento')`,
      [orderId, input.userId],
    );
    for (const item of items.rows) {
      if (item.variant_id) {
        const updated = await client.query<{ id: string }>(
          `UPDATE product_variants
              SET stock_quantity = stock_quantity - $2, updated_at = now()
            WHERE id = $1 AND stock_quantity >= $2
            RETURNING id`,
          [item.variant_id, item.quantity],
        );
        if (!updated.rows[0]) {
          throw new AppError(409, "INVENTORY_UNAVAILABLE");
        }
      } else {
        const updated = await client.query<{ id: string }>(
          `UPDATE products
              SET stock_quantity = stock_quantity - $2, updated_at = now()
            WHERE id = $1 AND stock_quantity >= $2
            RETURNING id`,
          [item.product_id, item.quantity],
        );
        if (!updated.rows[0]) {
          throw new AppError(409, "INVENTORY_UNAVAILABLE");
        }
      }
      await client.query(
        `INSERT INTO order_items(order_id, product_id, variant_id, title_snapshot, unit_price_cents, quantity)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, item.product_id, item.variant_id, item.title, item.unit_price_cents, item.quantity],
      );
      await client.query(
        `INSERT INTO inventory_movements(product_id, variant_id, delta, reason, actor_user_id, order_id)
         VALUES ($1, $2, $3, 'CHECKOUT_RESERVED', $4, $5)`,
        [item.product_id, item.variant_id, -item.quantity, input.userId, orderId],
      );
      await client.query(
        `INSERT INTO inventory_reservations(order_id, product_id, variant_id, quantity, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '30 minutes')`,
        [orderId, item.product_id, item.variant_id, item.quantity],
      );
    }
    if (coupon) {
      await client.query("UPDATE coupons SET usage_count = usage_count + 1, updated_at = now() WHERE id = $1", [coupon.id]);
      await client.query(
        `INSERT INTO coupon_redemptions(coupon_id, user_id, order_id, discount_cents)
         VALUES ($1, $2, $3, $4)`,
        [coupon.id, input.userId, orderId, discountCents],
      );
    }
    await client.query("UPDATE carts SET status = 'CHECKED_OUT', updated_at = now() WHERE id = $1", [cartId]);
    await client.query(
      `INSERT INTO audit_events(actor_user_id, action, target_type, target_id, metadata)
       VALUES ($1, 'ORDER_CREATED', 'ORDER', $2, jsonb_build_object('orderNumber', $3))`,
      [input.userId, orderId, orderNumber],
    );
    await enqueueDomainEvent(client, {
      aggregateId: orderId,
      aggregateType: "ORDER",
      eventType: "OrderCreated",
      idempotencyKey: input.idempotencyKey,
      payload: { buyerId: input.userId, orderId, sellerId, totalCents },
    });
    await enqueueDomainEvent(client, {
      aggregateId: orderId,
      aggregateType: "ORDER",
      eventType: "PaymentRequested",
      idempotencyKey: input.idempotencyKey,
      payload: { orderId, paymentMethod: input.paymentMethod, totalCents },
    });
    await enqueueDomainEvent(client, {
      aggregateId: orderId,
      aggregateType: "ORDER",
      eventType: "NotificationRequested",
      idempotencyKey: input.idempotencyKey,
      payload: { orderId, recipientUserId: input.userId, template: "ORDER_CREATED" },
    });
    const result: CheckoutResult = {
      order: { id: orderId, number: orderNumber, paymentStatus: "PENDING", status: "PENDING_PAYMENT", totalCents },
    };
    await client.query(
      `INSERT INTO idempotency_records(user_id, operation, idempotency_key, request_hash, response_status, response_body)
       VALUES ($1, 'CHECKOUT', $2, $3, 201, $4::jsonb)`,
      [input.userId, input.idempotencyKey, fingerprint, JSON.stringify(result)],
    );
    return { replayed: false, result };
  });
}
