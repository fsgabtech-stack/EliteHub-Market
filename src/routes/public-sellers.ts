import type { Router } from "express";
import { z } from "zod";

import { query } from "../db/pool.js";
import { AppError, asyncRoute, invalidRequest } from "../http/errors.js";

const sellerIdSchema = z.string().uuid();

export function registerPublicSellerRoutes(router: Router): void {
  router.get(
    "/sellers/:id",
    asyncRoute(async (request, response) => {
      const sellerId = sellerIdSchema.safeParse(request.params.id);
      if (!sellerId.success) {
        throw invalidRequest();
      }
      const profiles = await query<{
        description: string | null;
        product_count: number;
        store_name: string;
        user_id: string;
      }>(
        `SELECT seller_profiles.user_id, seller_profiles.store_name, seller_profiles.description,
                COUNT(products.id)::integer AS product_count
           FROM seller_profiles
           LEFT JOIN products ON products.seller_id = seller_profiles.user_id
             AND products.status = 'ACTIVE' AND products.deleted_at IS NULL
          WHERE seller_profiles.user_id = $1
            AND seller_profiles.approval_status = 'APPROVED'
          GROUP BY seller_profiles.user_id, seller_profiles.store_name, seller_profiles.description`,
        [sellerId.data],
      );
      const profile = profiles.rows[0];
      if (!profile) {
        throw new AppError(404, "NOT_FOUND");
      }
      response.json({ seller: {
        description: profile.description,
        id: profile.user_id,
        productCount: profile.product_count,
        storeName: profile.store_name,
      } });
    }),
  );
}
