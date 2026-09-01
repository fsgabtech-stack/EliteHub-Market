import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";

import { criarAplicacao } from "../app.js";
import { config, hasPersistenceConfiguration } from "../config.js";
import { closePool, query } from "../db/pool.js";
import { closeRedis } from "../infrastructure/cache/redis.js";

async function withApplication<T>(callback: (origin: string) => Promise<T>): Promise<T> {
  const server = createServer(criarAplicacao());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test(
  "aceita repetição assinada sem reprocessar o recibo de webhook Stripe",
  { skip: !hasPersistenceConfiguration() || !config.payments.stripeWebhookSecret },
  async () => {
    const webhookSecret = config.payments.stripeWebhookSecret;
    if (!webhookSecret) throw new Error("O segredo descartável de webhook não está configurado para o teste.");
    const eventId = `evt_replay_${randomUUID().replaceAll("-", "")}`;
    const payload = { data: { object: { id: `pi_${randomUUID().replaceAll("-", "")}` } }, id: eventId };
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signature = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    await query(
      `INSERT INTO payment_webhook_receipts(provider, provider_event_id, payload_sha256, signature_valid, processed_at, payload)
       VALUES ('STRIPE', $1, $2, true, now(), $3::jsonb)`,
      [eventId, createHash("sha256").update(rawBody).digest("hex"), rawBody],
    );
    try {
      await withApplication(async (origin) => {
        const response = await fetch(`${origin}/api/v1/payments/webhooks/stripe`, {
          body: rawBody,
          headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` },
          method: "POST",
        });
        assert.equal(response.status, 202);
        assert.deepEqual(await response.json(), { received: true, replayed: true });
      });
      const receipt = await query<{ attempt_count: number; processed_at: Date | null }>(
        "SELECT attempt_count, processed_at FROM payment_webhook_receipts WHERE provider = 'STRIPE' AND provider_event_id = $1",
        [eventId],
      );
      assert.equal(receipt.rows[0]?.attempt_count, 0);
      assert.ok(receipt.rows[0]?.processed_at);
    } finally {
      await query("DELETE FROM payment_webhook_receipts WHERE provider = 'STRIPE' AND provider_event_id = $1", [eventId]);
      await Promise.all([closePool(), closeRedis()]);
    }
  },
);

test(
  "não toma a concessão ativa de outro processamento de webhook Stripe",
  { skip: !hasPersistenceConfiguration() || !config.payments.stripeWebhookSecret },
  async () => {
    const webhookSecret = config.payments.stripeWebhookSecret;
    if (!webhookSecret) throw new Error("O segredo descartável de webhook não está configurado para o teste.");
    const eventId = `evt_lease_${randomUUID().replaceAll("-", "")}`;
    const payload = { data: { object: { id: `pi_${randomUUID().replaceAll("-", "")}` } }, id: eventId };
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signature = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    await query(
      `INSERT INTO payment_webhook_receipts(provider, provider_event_id, payload_sha256, signature_valid, processing_started_at, payload)
       VALUES ('STRIPE', $1, $2, true, now(), $3::jsonb)`,
      [eventId, createHash("sha256").update(rawBody).digest("hex"), rawBody],
    );
    try {
      await withApplication(async (origin) => {
        const response = await fetch(`${origin}/api/v1/payments/webhooks/stripe`, {
          body: rawBody,
          headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` },
          method: "POST",
        });
        assert.equal(response.status, 202);
        assert.deepEqual(await response.json(), { received: true, replayed: true });
      });
      const receipt = await query<{ attempt_count: number; processing_started_at: Date | null }>(
        "SELECT attempt_count, processing_started_at FROM payment_webhook_receipts WHERE provider = 'STRIPE' AND provider_event_id = $1",
        [eventId],
      );
      assert.equal(receipt.rows[0]?.attempt_count, 0);
      assert.ok(receipt.rows[0]?.processing_started_at);
    } finally {
      await query("DELETE FROM payment_webhook_receipts WHERE provider = 'STRIPE' AND provider_event_id = $1", [eventId]);
      await Promise.all([closePool(), closeRedis()]);
    }
  },
);
