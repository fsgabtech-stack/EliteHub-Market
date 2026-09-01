import type { Router } from "express";
import { z } from "zod";

import { query } from "../db/pool.js";
import { AppError, asyncRoute, invalidRequest } from "../http/errors.js";
import { readCachedJson, writeCachedJson } from "../infrastructure/cache/redis.js";
import { availabilityFromStock } from "../modules/catalog/availability.js";

const listQuerySchema = z.object({
  category: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  maxPriceCents: z.coerce.number().int().min(0).max(100_000_000).optional(),
  minPriceCents: z.coerce.number().int().min(0).max(100_000_000).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  q: z.string().trim().max(120).optional(),
  seller: z.string().uuid().optional(),
  sort: z.enum(["relevance", "newest", "price_asc", "price_desc"]).default("newest"),
});

const suggestionQuerySchema = z.object({ q: z.string().trim().min(2).max(120) });

const productIdSchema = z.string().uuid();

type ProductRow = {
  attributes: Record<string, unknown>;
  id: string;
  title: string;
  description: string;
  image_url: string | null;
  price_cents: number;
  review_average: number;
  review_count: number;
  stock_quantity: number;
  category_id: string | null;
  category_name: string | null;
  seller_name: string;
  seller_id: string;
  store_name: string | null;
};

function shapeProduct(row: ProductRow) {
  return {
    availability: availabilityFromStock(row.stock_quantity),
    category: row.category_id && row.category_name ? { id: row.category_id, name: row.category_name } : null,
    id: row.id,
    imageUrl: row.image_url,
    priceCents: row.price_cents,
    rating: row.review_count > 0 ? { average: row.review_average, count: row.review_count } : null,
    seller: { id: row.seller_id, name: row.store_name ?? row.seller_name },
    title: row.title,
  };
}

export function registerCatalogRoutes(router: Router, prefix = ""): void {
  router.get(
    `${prefix}/categories`,
    asyncRoute(async (_request, response) => {
      const result = await query<{ id: string; name: string; slug: string }>(
        `SELECT categories.id, categories.name, categories.slug
           FROM categories
          WHERE EXISTS (
            SELECT 1
              FROM products
              JOIN users ON users.id = products.seller_id AND users.deleted_at IS NULL
              JOIN seller_profiles ON seller_profiles.user_id = products.seller_id
                AND seller_profiles.approval_status = 'APPROVED'
             WHERE products.category_id = categories.id
               AND products.status = 'ACTIVE'
               AND products.deleted_at IS NULL
          )
          ORDER BY categories.name ASC`,
      );
      response.json({ items: result.rows });
    }),
  );

  router.get(
    `${prefix}/products`,
    asyncRoute(async (request, response) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw invalidRequest();
      }
      const input = parsed.data;
      if (input.minPriceCents !== undefined && input.maxPriceCents !== undefined && input.minPriceCents > input.maxPriceCents) {
        throw invalidRequest();
      }
      const cacheKey = `catalog:products:${JSON.stringify({
        category: input.category ?? null,
        limit: input.limit,
        maxPriceCents: input.maxPriceCents ?? null,
        minPriceCents: input.minPriceCents ?? null,
        offset: input.offset,
        q: input.q ?? null,
        seller: input.seller ?? null,
        sort: input.sort,
      })}`;
      const cached = await readCachedJson<{ items: ReturnType<typeof shapeProduct>[]; page: { hasNext: boolean; limit: number; offset: number; total: number } }>(cacheKey);
      if (cached) {
        response.json(cached);
        return;
      }
      const values: unknown[] = [];
      const clauses = ["products.status = 'ACTIVE'", "products.deleted_at IS NULL", "users.deleted_at IS NULL", "seller_profiles.approval_status = 'APPROVED'"];
      let queryTermIndex: number | undefined;
      let queryPatternIndex: number | undefined;
      if (input.category) {
        values.push(input.category);
        clauses.push(`products.category_id = $${values.length}`);
      }
      if (input.q) {
        values.push(input.q);
        queryTermIndex = values.length;
        values.push(`%${input.q.replace(/[\\%_]/g, "\\$&")}%`);
        queryPatternIndex = values.length;
        clauses.push(`(
          products.search_document @@ websearch_to_tsquery('portuguese', $${queryTermIndex})
          OR products.title ILIKE $${queryPatternIndex} ESCAPE '\\'
          OR products.description ILIKE $${queryPatternIndex} ESCAPE '\\'
        )`);
      }
      if (input.seller) {
        values.push(input.seller);
        clauses.push(`products.seller_id = $${values.length}`);
      }
      if (input.minPriceCents !== undefined) {
        values.push(input.minPriceCents);
        clauses.push(`products.price_cents >= $${values.length}`);
      }
      if (input.maxPriceCents !== undefined) {
        values.push(input.maxPriceCents);
        clauses.push(`products.price_cents <= $${values.length}`);
      }
      const orderBy = input.sort === "price_asc"
        ? "products.price_cents ASC, products.created_at DESC"
        : input.sort === "price_desc"
          ? "products.price_cents DESC, products.created_at DESC"
          : input.sort === "relevance" && queryTermIndex && queryPatternIndex
            ? `ts_rank(products.search_document, websearch_to_tsquery('portuguese', $${queryTermIndex})) DESC,
               CASE WHEN products.title ILIKE $${queryPatternIndex} ESCAPE '\\' THEN 0 ELSE 1 END,
               products.created_at DESC`
            : "products.created_at DESC";
      const totals = await query<{ total: number }>(
        `SELECT COUNT(*)::integer AS total
           FROM products
           JOIN users ON users.id = products.seller_id
           JOIN seller_profiles ON seller_profiles.user_id = products.seller_id
          WHERE ${clauses.join(" AND ")}`,
        values,
      );
      const total = totals.rows[0]?.total ?? 0;
      values.push(input.limit, input.offset);
      const products = await query<ProductRow>(
        `SELECT products.id, products.title, products.description,
                COALESCE('/api/v1/files/' || primary_image.asset_id::text, products.image_url) AS image_url,
                products.price_cents, products.stock_quantity, products.category_id,
                categories.name AS category_name, users.full_name AS seller_name, products.seller_id,
                seller_profiles.store_name, COALESCE(review_summary.review_average, 0) AS review_average,
                review_summary.review_count
           FROM products
           JOIN users ON users.id = products.seller_id
           JOIN seller_profiles ON seller_profiles.user_id = products.seller_id
          LEFT JOIN categories ON categories.id = products.category_id
          LEFT JOIN LATERAL (
            SELECT product_images.asset_id
              FROM product_images
              JOIN file_assets ON file_assets.id = product_images.asset_id AND file_assets.deleted_at IS NULL
             WHERE product_images.product_id = products.id
             ORDER BY product_images.sort_order ASC
             LIMIT 1
          ) AS primary_image ON true
          LEFT JOIN LATERAL (
            SELECT AVG(product_reviews.rating)::float8 AS review_average, COUNT(*)::integer AS review_count
              FROM product_reviews
             WHERE product_reviews.product_id = products.id AND product_reviews.status = 'PUBLISHED'
          ) AS review_summary ON true
         WHERE ${clauses.join(" AND ")}
          ORDER BY ${orderBy}
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
      const payload = {
        items: products.rows.map(shapeProduct),
        page: { hasNext: input.offset + products.rows.length < total, limit: input.limit, offset: input.offset, total },
      };
      await writeCachedJson(cacheKey, payload, 30);
      response.json(payload);
    }),
  );

  router.get(
    `${prefix}/search-suggestions`,
    asyncRoute(async (request, response) => {
      const parsed = suggestionQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw invalidRequest();
      }
      const pattern = `%${parsed.data.q.replace(/[\\%_]/g, "\\$&")}%`;
      const products = await query<{ id: string; title: string }>(
        `SELECT products.id, products.title
           FROM products
           JOIN users ON users.id = products.seller_id AND users.deleted_at IS NULL
           JOIN seller_profiles ON seller_profiles.user_id = products.seller_id
             AND seller_profiles.approval_status = 'APPROVED'
          WHERE products.status = 'ACTIVE' AND products.deleted_at IS NULL
            AND (
              products.search_document @@ websearch_to_tsquery('portuguese', $1)
              OR products.title ILIKE $2 ESCAPE '\\'
            )
          ORDER BY ts_rank(products.search_document, websearch_to_tsquery('portuguese', $1)) DESC,
                   products.created_at DESC
          LIMIT 8`,
        [parsed.data.q, pattern],
      );
      response.json({ items: products.rows.map((product) => ({ id: product.id, label: product.title, type: "PRODUCT" })) });
    }),
  );

  router.get(
    `${prefix}/products/:id`,
    asyncRoute(async (request, response) => {
      const id = productIdSchema.safeParse(request.params.id);
      if (!id.success) {
        throw invalidRequest();
      }
      const products = await query<ProductRow>(
        `SELECT products.id, products.title, products.description, products.attributes,
                COALESCE('/api/v1/files/' || primary_image.asset_id::text, products.image_url) AS image_url,
                products.price_cents, products.stock_quantity, products.category_id,
                categories.name AS category_name, users.full_name AS seller_name, products.seller_id,
                seller_profiles.store_name, COALESCE(review_summary.review_average, 0) AS review_average,
                review_summary.review_count
           FROM products
           JOIN users ON users.id = products.seller_id AND users.deleted_at IS NULL
           JOIN seller_profiles ON seller_profiles.user_id = products.seller_id
             AND seller_profiles.approval_status = 'APPROVED'
          LEFT JOIN categories ON categories.id = products.category_id
          LEFT JOIN LATERAL (
            SELECT product_images.asset_id
              FROM product_images
              JOIN file_assets ON file_assets.id = product_images.asset_id AND file_assets.deleted_at IS NULL
             WHERE product_images.product_id = products.id
             ORDER BY product_images.sort_order ASC
             LIMIT 1
          ) AS primary_image ON true
          LEFT JOIN LATERAL (
            SELECT AVG(product_reviews.rating)::float8 AS review_average, COUNT(*)::integer AS review_count
              FROM product_reviews
             WHERE product_reviews.product_id = products.id AND product_reviews.status = 'PUBLISHED'
          ) AS review_summary ON true
          WHERE products.id = $1 AND products.status = 'ACTIVE' AND products.deleted_at IS NULL`,
        [id.data],
      );
      const product = products.rows[0];
      if (!product) {
        throw new AppError(404, "NOT_FOUND");
      }
      const variants = await query<{
        attributes: Record<string, unknown>;
        id: string;
        price_cents: number | null;
        sku: string | null;
        stock_quantity: number;
      }>(
        `SELECT id, sku, attributes, price_cents, stock_quantity
           FROM product_variants WHERE product_id = $1 ORDER BY created_at ASC`,
        [product.id],
      );
      const images = await query<{ asset_id: string }>(
        `SELECT product_images.asset_id
           FROM product_images
           JOIN file_assets ON file_assets.id = product_images.asset_id AND file_assets.deleted_at IS NULL
          WHERE product_images.product_id = $1
          ORDER BY product_images.sort_order ASC`,
        [product.id],
      );
      response.json({
        product: {
          ...shapeProduct(product),
          attributes: product.attributes ?? {},
          description: product.description,
          images: images.rows.map((image) => ({ url: `/api/v1/files/${image.asset_id}` })),
          variants: variants.rows.map((variant) => ({
            availability: availabilityFromStock(variant.stock_quantity),
            attributes: variant.attributes,
            id: variant.id,
            priceCents: variant.price_cents,
            sku: variant.sku,
          })),
        },
      });
    }),
  );
}
