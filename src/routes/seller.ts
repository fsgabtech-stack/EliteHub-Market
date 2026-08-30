import type { Router } from "express";
import { z } from "zod";

import { query, transaction } from "../db/pool.js";
import { requireAnyRole, requireAuthenticatedUser, requireVerifiedEmail } from "../http/authorization.js";
import { AppError, asyncRoute, invalidRequest } from "../http/errors.js";
import { csrfProtection } from "../http/security.js";
import { enqueueDomainEvent } from "../modules/events/outbox.js";

const sellerProfileSchema = z.object({
  description: z.string().trim().min(20).max(5_000).optional(),
  legalName: z.string().trim().min(3).max(180).optional(),
  storeName: z.string().trim().min(3).max(160),
  supportEmail: z.string().trim().toLowerCase().email().max(320).optional(),
});

const productSchema = z.object({
  attributes: z.record(z.string(), z.unknown()).default({}),
  categoryId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(20).max(20_000),
  priceCents: z.number().int().min(0).max(100_000_000),
  sku: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]).default("DRAFT"),
  stockQuantity: z.number().int().min(0).max(10_000_000),
  title: z.string().trim().min(3).max(200),
});

const productUpdateSchema = productSchema.omit({ stockQuantity: true });

const variantSchema = z.object({
  attributes: z.record(z.string(), z.unknown()),
  priceCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  sku: z.string().trim().min(1).max(100).optional(),
  stockQuantity: z.number().int().min(0).max(10_000_000),
});

async function requireApprovedSeller(userId: string): Promise<void> {
  const profile = await query<{ approval_status: string }>(
    "SELECT approval_status FROM seller_profiles WHERE user_id = $1",
    [userId],
  );
  if (profile.rows[0]?.approval_status !== "APPROVED") {
    throw new AppError(403, "FORBIDDEN");
  }
}

export function registerSellerRoutes(router: Router): void {
  router.get(
    "/seller/profile",
    asyncRoute(async (request, response) => {
      const user = await requireAuthenticatedUser(request);
      requireAnyRole(user, ["SELLER"]);
      const profile = await query<{
        approval_status: string;
        description: string | null;
        legal_name: string | null;
        store_name: string;
        support_email: string | null;
      }>(
        `SELECT store_name, legal_name, description, support_email, approval_status
           FROM seller_profiles WHERE user_id = $1`,
        [user.id],
      );
      if (!profile.rows[0]) {
        throw new AppError(404, "NOT_FOUND");
      }
      const value = profile.rows[0];
      response.json({
        profile: {
          approvalStatus: value.approval_status,
          description: value.description,
          legalName: value.legal_name,
          storeName: value.store_name,
          supportEmail: value.support_email,
        },
      });
    }),
  );

  router.post(
    "/seller/onboarding",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const parsed = sellerProfileSchema.safeParse(request.body);
      if (!parsed.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      requireVerifiedEmail(user);
      const profile = parsed.data;
      await transaction(async (client) => {
        await client.query("INSERT INTO user_roles(user_id, role) VALUES ($1, 'SELLER') ON CONFLICT DO NOTHING", [user.id]);
        await client.query(
          `INSERT INTO seller_profiles(user_id, store_name, legal_name, description, support_email, approval_status)
           VALUES ($1, $2, $3, $4, $5, 'PENDING')
           ON CONFLICT (user_id) DO UPDATE SET
             store_name = EXCLUDED.store_name,
             legal_name = EXCLUDED.legal_name,
             description = EXCLUDED.description,
             support_email = EXCLUDED.support_email,
             approval_status = CASE WHEN seller_profiles.approval_status = 'APPROVED' THEN 'APPROVED' ELSE 'PENDING' END,
             updated_at = now()`,
          [user.id, profile.storeName, profile.legalName ?? null, profile.description ?? null, profile.supportEmail ?? null],
        );
        await client.query(
          `INSERT INTO audit_events(actor_user_id, action, target_type, target_id)
           VALUES ($1, 'SELLER_ONBOARDING_SUBMITTED', 'USER', $1)`,
          [user.id],
        );
      });
      response.status(202).json({ message: "Cadastro de vendedor enviado para aprovação." });
    }),
  );

  router.post(
    "/seller/products",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const parsed = productSchema.safeParse(request.body);
      if (!parsed.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      requireAnyRole(user, ["SELLER"]);
      requireVerifiedEmail(user);
      await requireApprovedSeller(user.id);
      const product = parsed.data;
      const created = await transaction(async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO products(seller_id, category_id, title, description, price_cents, stock_quantity, status, sku, attributes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
           RETURNING id`,
          [user.id, product.categoryId ?? null, product.title, product.description, product.priceCents, product.stockQuantity, product.status, product.sku ?? null, JSON.stringify(product.attributes)],
        );
        const createdProduct = result.rows[0];
        if (!createdProduct) {
          throw new AppError(503, "BACKEND_UNAVAILABLE");
        }
        const productId = createdProduct.id;
        if (product.stockQuantity > 0) {
          await client.query(
            `INSERT INTO inventory_movements(product_id, delta, reason, actor_user_id)
             VALUES ($1, $2, 'INITIAL_STOCK', $3)`,
            [productId, product.stockQuantity, user.id],
          );
        }
        await enqueueDomainEvent(client, {
          aggregateId: productId,
          aggregateType: "PRODUCT",
          eventType: "ProductUpdated",
          payload: { productId, sellerId: user.id },
        });
        return productId;
      });
      response.status(201).json({ id: created });
    }),
  );

  router.put(
    "/seller/products/:id",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const productId = z.string().uuid().safeParse(request.params.id);
      const parsed = productUpdateSchema.safeParse(request.body);
      if (!productId.success || !parsed.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      requireAnyRole(user, ["SELLER"]);
      requireVerifiedEmail(user);
      await requireApprovedSeller(user.id);
      const product = parsed.data;
      const updated = await query<{ id: string }>(
        `UPDATE products
            SET category_id = $3, title = $4, description = $5, price_cents = $6,
                status = $7, sku = $8, attributes = $9::jsonb, updated_at = now()
          WHERE id = $1 AND seller_id = $2 AND deleted_at IS NULL
          RETURNING id`,
        [productId.data, user.id, product.categoryId ?? null, product.title, product.description, product.priceCents, product.status, product.sku ?? null, JSON.stringify(product.attributes)],
      );
      if (!updated.rows[0]) {
        throw new AppError(404, "NOT_FOUND");
      }
      response.status(204).send();
    }),
  );

  router.post(
    "/seller/products/:id/variants",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const productId = z.string().uuid().safeParse(request.params.id);
      const parsed = variantSchema.safeParse(request.body);
      if (!productId.success || !parsed.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      requireAnyRole(user, ["SELLER"]);
      requireVerifiedEmail(user);
      await requireApprovedSeller(user.id);
      const variant = parsed.data;
      const created = await query<{ id: string }>(
        `INSERT INTO product_variants(product_id, sku, attributes, price_cents, stock_quantity)
         SELECT $1, $3, $4::jsonb, $5, $6
          WHERE EXISTS (SELECT 1 FROM products WHERE id = $1 AND seller_id = $2 AND deleted_at IS NULL)
         RETURNING id`,
        [productId.data, user.id, variant.sku ?? null, JSON.stringify(variant.attributes), variant.priceCents ?? null, variant.stockQuantity],
      );
      if (!created.rows[0]) {
        throw new AppError(404, "NOT_FOUND");
      }
      response.status(201).json({ id: created.rows[0].id });
    }),
  );

  router.post(
    "/seller/products/:id/stock-adjustments",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const productId = z.string().uuid().safeParse(request.params.id);
      const body = z.object({ delta: z.number().int().min(-1_000_000).max(1_000_000).refine((value) => value !== 0), reason: z.string().trim().min(3).max(40), variantId: z.string().uuid().optional() }).safeParse(request.body);
      if (!productId.success || !body.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      requireAnyRole(user, ["SELLER"]);
      requireVerifiedEmail(user);
      await requireApprovedSeller(user.id);
      await transaction(async (client) => {
        const ownership = await client.query<{ id: string }>("SELECT id FROM products WHERE id = $1 AND seller_id = $2 FOR KEY SHARE", [productId.data, user.id]);
        if (!ownership.rows[0]) {
          throw new AppError(404, "NOT_FOUND");
        }
        const updated = body.data.variantId
          ? await client.query<{ id: string }>(
            `UPDATE product_variants
                SET stock_quantity = stock_quantity + $3, updated_at = now()
              WHERE id = $1 AND product_id = $2 AND stock_quantity + $3 >= 0
              RETURNING id`,
            [body.data.variantId, productId.data, body.data.delta],
          )
          : await client.query<{ id: string }>(
            `UPDATE products
                SET stock_quantity = stock_quantity + $2, updated_at = now()
              WHERE id = $1 AND stock_quantity + $2 >= 0
              RETURNING id`,
            [productId.data, body.data.delta],
          );
        if (!updated.rows[0]) {
          throw new AppError(409, "INVENTORY_UNAVAILABLE");
        }
        await client.query(
          `INSERT INTO inventory_movements(product_id, variant_id, delta, reason, actor_user_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [productId.data, body.data.variantId ?? null, body.data.delta, body.data.reason, user.id],
        );
        await enqueueDomainEvent(client, {
          aggregateId: productId.data,
          aggregateType: "PRODUCT",
          eventType: "InventoryUpdated",
          payload: { productId: productId.data, variantId: body.data.variantId ?? null },
        });
      });
      response.status(204).send();
    }),
  );
}
