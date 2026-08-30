import type { Router } from "express";
import { z } from "zod";

import { query } from "../db/pool.js";
import { requireAuthenticatedUser } from "../http/authorization.js";
import { AppError, asyncRoute, invalidRequest } from "../http/errors.js";
import { csrfProtection } from "../http/security.js";

const productIdSchema = z.string().uuid();

export function registerFavoriteRoutes(router: Router): void {
  router.get(
    "/favorites",
    asyncRoute(async (request, response) => {
      const user = await requireAuthenticatedUser(request);
      const favorites = await query<{
        id: string;
        image_url: string | null;
        price_cents: number;
        title: string;
      }>(
        `SELECT products.id, products.title, products.price_cents,
                COALESCE('/api/v1/files/' || primary_image.asset_id::text, products.image_url) AS image_url
           FROM favorite_products
           JOIN products ON products.id = favorite_products.product_id
           LEFT JOIN LATERAL (
             SELECT product_images.asset_id
               FROM product_images
               JOIN file_assets ON file_assets.id = product_images.asset_id AND file_assets.deleted_at IS NULL
              WHERE product_images.product_id = products.id
              ORDER BY product_images.sort_order ASC
              LIMIT 1
           ) AS primary_image ON true
          WHERE favorite_products.user_id = $1
            AND products.status = 'ACTIVE'
            AND products.deleted_at IS NULL
          ORDER BY favorite_products.created_at DESC`,
        [user.id],
      );
      response.json({ items: favorites.rows.map((favorite) => ({
        id: favorite.id,
        imageUrl: favorite.image_url,
        priceCents: favorite.price_cents,
        title: favorite.title,
      })) });
    }),
  );

  router.post(
    "/favorites/:productId",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const productId = productIdSchema.safeParse(request.params.productId);
      if (!productId.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      const created = await query<{ product_id: string }>(
        `INSERT INTO favorite_products(user_id, product_id)
         SELECT $1, id FROM products
          WHERE id = $2 AND status = 'ACTIVE' AND deleted_at IS NULL
         ON CONFLICT DO NOTHING
         RETURNING product_id`,
        [user.id, productId.data],
      );
      if (!created.rows[0]) {
        const exists = await query<{ id: string }>(
          "SELECT id FROM products WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL",
          [productId.data],
        );
        if (!exists.rows[0]) {
          throw new AppError(404, "NOT_FOUND");
        }
      }
      response.status(201).json({ productId: productId.data });
    }),
  );

  router.delete(
    "/favorites/:productId",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const productId = productIdSchema.safeParse(request.params.productId);
      if (!productId.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      await query("DELETE FROM favorite_products WHERE user_id = $1 AND product_id = $2", [user.id, productId.data]);
      response.status(204).send();
    }),
  );
}
