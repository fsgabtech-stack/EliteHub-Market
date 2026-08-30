ALTER TABLE user_notifications
  ADD COLUMN IF NOT EXISTS source_event_id uuid REFERENCES outbox_events(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_source_event_unique_idx
  ON user_notifications(source_event_id) WHERE source_event_id IS NOT NULL;
