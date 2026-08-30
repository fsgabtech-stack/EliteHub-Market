import nodemailer from "nodemailer";

import { config } from "./config.js";
import { closePool, query, transaction } from "./db/pool.js";
import { openServerValue } from "./domain/auth/secret-envelope.js";
import { logger } from "./observability/logger.js";
import { encerrarTracing, iniciarTracing } from "./observability/tracing.js";
import { requestPaymentForOrder } from "./modules/payments/payment-service.js";
import { closeRedis, invalidateCachePrefix } from "./infrastructure/cache/redis.js";
import { deleteStoredFile } from "./modules/files/storage.js";

type OutboxEvent = {
  aggregate_id: string;
  aggregate_type: string;
  attempts: number;
  event_type: string;
  id: string;
  payload: Record<string, unknown>;
};

const maxAttempts = 10;
let stopping = false;

function stringPayload(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function claimEvents(): Promise<OutboxEvent[]> {
  return transaction(async (client) => {
    const claimed = await client.query<OutboxEvent>(`
      WITH candidates AS (
        SELECT id
        FROM outbox_events
        WHERE processed_at IS NULL
          AND dead_lettered_at IS NULL
          AND available_at <= now()
          AND (locked_until IS NULL OR locked_until < now())
        ORDER BY occurred_at
        FOR UPDATE SKIP LOCKED
        LIMIT 20
      )
      UPDATE outbox_events event
      SET locked_until = now() + interval '5 minutes', attempts = event.attempts + 1
      FROM candidates
      WHERE event.id = candidates.id
      RETURNING event.id, event.aggregate_type, event.aggregate_id, event.event_type, event.payload, event.attempts
    `);
    return claimed.rows;
  });
}

async function sendPasswordResetEmail(event: OutboxEvent): Promise<void> {
  const recipientEmail = stringPayload(event.payload.recipientEmail);
  const resetTokenEnvelope = stringPayload(event.payload.resetTokenEnvelope);
  if (!config.smtpUrl || !config.smtpFrom || !recipientEmail || !resetTokenEnvelope) {
    throw new Error("Configuração SMTP ou carga de recuperação ausente");
  }
  const resetUrl = new URL("/static/elitehub.html", config.appOrigin);
  resetUrl.searchParams.set("reset_token", openServerValue(resetTokenEnvelope));
  const transport = nodemailer.createTransport(config.smtpUrl);
  await transport.sendMail({
    from: config.smtpFrom,
    html: `<p>Recebemos uma solicitação para redefinir sua senha na EliteHub Connect.</p><p><a href="${resetUrl.toString()}">Definir nova senha</a></p><p>Este link expira em 30 minutos e pode ser usado uma única vez.</p>`,
    subject: "Redefinição de senha — EliteHub Connect",
    text: `Recebemos uma solicitação para redefinir sua senha na EliteHub Connect. Use este link em até 30 minutos: ${resetUrl.toString()}`,
    to: recipientEmail,
  });
}

async function sendEmailConfirmation(event: OutboxEvent): Promise<void> {
  const recipientEmail = stringPayload(event.payload.recipientEmail);
  const confirmationTokenEnvelope = stringPayload(event.payload.confirmationTokenEnvelope);
  if (!config.smtpUrl || !config.smtpFrom || !recipientEmail || !confirmationTokenEnvelope) {
    throw new Error("Configuração SMTP ou carga de confirmação ausente");
  }
  const confirmationUrl = new URL("/static/confirm-email.html", config.appOrigin);
  confirmationUrl.hash = new URLSearchParams({ token: openServerValue(confirmationTokenEnvelope) }).toString();
  const transport = nodemailer.createTransport(config.smtpUrl);
  await transport.sendMail({
    from: config.smtpFrom,
    html: `<p>Confirme seu e-mail para ativar as compras na EliteHub Connect.</p><p><a href="${confirmationUrl.toString()}">Confirmar e-mail</a></p><p>Este link expira em 24 horas e pode ser usado uma única vez.</p>`,
    subject: "Confirme seu e-mail — EliteHub Connect",
    text: `Confirme seu e-mail em até 24 horas: ${confirmationUrl.toString()}`,
    to: recipientEmail,
  });
}

async function sendNotification(event: OutboxEvent): Promise<void> {
  const recipientUserId = stringPayload(event.payload.recipientUserId);
  const template = stringPayload(event.payload.template);
  if (!recipientUserId || !template) {
    throw new Error("Carga de notificação ausente");
  }
  const content = notificationContent(template);
  await query(
    `INSERT INTO user_notifications(user_id, kind, title, body, link_path, source_event_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source_event_id) WHERE source_event_id IS NOT NULL DO NOTHING`,
    [recipientUserId, template, content.title, content.text, stringPayload(event.payload.orderId) ? "#pedidos" : "#notificacoes", event.id],
  );
  if (!config.smtpFrom || !config.smtpUrl) {
    logger.warn({ eventoId: event.id, tipoEvento: event.event_type }, "notificação interna criada sem envio de e-mail por SMTP indisponível");
    return;
  }
  const recipient = await query<{ email: string; full_name: string }>(
    "SELECT email, full_name FROM users WHERE id = $1 AND deleted_at IS NULL",
    [recipientUserId],
  );
  const user = recipient.rows[0];
  if (!user) {
    return;
  }
  const text = content.text;
  const transport = nodemailer.createTransport(config.smtpUrl);
  await transport.sendMail({
    from: config.smtpFrom,
    html: `<p>Olá, ${user.full_name}.</p><p>${text}</p>`,
    subject: content.title,
    text: `Olá, ${user.full_name}. ${text}`,
    to: user.email,
  });
}

function notificationContent(template: string): { text: string; title: string } {
  const text = template === "ORDER_CREATED"
    ? "Seu pedido foi criado e aguarda a confirmação do pagamento."
    : template === "PAYMENT_APPROVED"
      ? "Seu pagamento foi confirmado. O vendedor será notificado para iniciar o processamento."
      : template === "PAYMENT_FAILED"
        ? "O pagamento do seu pedido não foi aprovado. O estoque reservado foi liberado."
        : template === "PAYMENT_REFUNDED"
          ? "O reembolso do seu pedido foi confirmado pelo provedor de pagamento."
          : "O status do seu pedido foi atualizado. Acesse sua conta para consultar os detalhes.";
  return { text, title: "Atualização da EliteHub Connect" };
}

async function indexProduct(event: OutboxEvent): Promise<void> {
  if (["ProductUpdated", "InventoryUpdated"].includes(event.event_type)) {
    await invalidateCachePrefix("catalog:");
  }
  if (!config.search.url || !["ProductUpdated", "InventoryUpdated"].includes(event.event_type)) {
    return;
  }
  const product = await query<{
    attributes: Record<string, unknown>;
    description: string;
    id: string;
    price_cents: number;
    status: string;
    stock_quantity: number;
    title: string;
  }>(
    `SELECT id, title, description, attributes, price_cents, stock_quantity, status
       FROM products WHERE id = $1 AND deleted_at IS NULL`,
    [event.aggregate_id],
  );
  const value = product.rows[0];
  if (!value) {
    return;
  }
  const url = new URL(`/${encodeURIComponent(config.search.index)}/_doc/${encodeURIComponent(value.id)}`, config.search.url);
  const response = await fetch(url, {
    body: JSON.stringify(value),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
  if (!response.ok) {
    throw new Error("Falha de indexação no mecanismo de busca");
  }
}

async function deleteAnonymizedFiles(event: OutboxEvent): Promise<void> {
  const userId = stringPayload(event.payload.userId);
  if (!userId) {
    throw new Error("Carga de exclusão de arquivos inválida");
  }
  const assets = await query<{ storage_key: string }>(
    "SELECT storage_key FROM file_assets WHERE owner_user_id = $1 AND deleted_at IS NOT NULL",
    [userId],
  );
  for (const asset of assets.rows) {
    await deleteStoredFile(asset.storage_key);
  }
}

async function processEvent(event: OutboxEvent): Promise<void> {
  if (event.event_type === "email.password_reset_requested") {
    await sendPasswordResetEmail(event);
    return;
  }
  if (event.event_type === "email.confirmation_requested") {
    await sendEmailConfirmation(event);
    return;
  }
  if (event.event_type === "PaymentRequested") {
    const paymentMethod = stringPayload(event.payload.paymentMethod);
    if (paymentMethod !== "PIX" && paymentMethod !== "CREDIT_CARD" && paymentMethod !== "BOLETO") {
      throw new Error("Método de pagamento inválido na carga do evento");
    }
    await requestPaymentForOrder({ orderId: event.aggregate_id, paymentMethod });
    return;
  }
  if (event.event_type === "NotificationRequested") {
    await sendNotification(event);
    return;
  }
  if (event.event_type === "FileDeletionRequested") {
    await deleteAnonymizedFiles(event);
    return;
  }
  await indexProduct(event);
}

async function markProcessed(eventId: string): Promise<void> {
  await query(
    "UPDATE outbox_events SET processed_at = now(), locked_until = NULL, last_error = NULL WHERE id = $1",
    [eventId],
  );
}

async function deferOrDeadLetter(event: OutboxEvent, error: unknown): Promise<void> {
  const description = error instanceof Error ? error.name : "Erro desconhecido";
  if (event.attempts >= maxAttempts) {
    await query(
      `UPDATE outbox_events
          SET dead_lettered_at = now(), locked_until = NULL, last_error = $2
        WHERE id = $1`,
      [event.id, description],
    );
    logger.error({ eventoId: event.id, tipoEvento: event.event_type }, "evento enviado para fila morta");
    return;
  }
  const backoffSeconds = Math.min(3_600, 2 ** Math.min(event.attempts, 10));
  await query(
    `UPDATE outbox_events
        SET locked_until = NULL,
            available_at = now() + ($2::text || ' seconds')::interval,
            last_error = $3
      WHERE id = $1`,
    [event.id, String(backoffSeconds), description],
  );
  logger.warn({ atrasoSegundos: backoffSeconds, eventoId: event.id, tipoEvento: event.event_type }, "evento reagendado");
}

async function processBatch(): Promise<number> {
  const events = await claimEvents();
  for (let index = 0; index < events.length; index += config.events.workerConcurrency) {
    const batch = events.slice(index, index + config.events.workerConcurrency);
    await Promise.all(batch.map(async (event) => {
      try {
        await processEvent(event);
        await markProcessed(event.id);
      } catch (error) {
        await deferOrDeadLetter(event, error);
      }
    }));
  }
  return events.length;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runWorker(): Promise<void> {
  while (!stopping) {
    const processed = await processBatch();
    if (processed === 0) {
      await wait(config.events.pollIntervalMs);
    }
  }
}

function requestStop(signal: string): void {
  stopping = true;
  logger.info({ sinal: signal }, "encerramento do worker solicitado");
}

process.on("SIGINT", () => requestStop("SIGINT"));
process.on("SIGTERM", () => requestStop("SIGTERM"));

iniciarTracing();

runWorker()
  .catch((error: unknown) => {
    logger.error({ erro: error instanceof Error ? error.name : "Erro desconhecido" }, "falha irrecuperável do worker");
    process.exitCode = 1;
  })
  .finally(async () => {
    await encerrarTracing();
    await closePool();
    await closeRedis();
  });
