CREATE INDEX IF NOT EXISTS products_public_category_listing_idx
  ON products(category_id, created_at DESC)
  WHERE status = 'ACTIVE' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS products_public_seller_listing_idx
  ON products(seller_id, created_at DESC)
  WHERE status = 'ACTIVE' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS product_images_asset_product_idx
  ON product_images(asset_id, product_id);
