ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_service varchar(120) NOT NULL DEFAULT 'Entrega padrão EliteHub',
  ADD COLUMN IF NOT EXISTS shipping_estimated_min_business_days smallint,
  ADD COLUMN IF NOT EXISTS shipping_estimated_max_business_days smallint,
  ADD COLUMN IF NOT EXISTS shipping_carrier varchar(120),
  ADD COLUMN IF NOT EXISTS tracking_code varchar(120),
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_shipping_days_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_shipping_days_check
  CHECK (
    (shipping_estimated_min_business_days IS NULL AND shipping_estimated_max_business_days IS NULL)
    OR (
      shipping_estimated_min_business_days >= 0
      AND shipping_estimated_max_business_days >= shipping_estimated_min_business_days
    )
  );

UPDATE orders
   SET delivered_at = COALESCE(delivered_at, updated_at)
 WHERE status = 'DELIVERED';

UPDATE orders
   SET shipped_at = COALESCE(shipped_at, updated_at)
 WHERE status IN ('SHIPPED', 'DELIVERED');

CREATE INDEX IF NOT EXISTS orders_seller_fulfillment_idx
  ON orders(seller_id, status, created_at DESC);
