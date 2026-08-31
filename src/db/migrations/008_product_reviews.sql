CREATE TABLE IF NOT EXISTS product_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  buyer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title varchar(120) NOT NULL,
  body varchar(2000) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED')),
  moderation_note varchar(500),
  moderated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  moderated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, buyer_id)
);

CREATE INDEX IF NOT EXISTS product_reviews_published_product_idx
  ON product_reviews(product_id, created_at DESC)
  WHERE status = 'PUBLISHED';

CREATE INDEX IF NOT EXISTS product_reviews_buyer_idx
  ON product_reviews(buyer_id, created_at DESC);
