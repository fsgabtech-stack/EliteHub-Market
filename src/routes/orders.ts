import type { Router } from "express";
import { z } from "zod";

import { requireAuthenticatedUser } from "../http/authorization.js";
import { assertOrderStatus } from "../domain/orders/order-status.js";
import { asyncRoute, invalidRequest } from "../http/errors.js";
import { csrfProtection } from "../http/security.js";
import { getOrder, listOrders, transitionOrderStatus } from "../modules/orders/order-service.js";

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  scope: z.enum(["mine", "received"]).default("mine"),
});

const transitionSchema = z.object({
  reason: z.string().trim().min(3).max(300).optional(),
  status: z.string(),
});

export function registerOrderRoutes(router: Router): void {
  router.get(
    "/orders",
    asyncRoute(async (request, response) => {
      const parsed = listSchema.safeParse(request.query);
      if (!parsed.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      response.json({ items: await listOrders({ ...parsed.data, user }) });
    }),
  );

  router.get(
    "/orders/:id",
    asyncRoute(async (request, response) => {
      const id = z.string().uuid().safeParse(request.params.id);
      if (!id.success) {
        throw invalidRequest();
      }
      response.json({ order: await getOrder(await requireAuthenticatedUser(request), id.data) });
    }),
  );

  router.post(
    "/orders/:id/status",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const id = z.string().uuid().safeParse(request.params.id);
      const parsed = transitionSchema.safeParse(request.body);
      if (!id.success || !parsed.success) {
        throw invalidRequest();
      }
      try {
        assertOrderStatus(parsed.data.status);
      } catch {
        throw invalidRequest();
      }
      const result = await transitionOrderStatus({
        orderId: id.data,
        reason: parsed.data.reason,
        targetStatus: parsed.data.status,
        user: await requireAuthenticatedUser(request),
      });
      response.json(result);
    }),
  );
}
