CREATE TABLE IF NOT EXISTS oauth_authorization_states (
  state_hash char(64) PRIMARY KEY,
  context_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_authorization_states_active_idx
  ON oauth_authorization_states(expires_at)
  WHERE consumed_at IS NULL;
