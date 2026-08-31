ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_check;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_total_cents_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_total_cents_check
  CHECK (total_cents = subtotal_cents + shipping_cents - discount_cents AND total_cents >= 0);
