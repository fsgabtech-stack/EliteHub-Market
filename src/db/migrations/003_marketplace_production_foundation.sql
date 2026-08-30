ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
UPDATE user_roles SET role = 'CUSTOMER' WHERE role = 'BUYER';
ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('CUSTOMER', 'SELLER', 'PROFESSIONAL', 'ADMIN', 'SUPPORT'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

CREATE TABLE IF NOT EXISTS privacy_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  purpose varchar(80) NOT NULL,
  granted boolean NOT NULL,
  legal_basis varchar(80) NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS privacy_consents_user_purpose_idx
  ON privacy_consents(user_id, purpose, granted_at DESC);

CREATE TABLE IF NOT EXISTS user_mfa_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  method varchar(24) NOT NULL CHECK (method IN ('TOTP')),
  secret_envelope text NOT NULL,
  enabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  UNIQUE (user_id, method)
);

ALTER TABLE seller_profiles ADD COLUMN IF NOT EXISTS legal_name varchar(180);
ALTER TABLE seller_profiles ADD COLUMN IF NOT EXISTS document_hash char(64);
ALTER TABLE seller_profiles ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE seller_profiles ADD COLUMN IF NOT EXISTS support_email varchar(320);

CREATE TABLE IF NOT EXISTS seller_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  asset_id uuid,
  document_type varchar(40) NOT NULL,
  verification_status varchar(24) NOT NULL DEFAULT 'PENDING'
    CHECK (verification_status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS currency char(3) NOT NULL DEFAULT 'BRL'
  CHECK (currency = 'BRL');
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku varchar(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS products_seller_sku_unique_idx
  ON products(seller_id, sku) WHERE sku IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  asset_id uuid,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  alt_text varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, sort_order)
);

CREATE TABLE IF NOT EXISTS file_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_key varchar(512) NOT NULL UNIQUE,
  original_filename varchar(255) NOT NULL,
  content_type varchar(160) NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  sha256 char(64) NOT NULL,
  purpose varchar(40) NOT NULL CHECK (purpose IN ('PRODUCT_IMAGE', 'SELLER_DOCUMENT', 'USER_AVATAR')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE product_images
  ADD CONSTRAINT product_images_asset_fk
  FOREIGN KEY (asset_id) REFERENCES file_assets(id) ON DELETE RESTRICT;
ALTER TABLE seller_documents
  ADD CONSTRAINT seller_documents_asset_fk
  FOREIGN KEY (asset_id) REFERENCES file_assets(id) ON DELETE RESTRICT;

ALTER TABLE carts ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE carts ADD COLUMN IF NOT EXISTS guest_token_hash char(64);
ALTER TABLE carts ADD CONSTRAINT carts_identity_check
  CHECK ((user_id IS NULL) <> (guest_token_hash IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS carts_one_active_guest_idx
  ON carts(guest_token_hash) WHERE status = 'ACTIVE' AND guest_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id uuid REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  status varchar(24) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'CONFIRMED', 'RELEASED', 'EXPIRED')),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, product_id, variant_id)
);

CREATE INDEX IF NOT EXISTS inventory_reservations_expiry_idx
  ON inventory_reservations(expires_at) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(64) NOT NULL,
  scope varchar(24) NOT NULL CHECK (scope IN ('PLATFORM', 'SELLER')),
  seller_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  discount_type varchar(24) NOT NULL CHECK (discount_type IN ('PERCENTAGE', 'FIXED')),
  discount_value integer NOT NULL CHECK (discount_value > 0),
  minimum_order_cents integer NOT NULL DEFAULT 0 CHECK (minimum_order_cents >= 0),
  usage_limit integer CHECK (usage_limit > 0),
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'PLATFORM' AND seller_id IS NULL) OR (scope = 'SELLER' AND seller_id IS NOT NULL)),
  CHECK ((discount_type = 'PERCENTAGE' AND discount_value <= 10000) OR discount_type = 'FIXED')
);

CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_active_idx
  ON coupons(upper(code)) WHERE active = true;

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  discount_cents integer NOT NULL CHECK (discount_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, order_id)
);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
UPDATE orders SET status = 'CREATED' WHERE status = 'PENDING';
UPDATE orders SET status = 'PENDING_PAYMENT' WHERE status = 'AWAITING_PAYMENT';
UPDATE orders SET status = 'PAID' WHERE status = 'PAYMENT_APPROVED';
UPDATE orders SET status = 'PROCESSING' WHERE status = 'PREPARING';
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('CREATED', 'PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'FAILED'));
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('PENDING', 'REQUIRES_ACTION', 'PROCESSING', 'APPROVED', 'FAILED', 'REFUNDED', 'CANCELLED'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES coupons(id) ON DELETE RESTRICT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_total_cents_check;
ALTER TABLE orders ADD CONSTRAINT orders_total_cents_check
  CHECK (total_cents = subtotal_cents + shipping_cents - discount_cents AND total_cents >= 0);

CREATE TABLE IF NOT EXISTS order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  from_status varchar(32),
  to_status varchar(32) NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  reason varchar(300),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_status_history_order_idx
  ON order_status_history(order_id, created_at ASC);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  provider varchar(32) NOT NULL CHECK (provider IN ('MERCADO_PAGO', 'STRIPE')),
  payment_method varchar(24) NOT NULL CHECK (payment_method IN ('PIX', 'CREDIT_CARD', 'BOLETO')),
  provider_reference varchar(255),
  status varchar(32) NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'APPROVED', 'FAILED', 'REFUNDED', 'CANCELLED')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  idempotency_key uuid NOT NULL,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_reference),
  UNIQUE (order_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS payment_webhook_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider varchar(32) NOT NULL CHECK (provider IN ('MERCADO_PAGO', 'STRIPE')),
  provider_event_id varchar(255) NOT NULL,
  payload_sha256 char(64) NOT NULL,
  signature_valid boolean NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error varchar(500),
  payload jsonb NOT NULL,
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS payment_split_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_transaction_id uuid NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
  seller_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  gross_cents integer NOT NULL CHECK (gross_cents >= 0),
  platform_fee_cents integer NOT NULL CHECK (platform_fee_cents >= 0),
  seller_net_cents integer NOT NULL CHECK (seller_net_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (seller_net_cents = gross_cents - platform_fee_cents)
);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(120) NOT NULL UNIQUE,
  account_type varchar(24) NOT NULL CHECK (account_type IN ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY')),
  owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_reference varchar(255) NOT NULL UNIQUE,
  event_type varchar(80) NOT NULL,
  idempotency_key uuid NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  direction varchar(6) NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_entries_account_date_idx
  ON ledger_entries(account_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_ledger_transaction_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transaction_to_validate uuid;
  balance bigint;
BEGIN
  transaction_to_validate := COALESCE(NEW.transaction_id, OLD.transaction_id);
  SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE -amount_cents END), 0)
    INTO balance
    FROM ledger_entries
   WHERE transaction_id = transaction_to_validate;
  IF balance <> 0 THEN
    RAISE EXCEPTION 'Lançamento contábil desequilibrado para a transação %', transaction_to_validate;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ledger_transaction_balance_trigger ON ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_transaction_balance_trigger
AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_ledger_transaction_balance();

ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS idempotency_key uuid;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;
ALTER TABLE idempotency_records ADD COLUMN IF NOT EXISTS request_hash char(64);
CREATE UNIQUE INDEX IF NOT EXISTS outbox_events_idempotency_idx
  ON outbox_events(event_type, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_transactions_order_idx
  ON payment_transactions(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_webhook_receipts_pending_idx
  ON payment_webhook_receipts(received_at) WHERE processed_at IS NULL;
