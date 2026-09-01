import type { Router } from "express";
import { z } from "zod";

import { query, transaction } from "../db/pool.js";
import { requireAnyRole, requireAuthenticatedUser } from "../http/authorization.js";
import { AppError, asyncRoute, invalidRequest } from "../http/errors.js";
import { csrfProtection } from "../http/security.js";
import { enqueueDomainEvent } from "../modules/events/outbox.js";
import { invalidatePublicCatalogCache } from "../modules/catalog/cache.js";

const categorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
});

const couponFields = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,64}$/),
  discountType: z.enum(["PERCENTAGE", "FIXED"]),
  discountValue: z.number().int().min(1).max(100_000_000),
  expiresAt: z.string().datetime().optional(),
  minimumOrderCents: z.number().int().min(0).max(100_000_000).default(0),
  scope: z.enum(["PLATFORM", "SELLER"]),
  sellerId: z.string().uuid().optional(),
  startsAt: z.string().datetime().optional(),
  usageLimit: z.number().int().min(1).max(10_000_000).optional(),
});

const couponSchema = couponFields.superRefine((value, context) => {
  if (value.scope === "PLATFORM" && value.sellerId) {
    context.addIssue({ code: "custom", message: "sellerId inválido", path: ["sellerId"] });
  }
  if (value.scope === "SELLER" && !value.sellerId) {
    context.addIssue({ code: "custom", message: "sellerId obrigatório", path: ["sellerId"] });
  }
  if (value.discountType === "PERCENTAGE" && value.discountValue > 10_000) {
    context.addIssue({ code: "custom", message: "percentual inválido", path: ["discountValue"] });
  }
});

const sellerCouponSchema = couponFields.omit({ scope: true, sellerId: true });
const sellerListSchema = z.object({ approvalStatus: z.enum(["INCOMPLETE", "PENDING", "APPROVED", "REJECTED"]).optional() });
const reviewListSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), status: z.enum(["PENDING", "PUBLISHED", "HIDDEN", "REJECTED"]).default("PENDING") });

export function registerAdminRoutes(router: Router): void {
  router.get(
    "/admin/operations/summary",
    asyncRoute(async (request, response) => {
      const user = await requireAuthenticatedUser(request);
      requireAnyRole(user, ["ADMIN"]);
      const [orders, inventory, outbox] = await Promise.all([
        query<{ count: number; status: string }>(
          "SELECT status, COUNT(*)::integer AS count FROM orders GROUP BY status ORDER BY status ASC",
        ),
        query<{ low_stock_products: number; zero_stock_products: number }>(
          `SELECT COUNT(*) FILTER (WHERE stock_quantity <= 5)::integer AS low_stock_products,
                  COUNT(*) FILTER (WHERE stock_quantity = 0)::integer AS zero_stock_products
             FROM products
            WHERE status = 'ACTIVE' AND deleted_at IS NULL`,
        ),
        query<{ dead_lettered: number; pending: number; retrying: number }>(
          `SELECT COUNT(*) FILTER (WHERE processed_at IS NULL AND dead_lettered_at IS NULL)::integer AS pending,
                  COUNT(*) FILTER (WHERE processed_at IS NULL AND dead_lettered_at IS NULL AND attempts > 0)::integer AS retrying,
                  COUNT(*) FILTER (WHERE dead_lettered_at IS NOT NULL)::integer AS dead_lettered
             FROM outbox_events`,
        ),
      ]);
      response.json({
        inventory: {
          lowStockProducts: inventory.rows[0]?.low_stock_products ?? 0,
          zeroStockProducts: inventory.rows[0]?.zero_stock_products ?? 0,
        },
        orders: orders.rows.map((entry) => ({ count: entry.count, status: entry.status })),
        outbox: {
          deadLettered: outbox.rows[0]?.dead_lettered ?? 0,
          pending: outbox.rows[0]?.pending ?? 0,
          retrying: outbox.rows[0]?.retrying ?? 0,
        },
      });
    }),
  );

  router.get(
    "/admin/sellers",
    asyncRoute(async (request, response) => {
      const parsed = sellerListSchema.safeParse(request.query);
      if (!parsed.success) throw invalidRequest();
      const user = await requireAuthenticatedUser(request);
      requireAnyRole(user, ["ADMIN"]);
      const values: unknown[] = [];
      const condition = parsed.data.approvalStatus
        ? (values.push(parsed.data.approvalStatus), `WHERE seller_profiles.approval_status = $${values.length}`)
        : "";
      const sellers = await query<{
        approval_status: string;
        created_at: Date;
        description: string | null;
        email: string;
        full_name: string;
        id: string;
        store_name: string;
      }>(
        `SELECT seller_profiles.user_id AS id, seller_profiles.store_name, seller_profiles.description,
                seller_profiles.approval_status, seller_profiles.created_at, users.full_name, users.email
           FROM seller_profiles
           JOIN users ON users.id = seller_profiles.user_id AND users.deleted_at IS NULL
           ${condition}
          ORDER BY seller_profiles.created_at ASC`,
        values,
      );
      response.json({ items: sellers.rows.map((seller) => ({
        approvalStatus: seller.approval_status,
        createdAt: seller.created_at.toISOString(),
        description: seller.description,
        email: seller.email,
        fullName: seller.full_name,
        id: seller.id,
        storeName: seller.store_name,
      })) });
    }),
  );

  router.get(
    "/admin/reviews",
    asyncRoute(async (request, response) => {
      const parsed = reviewListSchema.safeParse(request.query);
      if (!parsed.success) throw invalidRequest();
      const user = await requireAuthenticatedUser(request);
      requireAnyRole(user, ["ADMIN", "SUPPORT"]);
      const reviews = await query<{
        body: string;
        buyer_name: string;
        created_at: Date;
        id: string;
        product_title: string;
        rating: number;
        status: string;
        title: string;
      }>(
        `SELECT product_reviews.id, product_reviews.rating, product_reviews.title, product_reviews.body,
                product_reviews.status, product_reviews.created_at, users.full_name AS buyer_name,
                products.title AS product_title
           FROM product_reviews
           JOIN users ON users.id = product_reviews.buyer_id AND users.deleted_at IS NULL
           JOIN products ON products.id = product_reviews.product_id AND products.deleted_at IS NULL
          WHERE product_reviews.status = $1
          ORDER BY product_reviews.created_at ASC
          LIMIT $2`,
        [parsed.data.status, parsed.data.limit],
      );
      response.json({ items: reviews.rows.map((review) => ({
        buyerName: review.buyer_name,
        createdAt: review.created_at.toISOString(),
        id: review.id,
        productTitle: review.product_title,
        rating: review.rating,
        status: review.status,
        text: review.body,
        title: review.title,
      })) });
    }),
  );

  router.post(
    "/admin/categories",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const parsed = categorySchema.safeParse(request.body);
      if (!parsed.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      requireAnyRole(user, ["ADMIN"]);
      const category = await query<{ id: string }>(
        "INSERT INTO categories(name, slug) VALUES ($1, $2) RETURNING id",
        [parsed.data.name, parsed.data.slug],
      );
      const createdCategory = category.rows[0];
      if (!createdCategory) {
        throw new AppError(503, "BACKEND_UNAVAILABLE");
      }
      await invalidatePublicCatalogCache();
      response.status(201).json({ id: createdCategory.id });
    }),
  );

  router.post(
    "/admin/sellers/:id/approval",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const sellerId = z.string().uuid().safeParse(request.params.id);
      const status = z.object({ status: z.enum(["APPROVED", "REJECTED"]) }).safeParse(request.body);
      if (!sellerId.success || !status.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      requireAnyRole(user, ["ADMIN"]);
      await transaction(async (client) => {
        const updated = await client.query<{ user_id: string }>(
          "UPDATE seller_profiles SET approval_status = $2, updated_at = now() WHERE user_id = $1 RETURNING user_id",
          [sellerId.data, status.data.status],
        );
        if (!updated.rows[0]) {
          throw new AppError(404, "NOT_FOUND");
        }
        await client.query(
          `INSERT INTO audit_events(actor_user_id, action, target_type, target_id, metadata)
           VALUES ($1, 'SELLER_APPROVAL_CHANGED', 'USER', $2, jsonb_build_object('status', $3::text))`,
          [user.id, sellerId.data, status.data.status],
        );
      });
      await invalidatePublicCatalogCache();
      response.status(204).send();
    }),
  );

  router.post(
    "/admin/coupons",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const parsed = couponSchema.safeParse(request.body);
      if (!parsed.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      requireAnyRole(user, ["ADMIN"]);
      const coupon = parsed.data;
      const created = await query<{ id: string }>(
        `INSERT INTO coupons(code, scope, seller_id, discount_type, discount_value, minimum_order_cents,
                             usage_limit, starts_at, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()), $9, $10)
         RETURNING id`,
        [coupon.code, coupon.scope, coupon.sellerId ?? null, coupon.discountType, coupon.discountValue, coupon.minimumOrderCents, coupon.usageLimit ?? null, coupon.startsAt ?? null, coupon.expiresAt ?? null, user.id],
      );
      const createdCoupon = created.rows[0];
      if (!createdCoupon) {
        throw new AppError(503, "BACKEND_UNAVAILABLE");
      }
      response.status(201).json({ id: createdCoupon.id });
    }),
  );

  router.post(
    "/seller/coupons",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const parsed = sellerCouponSchema.safeParse(request.body);
      if (!parsed.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      requireAnyRole(user, ["SELLER"]);
      const approval = await query<{ approval_status: string }>("SELECT approval_status FROM seller_profiles WHERE user_id = $1", [user.id]);
      if (approval.rows[0]?.approval_status !== "APPROVED") {
        throw new AppError(403, "FORBIDDEN");
      }
      const coupon = parsed.data;
      const created = await transaction(async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO coupons(code, scope, seller_id, discount_type, discount_value, minimum_order_cents,
                               usage_limit, starts_at, expires_at, created_by)
           VALUES ($1, 'SELLER', $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8, $2)
           RETURNING id`,
          [coupon.code, user.id, coupon.discountType, coupon.discountValue, coupon.minimumOrderCents, coupon.usageLimit ?? null, coupon.startsAt ?? null, coupon.expiresAt ?? null],
        );
        const createdCoupon = result.rows[0];
        if (!createdCoupon) {
          throw new AppError(503, "BACKEND_UNAVAILABLE");
        }
        await enqueueDomainEvent(client, {
          aggregateId: createdCoupon.id,
          aggregateType: "COUPON",
          eventType: "ProductUpdated",
          payload: { couponId: createdCoupon.id, sellerId: user.id },
        });
        return createdCoupon.id;
      });
      response.status(201).json({ id: created });
    }),
  );
}
