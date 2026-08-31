import type { Router } from "express";
import { z } from "zod";

import { query, transaction } from "../db/pool.js";
import { requireAnyRole, requireAuthenticatedUser, requireVerifiedEmail } from "../http/authorization.js";
import { AppError, asyncRoute, invalidRequest } from "../http/errors.js";
import { csrfProtection } from "../http/security.js";
import { invalidatePublicCatalogCache } from "../modules/catalog/cache.js";
import { enqueueDomainEvent } from "../modules/events/outbox.js";

const productIdSchema = z.string().uuid();
const reviewIdSchema = z.string().uuid();
const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).default(10),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
const reviewSchema = z.object({
  body: z.string().trim().min(10).max(2_000),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(3).max(120),
});
const moderationSchema = z.object({
  note: z.string().trim().min(3).max(500).optional(),
  status: z.enum(["PUBLISHED", "HIDDEN", "REJECTED"]),
});

function publicReviewerName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "Cliente verificado";
  }
  if (parts.length === 1) {
    return parts[0] as string;
  }
  return `${parts[0]} ${(parts.at(-1) as string).slice(0, 1)}.`;
}

async function requirePublishedProduct(productId: string): Promise<void> {
  const product = await query<{ id: string }>(
    `SELECT products.id
       FROM products
       JOIN users ON users.id = products.seller_id AND users.deleted_at IS NULL
       JOIN seller_profiles ON seller_profiles.user_id = products.seller_id
         AND seller_profiles.approval_status = 'APPROVED'
      WHERE products.id = $1 AND products.status = 'ACTIVE' AND products.deleted_at IS NULL`,
    [productId],
  );
  if (!product.rows[0]) {
    throw new AppError(404, "NOT_FOUND");
  }
}

export function registerReviewRoutes(router: Router): void {
  router.get(
    "/products/:id/reviews",
    asyncRoute(async (request, response) => {
      const productId = productIdSchema.safeParse(request.params.id);
      const page = listSchema.safeParse(request.query);
      if (!productId.success || !page.success) {
        throw invalidRequest();
      }
      await requirePublishedProduct(productId.data);
      const [totalResult, reviews] = await Promise.all([
        query<{ total: number }>(
          "SELECT COUNT(*)::integer AS total FROM product_reviews WHERE product_id = $1 AND status = 'PUBLISHED'",
          [productId.data],
        ),
        query<{ body: string; created_at: Date; full_name: string; id: string; rating: number; title: string }>(
          `SELECT product_reviews.id, product_reviews.rating, product_reviews.title, product_reviews.body,
                  product_reviews.created_at, users.full_name
             FROM product_reviews
             JOIN users ON users.id = product_reviews.buyer_id AND users.deleted_at IS NULL
            WHERE product_reviews.product_id = $1 AND product_reviews.status = 'PUBLISHED'
            ORDER BY product_reviews.created_at DESC
            LIMIT $2 OFFSET $3`,
          [productId.data, page.data.limit, page.data.offset],
        ),
      ]);
      const total = totalResult.rows[0]?.total ?? 0;
      response.json({
        items: reviews.rows.map((review) => ({
          authorName: publicReviewerName(review.full_name),
          createdAt: review.created_at.toISOString(),
          id: review.id,
          rating: review.rating,
          text: review.body,
          title: review.title,
          verifiedPurchase: true,
        })),
        page: { hasNext: page.data.offset + reviews.rows.length < total, limit: page.data.limit, offset: page.data.offset, total },
      });
    }),
  );

  router.post(
    "/products/:id/reviews",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const productId = productIdSchema.safeParse(request.params.id);
      const review = reviewSchema.safeParse(request.body);
      if (!productId.success || !review.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      requireVerifiedEmail(user);
      const created = await transaction(async (client) => {
        const deliveredOrder = await client.query<{ id: string }>(
          `SELECT orders.id
             FROM orders
             JOIN order_items ON order_items.order_id = orders.id AND order_items.product_id = $2
            WHERE orders.buyer_id = $1 AND orders.status = 'DELIVERED'
            ORDER BY orders.updated_at DESC
            LIMIT 1`,
          [user.id, productId.data],
        );
        const order = deliveredOrder.rows[0];
        if (!order) {
          throw new AppError(409, "CONFLICT");
        }
        const result = await client.query<{ id: string }>(
          `INSERT INTO product_reviews(product_id, buyer_id, order_id, rating, title, body)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (product_id, buyer_id) DO NOTHING
           RETURNING id`,
          [productId.data, user.id, order.id, review.data.rating, review.data.title, review.data.body],
        );
        const createdReview = result.rows[0];
        if (!createdReview) {
          throw new AppError(409, "CONFLICT");
        }
        await client.query(
          `INSERT INTO audit_events(actor_user_id, action, target_type, target_id, metadata)
           VALUES ($1, 'PRODUCT_REVIEW_SUBMITTED', 'PRODUCT_REVIEW', $2, jsonb_build_object('productId', $3))`,
          [user.id, createdReview.id, productId.data],
        );
        return createdReview;
      });
      response.status(202).json({ id: created.id, status: "PENDING" });
    }),
  );

  router.patch(
    "/admin/reviews/:id",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const reviewId = reviewIdSchema.safeParse(request.params.id);
      const moderation = moderationSchema.safeParse(request.body);
      if (!reviewId.success || !moderation.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      requireAnyRole(user, ["ADMIN", "SUPPORT"]);
      await transaction(async (client) => {
        const result = await client.query<{ buyer_id: string; product_id: string }>(
          `UPDATE product_reviews
              SET status = $2, moderation_note = $3, moderated_by = $4, moderated_at = now(), updated_at = now()
            WHERE id = $1
            RETURNING buyer_id, product_id`,
          [reviewId.data, moderation.data.status, moderation.data.note ?? null, user.id],
        );
        const review = result.rows[0];
        if (!review) {
          throw new AppError(404, "NOT_FOUND");
        }
        await client.query(
          `INSERT INTO audit_events(actor_user_id, action, target_type, target_id, metadata)
           VALUES ($1, 'PRODUCT_REVIEW_MODERATED', 'PRODUCT_REVIEW', $2, jsonb_build_object('status', $3))`,
          [user.id, reviewId.data, moderation.data.status],
        );
        if (moderation.data.status === "PUBLISHED") {
          await enqueueDomainEvent(client, {
            aggregateId: reviewId.data,
            aggregateType: "PRODUCT_REVIEW",
            eventType: "NotificationRequested",
            payload: { productId: review.product_id, recipientUserId: review.buyer_id, template: "REVIEW_PUBLISHED" },
          });
        }
        return review;
      });
      await invalidatePublicCatalogCache();
      response.status(204).send();
    }),
  );
}
