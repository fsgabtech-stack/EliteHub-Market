CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_one_per_order_idx
  ON payment_transactions(order_id);
