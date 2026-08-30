import type { Router } from "express";
import { z } from "zod";

import { query, transaction } from "../db/pool.js";
import { requireAnyRole, requireAuthenticatedUser } from "../http/authorization.js";
import { AppError, asyncRoute, invalidRequest } from "../http/errors.js";
import { csrfProtection } from "../http/security.js";
import { enqueueDomainEvent } from "../modules/events/outbox.js";

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

export function registerAdminRoutes(router: Router): void {
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
           VALUES ($1, 'SELLER_APPROVAL_CHANGED', 'USER', $2, jsonb_build_object('status', $3))`,
          [user.id, sellerId.data, status.data.status],
        );
      });
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
