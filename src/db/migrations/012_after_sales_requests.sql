CREATE TABLE IF NOT EXISTS after_sales_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  buyer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_type varchar(24) NOT NULL CHECK (request_type IN ('CANCELLATION', 'RETURN')),
  status varchar(24) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'RECEIVED', 'REFUND_PENDING', 'REFUNDED', 'CANCELLED')),
  reason varchar(1000) NOT NULL,
  seller_note varchar(1000),
  reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS after_sales_requests_open_order_type_idx
  ON after_sales_requests(order_id, request_type)
  WHERE status IN ('PENDING', 'APPROVED', 'RECEIVED', 'REFUND_PENDING');

CREATE INDEX IF NOT EXISTS after_sales_requests_buyer_idx
  ON after_sales_requests(buyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS after_sales_requests_seller_idx
  ON after_sales_requests(seller_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS after_sales_requests_queue_idx
  ON after_sales_requests(status, created_at ASC)
  WHERE status IN ('PENDING', 'APPROVED', 'RECEIVED', 'REFUND_PENDING');

CREATE TABLE IF NOT EXISTS after_sales_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  after_sales_request_id uuid NOT NULL REFERENCES after_sales_requests(id) ON DELETE RESTRICT,
  from_status varchar(24),
  to_status varchar(24) NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  note varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS after_sales_status_history_request_idx
  ON after_sales_status_history(after_sales_request_id, created_at ASC);
