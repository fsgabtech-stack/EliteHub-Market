import type { Router } from "express";
import { z } from "zod";

import { query, transaction } from "../db/pool.js";
import { requireAuthenticatedUser } from "../http/authorization.js";
import { AppError, asyncRoute, invalidRequest } from "../http/errors.js";
import { csrfProtection } from "../http/security.js";
import { enqueueDomainEvent } from "../modules/events/outbox.js";

const consentSchema = z.object({
  granted: z.boolean(),
  purpose: z.enum(["ANALYTICS", "MARKETING", "SELLER_PROFILE"]),
});

const deletionSchema = z.object({ confirm: z.literal(true) });

export function registerAccountRoutes(router: Router): void {
  router.post(
    "/account/consents",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const parsed = consentSchema.safeParse(request.body);
      if (!parsed.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      await transaction(async (client) => {
        await client.query(
          `INSERT INTO privacy_consents(user_id, purpose, granted, legal_basis, revoked_at)
           VALUES ($1, $2, $3, 'CONSENT', CASE WHEN $3 THEN NULL ELSE now() END)`,
          [user.id, parsed.data.purpose, parsed.data.granted],
        );
        await client.query(
          `INSERT INTO audit_events(actor_user_id, action, target_type, target_id, metadata)
           VALUES ($1, 'PRIVACY_CONSENT_UPDATED', 'USER', $1, jsonb_build_object('purpose', $2::text, 'granted', $3::boolean))`,
          [user.id, parsed.data.purpose, parsed.data.granted],
        );
      });
      response.status(204).send();
    }),
  );

  router.get(
    "/account/data-export",
    asyncRoute(async (request, response) => {
      const user = await requireAuthenticatedUser(request);
      const [profile, roles, addresses, consents, orders] = await Promise.all([
        query<{ created_at: Date; email: string; email_verified_at: Date | null; full_name: string }>(
          "SELECT full_name, email, email_verified_at, created_at FROM users WHERE id = $1 AND deleted_at IS NULL",
          [user.id],
        ),
        query<{ role: string }>("SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role", [user.id]),
        query<Record<string, unknown>>(
          "SELECT label, recipient_name, postal_code, street, number, complement, neighborhood, city, state, created_at FROM addresses WHERE user_id = $1 ORDER BY created_at",
          [user.id],
        ),
        query<Record<string, unknown>>(
          "SELECT purpose, granted, legal_basis, granted_at, revoked_at FROM privacy_consents WHERE user_id = $1 ORDER BY granted_at",
          [user.id],
        ),
        query<Record<string, unknown>>(
          "SELECT order_number, status, payment_status, total_cents, created_at FROM orders WHERE buyer_id = $1 ORDER BY created_at",
          [user.id],
        ),
      ]);
      const identity = profile.rows[0];
      if (!identity) {
        throw new AppError(404, "NOT_FOUND");
      }
      response
        .setHeader("content-disposition", "attachment; filename=elitehub-dados-pessoais.json")
        .json({
          addresses: addresses.rows,
          consents: consents.rows,
          exportedAt: new Date().toISOString(),
          orders: orders.rows,
          profile: {
            createdAt: identity.created_at.toISOString(),
            email: identity.email,
            emailVerifiedAt: identity.email_verified_at?.toISOString() ?? null,
            fullName: identity.full_name,
            roles: roles.rows.map((role) => role.role),
          },
        });
    }),
  );

  router.post(
    "/account/deletion",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const parsed = deletionSchema.safeParse(request.body);
      if (!parsed.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      await transaction(async (client) => {
        const activeOrders = await client.query<{ id: string }>(
          `SELECT id
             FROM orders
            WHERE (buyer_id = $1 OR seller_id = $1)
              AND status NOT IN ('DELIVERED', 'CANCELLED', 'REFUNDED', 'FAILED')
            LIMIT 1
            FOR KEY SHARE`,
          [user.id],
        );
        if (activeOrders.rows[0]) {
          throw new AppError(409, "CONFLICT");
        }
        await client.query(
          `UPDATE addresses
              SET recipient_name = 'Dados removidos', postal_code = '00000000', street = 'Dados removidos',
                  number = '-', complement = NULL, neighborhood = 'Dados removidos', city = 'Dados removidos',
                  state = 'SP', updated_at = now()
            WHERE user_id = $1`,
          [user.id],
        );
        await client.query(
          `UPDATE seller_profiles
              SET store_name = CONCAT('conta-removida-', LEFT($1::text, 8)), legal_name = NULL,
                  description = NULL, support_email = NULL, updated_at = now()
            WHERE user_id = $1`,
          [user.id],
        );
        await client.query("UPDATE file_assets SET deleted_at = COALESCE(deleted_at, now()) WHERE owner_user_id = $1", [user.id]);
        await client.query("DELETE FROM oauth_identities WHERE user_id = $1", [user.id]);
        await client.query("DELETE FROM auth_login_failures WHERE email = (SELECT email FROM users WHERE id = $1)", [user.id]);
        await client.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [user.id]);
        await client.query(
          `UPDATE users
              SET full_name = 'Conta removida', email = CONCAT('deleted+', id::text, '@invalid.local'),
                  password_hash = NULL, email_verified_at = NULL, deleted_at = now(), anonymized_at = now(), updated_at = now()
            WHERE id = $1 AND deleted_at IS NULL`,
          [user.id],
        );
        await client.query(
          `INSERT INTO audit_events(actor_user_id, action, target_type, target_id)
           VALUES ($1, 'ACCOUNT_ANONYMIZED', 'USER', $1)`,
          [user.id],
        );
        await enqueueDomainEvent(client, {
          aggregateId: user.id,
          aggregateType: "USER",
          eventType: "FileDeletionRequested",
          payload: { userId: user.id },
        });
      });
      response.status(204).send();
    }),
  );
}
