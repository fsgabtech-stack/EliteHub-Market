CREATE TABLE IF NOT EXISTS favorite_products (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS favorite_products_user_created_idx
  ON favorite_products(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind varchar(48) NOT NULL,
  title varchar(180) NOT NULL,
  body varchar(1000) NOT NULL,
  link_path varchar(500),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (link_path IS NULL OR link_path LIKE '#%')
);

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
  ON user_notifications(user_id, created_at DESC);
