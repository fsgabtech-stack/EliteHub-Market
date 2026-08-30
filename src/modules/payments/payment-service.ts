import { createHash, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { config } from "../../config.js";
import { calculatePercentageDiscount } from "../../domain/commerce/money.js";
import { transaction } from "../../db/pool.js";
import { AppError } from "../../http/errors.js";
import { enqueueDomainEvent } from "../events/outbox.js";
import {
  createProviderPayment,
  configuredPaymentProvider,
  type PaymentMethod,
  type PaymentProvider,
  verifyProviderPayment,
  type VerifiedPaymentStatus,
} from "./payment-gateway.js";
import { releasePendingOrderResources } from "../inventory/reservation-service.js";

function paymentProviderToConfigValue(provider: PaymentProvider): "mercado_pago" | "stripe" {
  return provider === "MERCADO_PAGO" ? "mercado_pago" : "stripe";
}

export async function requestPaymentForOrder(input: { orderId: string; paymentMethod: PaymentMethod }): Promise<void> {
  const order = await transaction(async (client) => {
    const result = await client.query<{
      buyer_email: string;
      id: string;
      idempotency_key: string | null;
      order_number: string;
      payment_status: string;
      payment_transaction_id: string | null;
      provider: PaymentProvider | null;
      provider_reference: string | null;
      status: string;
      total_cents: number;
      transaction_payment_method: PaymentMethod | null;
    }>(
      `SELECT orders.id, orders.order_number, orders.total_cents, orders.status, orders.payment_status, users.email AS buyer_email,
              payment_transactions.id AS payment_transaction_id, payment_transactions.provider,
              payment_transactions.payment_method AS transaction_payment_method,
              payment_transactions.provider_reference, payment_transactions.idempotency_key
         FROM orders
         JOIN users ON users.id = orders.buyer_id
         LEFT JOIN payment_transactions ON payment_transactions.order_id = orders.id
        WHERE orders.id = $1
        FOR UPDATE OF orders, payment_transactions`,
      [input.orderId],
    );
    const value = result.rows[0];
    if (!value || value.status !== "PENDING_PAYMENT" || !["PENDING", "PROCESSING"].includes(value.payment_status)) {
      return null;
    }
    if (value.payment_transaction_id) {
      if (value.transaction_payment_method !== input.paymentMethod || !value.provider || !value.idempotency_key) {
        throw new AppError(409, "CONFLICT");
      }
      return {
        ...value,
        idempotencyKey: value.idempotency_key,
        paymentTransactionId: value.payment_transaction_id,
        provider: value.provider,
      };
    }
    const provider = configuredPaymentProvider();
    const idempotencyKey = randomUUID();
    const created = await client.query<{ id: string }>(
      `INSERT INTO payment_transactions(order_id, provider, payment_method, status, amount_cents, idempotency_key)
       VALUES ($1, $2, $3, 'PENDING', $4, $5)
       RETURNING id`,
      [value.id, provider, input.paymentMethod, value.total_cents, idempotencyKey],
    );
    const paymentTransactionId = created.rows[0]?.id;
    if (!paymentTransactionId) {
      throw new AppError(503, "BACKEND_UNAVAILABLE");
    }
    await client.query("UPDATE orders SET payment_status = 'PROCESSING', updated_at = now() WHERE id = $1", [value.id]);
    return { ...value, idempotencyKey, paymentTransactionId, provider, provider_reference: null };
  });
  if (!order || order.provider_reference) {
    return;
  }
  const providerPayment = await createProviderPayment({
    amountCents: order.total_cents,
    idempotencyKey: order.idempotencyKey,
    orderNumber: order.order_number,
    payerEmail: order.buyer_email,
    paymentMethod: input.paymentMethod,
  }, order.provider);
  await transaction(async (client) => {
    await client.query(
      `UPDATE payment_transactions
          SET provider_reference = $2, status = 'PROCESSING', provider_payload = $3::jsonb, updated_at = now()
        WHERE id = $1 AND provider_reference IS NULL`,
      [order.paymentTransactionId, providerPayment.payment.providerReference, JSON.stringify(providerPayment.payment.publicData)],
    );
  });
}

async function ensureLedgerAccount(client: PoolClient, code: string, accountType: string, ownerUserId?: string): Promise<string> {
  await client.query(
    `INSERT INTO ledger_accounts(code, account_type, owner_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (code) DO NOTHING`,
    [code, accountType, ownerUserId ?? null],
  );
  const account = await client.query<{ id: string }>("SELECT id FROM ledger_accounts WHERE code = $1", [code]);
  const value = account.rows[0];
  if (!value) {
    throw new AppError(503, "BACKEND_UNAVAILABLE");
  }
  return value.id;
}

async function postApprovedPaymentLedger(
  client: PoolClient,
  paymentTransactionId: string,
  order: { seller_id: string; total_cents: number },
): Promise<void> {
  const commissionBasisPoints = config.payments.commissionBasisPoints;
  if (commissionBasisPoints === undefined) {
    throw new AppError(503, "PAYMENT_CONFIGURATION_UNAVAILABLE");
  }
  const commissionCents = calculatePercentageDiscount(order.total_cents, commissionBasisPoints);
  const sellerNetCents = order.total_cents - commissionCents;
  const transaction = await client.query<{ id: string }>(
    `INSERT INTO ledger_transactions(external_reference, event_type, idempotency_key)
     VALUES ($1, 'PAYMENT_APPROVED', $2)
     ON CONFLICT (external_reference) DO NOTHING
     RETURNING id`,
    [`payment:${paymentTransactionId}:approved`, randomUUID()],
  );
  const ledgerTransactionId = transaction.rows[0]?.id;
  if (!ledgerTransactionId) {
    return;
  }
  const clearingAccountId = await ensureLedgerAccount(client, "ASSET:CASH_CLEARING", "ASSET");
  const sellerAccountId = await ensureLedgerAccount(client, `LIABILITY:SELLER_PAYABLE:${order.seller_id}`, "LIABILITY", order.seller_id);
  const revenueAccountId = await ensureLedgerAccount(client, "REVENUE:PLATFORM_COMMISSION", "REVENUE");
  if (commissionCents > 0) {
    await client.query(
      `INSERT INTO ledger_entries(transaction_id, account_id, direction, amount_cents)
       VALUES ($1, $2, 'DEBIT', $3),
              ($1, $4, 'CREDIT', $5),
              ($1, $6, 'CREDIT', $7)`,
      [ledgerTransactionId, clearingAccountId, order.total_cents, sellerAccountId, sellerNetCents, revenueAccountId, commissionCents],
    );
  } else {
    await client.query(
      `INSERT INTO ledger_entries(transaction_id, account_id, direction, amount_cents)
       VALUES ($1, $2, 'DEBIT', $3),
              ($1, $4, 'CREDIT', $3)`,
      [ledgerTransactionId, clearingAccountId, order.total_cents, sellerAccountId],
    );
  }
  await client.query(
    `INSERT INTO payment_split_allocations(payment_transaction_id, seller_id, gross_cents, platform_fee_cents, seller_net_cents)
     VALUES ($1, $2, $3, $4, $5)`,
    [paymentTransactionId, order.seller_id, order.total_cents, commissionCents, sellerNetCents],
  );
}

async function postRefundLedger(
  client: import("pg").PoolClient,
  paymentTransactionId: string,
  order: { seller_id: string; total_cents: number },
): Promise<void> {
  const allocation = await client.query<{ platform_fee_cents: number; seller_net_cents: number }>(
    `SELECT platform_fee_cents, seller_net_cents
       FROM payment_split_allocations
      WHERE payment_transaction_id = $1`,
    [paymentTransactionId],
  );
  const split = allocation.rows[0];
  if (!split) {
    throw new AppError(409, "CONFLICT");
  }
  const ledgerTransaction = await client.query<{ id: string }>(
    `INSERT INTO ledger_transactions(external_reference, event_type, idempotency_key)
     VALUES ($1, 'PAYMENT_REFUNDED', $2)
     ON CONFLICT (external_reference) DO NOTHING
     RETURNING id`,
    [`payment:${paymentTransactionId}:refunded`, randomUUID()],
  );
  const ledgerTransactionId = ledgerTransaction.rows[0]?.id;
  if (!ledgerTransactionId) {
    return;
  }
  const clearingAccountId = await ensureLedgerAccount(client, "ASSET:CASH_CLEARING", "ASSET");
  const sellerAccountId = await ensureLedgerAccount(client, `LIABILITY:SELLER_PAYABLE:${order.seller_id}`, "LIABILITY", order.seller_id);
  const revenueAccountId = await ensureLedgerAccount(client, "REVENUE:PLATFORM_COMMISSION", "REVENUE");
  if (split.platform_fee_cents > 0) {
    await client.query(
      `INSERT INTO ledger_entries(transaction_id, account_id, direction, amount_cents)
       VALUES ($1, $2, 'DEBIT', $3),
              ($1, $4, 'DEBIT', $5),
              ($1, $6, 'CREDIT', $7)`,
      [ledgerTransactionId, sellerAccountId, split.seller_net_cents, revenueAccountId, split.platform_fee_cents, clearingAccountId, order.total_cents],
    );
  } else {
    await client.query(
      `INSERT INTO ledger_entries(transaction_id, account_id, direction, amount_cents)
       VALUES ($1, $2, 'DEBIT', $3),
              ($1, $4, 'CREDIT', $3)`,
      [ledgerTransactionId, sellerAccountId, order.total_cents, clearingAccountId],
    );
  }
}

export async function applyVerifiedPayment(input: {
  provider: PaymentProvider;
  providerReference: string;
  status: VerifiedPaymentStatus;
}): Promise<void> {
  if (input.status === "PENDING") {
    return;
  }
  await transaction(async (client) => {
    const payment = await client.query<{
      id: string;
      order_id: string;
      buyer_id: string;
      payment_status: string;
      seller_id: string;
      status: string;
      total_cents: number;
    }>(
      `SELECT payment_transactions.id, payment_transactions.order_id,
              orders.buyer_id, orders.payment_status, orders.status, orders.seller_id, orders.total_cents
         FROM payment_transactions
         JOIN orders ON orders.id = payment_transactions.order_id
        WHERE payment_transactions.provider = $1
          AND payment_transactions.provider_reference = $2
        FOR UPDATE OF payment_transactions, orders`,
      [input.provider, input.providerReference],
    );
    const value = payment.rows[0];
    if (!value) {
      throw new AppError(404, "NOT_FOUND");
    }
    if (input.status === "APPROVED") {
      if (value.payment_status === "APPROVED") {
        return;
      }
      if (value.status !== "PENDING_PAYMENT") {
        throw new AppError(409, "CONFLICT");
      }
      await client.query(
        `UPDATE payment_transactions SET status = 'APPROVED', verified_at = now(), updated_at = now()
          WHERE id = $1`,
        [value.id],
      );
      await client.query(
        `UPDATE orders SET status = 'PAID', payment_status = 'APPROVED', updated_at = now()
          WHERE id = $1 AND status = 'PENDING_PAYMENT'`,
        [value.order_id],
      );
      await client.query("UPDATE inventory_reservations SET status = 'CONFIRMED' WHERE order_id = $1 AND status = 'ACTIVE'", [value.order_id]);
      await client.query(
        `INSERT INTO order_status_history(order_id, from_status, to_status, reason)
         VALUES ($1, 'PENDING_PAYMENT', 'PAID', 'Pagamento confirmado pelo provedor')`,
        [value.order_id],
      );
      await postApprovedPaymentLedger(client, value.id, value);
      await enqueueDomainEvent(client, {
        aggregateId: value.order_id,
        aggregateType: "ORDER",
        eventType: "PaymentApproved",
        payload: { orderId: value.order_id, paymentTransactionId: value.id },
      });
      await enqueueDomainEvent(client, {
        aggregateId: value.order_id,
        aggregateType: "ORDER",
        eventType: "NotificationRequested",
        payload: { orderId: value.order_id, recipientUserId: value.buyer_id, template: "PAYMENT_APPROVED" },
      });
      return;
    }
    if (input.status === "REFUNDED") {
      if (value.payment_status !== "APPROVED") {
        return;
      }
      await client.query("UPDATE payment_transactions SET status = 'REFUNDED', verified_at = now(), updated_at = now() WHERE id = $1", [value.id]);
      await client.query("UPDATE orders SET status = 'REFUNDED', payment_status = 'REFUNDED', updated_at = now() WHERE id = $1", [value.order_id]);
      await client.query(
        `INSERT INTO order_status_history(order_id, from_status, to_status, reason)
         VALUES ($1, $2, 'REFUNDED', 'Reembolso confirmado pelo provedor')`,
        [value.order_id, value.status],
      );
      await postRefundLedger(client, value.id, value);
      await enqueueDomainEvent(client, {
        aggregateId: value.order_id,
        aggregateType: "ORDER",
        eventType: "PaymentRefunded",
        payload: { orderId: value.order_id, paymentTransactionId: value.id },
      });
      await enqueueDomainEvent(client, {
        aggregateId: value.order_id,
        aggregateType: "ORDER",
        eventType: "NotificationRequested",
        payload: { orderId: value.order_id, recipientUserId: value.buyer_id, template: "PAYMENT_REFUNDED" },
      });
      return;
    }
    if (["PENDING", "APPROVED", "REFUNDED"].includes(value.payment_status)) {
      return;
    }
    if (value.status !== "PENDING_PAYMENT") {
      return;
    }
    await client.query("UPDATE payment_transactions SET status = 'FAILED', verified_at = now(), updated_at = now() WHERE id = $1", [value.id]);
    await client.query("UPDATE orders SET status = 'FAILED', payment_status = 'FAILED', updated_at = now() WHERE id = $1", [value.order_id]);
    await client.query(
      `INSERT INTO order_status_history(order_id, from_status, to_status, reason)
       VALUES ($1, 'PENDING_PAYMENT', 'FAILED', 'Pagamento recusado ou cancelado pelo provedor')`,
      [value.order_id],
    );
    const released = await releasePendingOrderResources(client, value.order_id);
    if (released) {
      await enqueueDomainEvent(client, {
        aggregateId: value.order_id,
        aggregateType: "ORDER",
        eventType: "InventoryUpdated",
        payload: { orderId: value.order_id, reason: "PAYMENT_FAILED" },
      });
    }
    await enqueueDomainEvent(client, {
      aggregateId: value.order_id,
      aggregateType: "ORDER",
      eventType: "PaymentFailed",
      payload: { orderId: value.order_id, paymentTransactionId: value.id },
    });
    await enqueueDomainEvent(client, {
      aggregateId: value.order_id,
      aggregateType: "ORDER",
      eventType: "NotificationRequested",
      payload: { orderId: value.order_id, recipientUserId: value.buyer_id, template: "PAYMENT_FAILED" },
    });
  });
}

export async function processVerifiedProviderReference(provider: PaymentProvider, providerReference: string): Promise<void> {
  const verifiedStatus = await verifyProviderPayment(provider, providerReference);
  await applyVerifiedPayment({ provider, providerReference, status: verifiedStatus });
}

export function hashWebhookPayload(rawBody: Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function configuredProviderMatches(provider: PaymentProvider): boolean {
  return config.payments.provider === paymentProviderToConfigValue(provider);
}
