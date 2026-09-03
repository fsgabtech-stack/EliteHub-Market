import type { Router } from "express";
import { z } from "zod";

import { requireAuthenticatedUser } from "../http/authorization.js";
import { asyncRoute, invalidRequest } from "../http/errors.js";
import { csrfProtection } from "../http/security.js";
import { afterSalesStatuses, afterSalesTypes, createAfterSalesRequest, listAfterSalesRequests, transitionAfterSalesRequest } from "../modules/orders/after-sales-service.js";
import { afterSalesRequestsTotal, afterSalesTransitionsTotal } from "../observability/metrics.js";

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  scope: z.enum(["mine", "received", "queue"]).default("mine"),
});

const createSchema = z.object({
  reason: z.string().trim().min(20).max(1_000),
  requestType: z.enum(afterSalesTypes),
});

const transitionSchema = z.object({
  note: z.string().trim().min(3).max(1_000).optional(),
  status: z.enum(afterSalesStatuses),
});

export function registerAfterSalesRoutes(router: Router): void {
  router.get(
    "/after-sales",
    asyncRoute(async (request, response) => {
      const parsed = listSchema.safeParse(request.query);
      if (!parsed.success) throw invalidRequest();
      response.json({ items: await listAfterSalesRequests({ ...parsed.data, user: await requireAuthenticatedUser(request) }) });
    }),
  );

  router.post(
    "/orders/:id/after-sales-requests",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const orderId = z.string().uuid().safeParse(request.params.id);
      const parsed = createSchema.safeParse(request.body);
      if (!orderId.success || !parsed.success) throw invalidRequest();
      const created = await createAfterSalesRequest({ ...parsed.data, orderId: orderId.data, user: await requireAuthenticatedUser(request) });
      afterSalesRequestsTotal.inc({ tipo: parsed.data.requestType });
      response.status(201).json(created);
    }),
  );

  router.patch(
    "/after-sales/:id",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const id = z.string().uuid().safeParse(request.params.id);
      const parsed = transitionSchema.safeParse(request.body);
      if (!id.success || !parsed.success) throw invalidRequest();
      const user = await requireAuthenticatedUser(request);
      const result = await transitionAfterSalesRequest({ ...parsed.data, id: id.data, user });
      const actor = user.roles.includes("ADMIN") || user.roles.includes("SUPPORT") ? "OPERACAO" : user.roles.includes("SELLER") ? "VENDEDOR" : "CLIENTE";
      afterSalesTransitionsTotal.inc({ ator: actor, destino: result.status });
      response.json(result);
    }),
  );
}
