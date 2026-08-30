import type { Router } from "express";
import { z } from "zod";

import { query } from "../db/pool.js";
import { requireAuthenticatedUser } from "../http/authorization.js";
import { AppError, asyncRoute, invalidRequest } from "../http/errors.js";
import { csrfProtection } from "../http/security.js";

const addressSchema = z.object({
  city: z.string().trim().min(2).max(120),
  complement: z.string().trim().max(120).optional(),
  label: z.string().trim().min(2).max(80),
  neighborhood: z.string().trim().min(2).max(120),
  number: z.string().trim().min(1).max(30),
  postalCode: z.string().regex(/^\d{8}$/),
  recipientName: z.string().trim().min(3).max(160),
  state: z.string().regex(/^[A-Z]{2}$/),
  street: z.string().trim().min(2).max(180),
});

export function registerAddressRoutes(router: Router): void {
  router.get(
    "/addresses",
    asyncRoute(async (request, response) => {
      const user = await requireAuthenticatedUser(request);
      const addresses = await query<{
        city: string;
        complement: string | null;
        id: string;
        label: string;
        neighborhood: string;
        number: string;
        postal_code: string;
        recipient_name: string;
        state: string;
        street: string;
      }>(
        `SELECT id, label, recipient_name, postal_code, street, number, complement, neighborhood, city, state
           FROM addresses
          WHERE user_id = $1
          ORDER BY created_at DESC`,
        [user.id],
      );
      response.json({
        items: addresses.rows.map((address) => ({
          city: address.city,
          complement: address.complement,
          id: address.id,
          label: address.label,
          neighborhood: address.neighborhood,
          number: address.number,
          postalCode: address.postal_code,
          recipientName: address.recipient_name,
          state: address.state,
          street: address.street,
        })),
      });
    }),
  );

  router.post(
    "/addresses",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const parsed = addressSchema.safeParse(request.body);
      if (!parsed.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      const address = parsed.data;
      const created = await query<{ id: string }>(
        `INSERT INTO addresses(user_id, label, recipient_name, postal_code, street, number, complement, neighborhood, city, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          user.id,
          address.label,
          address.recipientName,
          address.postalCode,
          address.street,
          address.number,
          address.complement ?? null,
          address.neighborhood,
          address.city,
          address.state,
        ],
      );
      const createdAddress = created.rows[0];
      if (!createdAddress) {
        throw new AppError(503, "BACKEND_UNAVAILABLE");
      }
      response.status(201).json({ id: createdAddress.id });
    }),
  );
}
