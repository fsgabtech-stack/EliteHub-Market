import type { Router } from "express";
import { z } from "zod";

import { query } from "../db/pool.js";
import { AppError, asyncRoute, invalidRequest } from "../http/errors.js";

const listQuerySchema = z.object({
  category: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  q: z.string().trim().max(120).optional(),
});

const productIdSchema = z.string().uuid();

type ProductRow = {
  id: string;
  title: string;
  description: string;
  image_url: string | null;
  price_cents: number;
  stock_quantity: number;
  category_id: string | null;
  category_name: string | null;
  seller_name: string;
  seller_id: string;
};

function shapeProduct(row: ProductRow) {
  return {
    category: row.category_id && row.category_name ? { id: row.category_id, name: row.category_name } : null,
    id: row.id,
    imageUrl: row.image_url,
    priceCents: row.price_cents,
    seller: { id: row.seller_id, name: row.seller_name },
    stockQuantity: row.stock_quantity,
    title: row.title,
  };
}

export function registerCatalogRoutes(router: Router): void {
  router.get(
    "/categories",
    asyncRoute(async (_request, response) => {
      const result = await query<{ id: string; name: string; slug: string }>(
        "SELECT id, name, slug FROM categories ORDER BY name ASC",
      );
      response.json({ items: result.rows });
    }),
  );

  router.get(
    "/products",
    asyncRoute(async (request, response) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw invalidRequest();
      }
      const input = parsed.data;
      const values: unknown[] = [];
      const clauses = ["products.status = 'ACTIVE'"];
      if (input.category) {
        values.push(input.category);
        clauses.push(`products.category_id = $${values.length}`);
      }
      if (input.q) {
        values.push(`%${input.q.replace(/[\\%_]/g, "\\$&")}%`);
        clauses.push(`(products.title ILIKE $${values.length} ESCAPE '\\' OR products.description ILIKE $${values.length} ESCAPE '\\')`);
      }
      values.push(input.limit, input.offset);
      const products = await query<ProductRow>(
        `SELECT products.id, products.title, products.description, products.image_url,
                products.price_cents, products.stock_quantity, products.category_id,
                categories.name AS category_name, users.full_name AS seller_name, products.seller_id
         FROM products
         JOIN users ON users.id = products.seller_id
         LEFT JOIN categories ON categories.id = products.category_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY products.created_at DESC
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );
      response.json({
        items: products.rows.map(shapeProduct),
        page: { limit: input.limit, offset: input.offset },
      });
    }),
  );

  router.get(
    "/products/:id",
    asyncRoute(async (request, response) => {
      const id = productIdSchema.safeParse(request.params.id);
      if (!id.success) {
        throw invalidRequest();
      }
      const products = await query<ProductRow>(
        `SELECT products.id, products.title, products.description, products.image_url,
                products.price_cents, products.stock_quantity, products.category_id,
                categories.name AS category_name, users.full_name AS seller_name, products.seller_id
         FROM products
         JOIN users ON users.id = products.seller_id
         LEFT JOIN categories ON categories.id = products.category_id
         WHERE products.id = $1 AND products.status = 'ACTIVE'`,
        [id.data],
      );
      const product = products.rows[0];
      if (!product) {
        throw new AppError(404, "NOT_FOUND");
      }
      response.json({
        product: {
          ...shapeProduct(product),
          description: product.description,
        },
      });
    }),
  );
}
