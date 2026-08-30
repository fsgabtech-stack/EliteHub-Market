import type { PoolClient } from "pg";

export type DomainEventType =
  | "FileDeletionRequested"
  | "InventoryUpdated"
  | "NotificationRequested"
  | "OrderCreated"
  | "PaymentRequested"
  | "PaymentApproved"
  | "PaymentFailed"
  | "PaymentRefunded"
  | "ProductUpdated"
  | "UserRegistered";

export async function enqueueDomainEvent(
  client: PoolClient,
  input: {
    aggregateId: string;
    aggregateType: string;
    eventType: DomainEventType;
    idempotencyKey?: string;
    payload: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events(aggregate_type, aggregate_id, event_type, idempotency_key, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (event_type, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [
      input.aggregateType,
      input.aggregateId,
      input.eventType,
      input.idempotencyKey ?? null,
      JSON.stringify(input.payload),
    ],
  );
}
