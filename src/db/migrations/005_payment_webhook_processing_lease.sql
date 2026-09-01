ALTER TABLE payment_webhook_receipts
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0);

CREATE INDEX IF NOT EXISTS payment_webhook_receipts_recovery_idx
  ON payment_webhook_receipts(processing_started_at)
  WHERE processed_at IS NULL;
