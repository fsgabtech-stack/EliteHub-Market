import type { Express, Request, Response } from "express";
import express from "express";

import { transaction } from "../db/pool.js";
import { AppError } from "../http/errors.js";
import { hashWebhookPayload, processVerifiedProviderReference } from "../modules/payments/payment-service.js";
import { type PaymentProvider, verifyWebhookSignature } from "../modules/payments/payment-gateway.js";

function providerFromPath(value: string): PaymentProvider | null {
  if (value === "mercado-pago") return "MERCADO_PAGO";
  if (value === "stripe") return "STRIPE";
  return null;
}

function header(request: Request, name: string): string | undefined {
  const value = request.get(name);
  return value === undefined ? undefined : value;
}

function stringAt(value: unknown, path: readonly string[]): string | undefined {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" || typeof current === "number" ? String(current) : undefined;
}

function webhookIdentity(provider: PaymentProvider, payload: unknown, request: Request): { eventId: string; providerReference: string } | null {
  if (provider === "STRIPE") {
    const eventId = stringAt(payload, ["id"]);
    const providerReference = stringAt(payload, ["data", "object", "id"]);
    return eventId && providerReference ? { eventId, providerReference } : null;
  }
  const providerReference = typeof request.query["data.id"] === "string"
    ? request.query["data.id"]
    : stringAt(payload, ["data", "id"]);
  const eventId = stringAt(payload, ["id"]);
  return eventId && providerReference ? { eventId, providerReference } : null;
}

async function receiveWebhook(request: Request, response: Response): Promise<void> {
  const provider = typeof request.params.provider === "string" ? providerFromPath(request.params.provider) : null;
  const rawBody = request.body;
  if (!provider || !Buffer.isBuffer(rawBody)) {
    throw new AppError(400, "INVALID_REQUEST");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new AppError(400, "INVALID_REQUEST");
  }
  const identity = webhookIdentity(provider, payload, request);
  const validSignature = verifyWebhookSignature({
    dataId: identity?.providerReference,
    headers: {
      "stripe-signature": header(request, "stripe-signature"),
      "x-request-id": header(request, "x-request-id"),
      "x-signature": header(request, "x-signature"),
    },
    provider,
    rawBody,
  });
  if (!validSignature || !identity) {
    throw new AppError(401, "UNAUTHORIZED");
  }
  const receipt = await transaction(async (client) => {
    const inserted = await client.query<{ id: string; processed_at: Date | null }>(
      `INSERT INTO payment_webhook_receipts(provider, provider_event_id, payload_sha256, signature_valid, payload)
       VALUES ($1, $2, $3, true, $4::jsonb)
       ON CONFLICT (provider, provider_event_id)
       DO UPDATE SET received_at = now()
       RETURNING id, processed_at`,
      [provider, identity.eventId, hashWebhookPayload(rawBody), JSON.stringify(payload)],
    );
    return inserted.rows[0] ?? null;
  });
  if (!receipt || receipt.processed_at) {
    response.status(202).json({ received: true, replayed: true });
    return;
  }
  const claimed = await transaction(async (client) => {
    const update = await client.query<{ id: string }>(
      `UPDATE payment_webhook_receipts
          SET attempt_count = attempt_count + 1, processing_error = NULL, processing_started_at = now()
        WHERE id = $1
          AND processed_at IS NULL
          AND (processing_started_at IS NULL OR processing_started_at < now() - interval '5 minutes')
        RETURNING id`,
      [receipt.id],
    );
    return update.rows[0] ?? null;
  });
  if (!claimed) {
    response.status(202).json({ received: true, replayed: true });
    return;
  }
  try {
    await processVerifiedProviderReference(provider, identity.providerReference);
    await transaction(async (client) => {
      await client.query(
        "UPDATE payment_webhook_receipts SET processed_at = now(), processing_error = NULL, processing_started_at = NULL WHERE id = $1",
        [receipt.id],
      );
      await client.query(
        `INSERT INTO audit_events(action, target_type, metadata)
         VALUES ('PAYMENT_WEBHOOK_PROCESSED', 'PAYMENT_WEBHOOK', jsonb_build_object('provider', $1::text, 'eventId', $2::text))`,
        [provider, identity.eventId],
      );
    });
  } catch (error) {
    await transaction(async (client) => {
      await client.query(
        "UPDATE payment_webhook_receipts SET processing_error = $2, processing_started_at = NULL WHERE id = $1",
        [receipt.id, error instanceof Error ? error.name : "Erro desconhecido"],
      );
    });
    throw new AppError(503, "BACKEND_UNAVAILABLE");
  }
  response.status(202).json({ received: true, replayed: false });
}

export function registerPaymentWebhookRoutes(app: Express): void {
  app.post("/api/v1/payments/webhooks/:provider", express.raw({ limit: "1mb", type: "application/json" }), (request, response, next) => {
    receiveWebhook(request, response).catch(next);
  });
}
