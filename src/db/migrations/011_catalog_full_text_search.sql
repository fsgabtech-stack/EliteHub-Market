ALTER TABLE products
  ADD COLUMN IF NOT EXISTS search_document tsvector;

CREATE OR REPLACE FUNCTION elitehub_products_refresh_search_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_document := to_tsvector(
    'portuguese',
    concat_ws(' ', COALESCE(NEW.title, ''), COALESCE(NEW.description, ''))
  );
  RETURN NEW;
END;
$$;

UPDATE products
   SET search_document = to_tsvector(
     'portuguese',
     concat_ws(' ', COALESCE(title, ''), COALESCE(description, ''))
   )
 WHERE search_document IS NULL;

DROP TRIGGER IF EXISTS products_refresh_search_document ON products;

CREATE TRIGGER products_refresh_search_document
BEFORE INSERT OR UPDATE OF title, description ON products
FOR EACH ROW EXECUTE FUNCTION elitehub_products_refresh_search_document();

CREATE INDEX IF NOT EXISTS products_search_document_idx
  ON products USING GIN(search_document)
  WHERE status = 'ACTIVE' AND deleted_at IS NULL;
