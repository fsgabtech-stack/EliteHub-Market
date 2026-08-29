import { config } from "./config.js";
import { closePool, query, transaction } from "./db/pool.js";
import { openServerValue } from "./domain/auth/secret-envelope.js";
import nodemailer from "nodemailer";

type OutboxEvent = {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
};

async function claimEvents(): Promise<OutboxEvent[]> {
  return transaction(async (client) => {
    const claimed = await client.query<OutboxEvent>(`
      WITH candidates AS (
        SELECT id
        FROM outbox_events
        WHERE processed_at IS NULL
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
      RETURNING event.id, event.aggregate_type, event.aggregate_id, event.event_type, event.payload
    `);
    return claimed.rows;
  });
}

async function processEvent(event: OutboxEvent): Promise<void> {
  if (event.event_type === "email.password_reset_requested") {
    const recipientEmail = event.payload.recipientEmail;
    const resetTokenEnvelope = event.payload.resetTokenEnvelope;
    if (
      !config.smtpUrl ||
      !config.smtpFrom ||
      typeof recipientEmail !== "string" ||
      typeof resetTokenEnvelope !== "string"
    ) {
      throw new Error("Password reset email is not configured");
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
    return;
  }

  throw new Error("No handler is registered for this event type");
}

async function runOnce(): Promise<void> {
  const events = await claimEvents();
  for (const event of events) {
    try {
      await processEvent(event);
      await query("UPDATE outbox_events SET processed_at = now(), locked_until = NULL WHERE id = $1", [event.id]);
    } catch (error) {
      const attempts = 5;
      await query(
        `UPDATE outbox_events
         SET locked_until = NULL,
             available_at = now() + ($2::text || ' minutes')::interval,
             last_error = $3
         WHERE id = $1`,
        [event.id, String(attempts), error instanceof Error ? error.message.slice(0, 500) : "Unknown error"],
      );
      console.error("Outbox event deferred", { eventId: event.id });
    }
  }
}

runOnce()
  .then(async () => closePool())
  .catch(async (error: unknown) => {
    console.error("Worker failed", { message: error instanceof Error ? error.message : "Unknown error" });
    await closePool();
    process.exitCode = 1;
  });
