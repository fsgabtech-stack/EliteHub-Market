import type { Router } from "express";
import { z } from "zod";

import { requireAuthenticatedUser, requireVerifiedEmail } from "../http/authorization.js";
import { asyncRoute, invalidRequest } from "../http/errors.js";
import { csrfProtection } from "../http/security.js";
import { createCheckout } from "../modules/checkout/checkout-service.js";
import { checkoutOrdersCreatedTotal } from "../observability/metrics.js";

const checkoutSchema = z.object({
  addressId: z.string().uuid(),
  couponCode: z.string().trim().min(3).max(64).optional(),
  paymentMethod: z.enum(["PIX", "CREDIT_CARD", "BOLETO"]),
});

export function registerCheckoutRoutes(router: Router): void {
  router.post(
    "/checkout",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const parsed = checkoutSchema.safeParse(request.body);
      const idempotencyKey = z.string().uuid().safeParse(request.get("idempotency-key"));
      if (!parsed.success || !idempotencyKey.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      requireVerifiedEmail(user);
      const checkout = await createCheckout({ ...parsed.data, idempotencyKey: idempotencyKey.data, userId: user.id });
      if (!checkout.replayed) {
        checkoutOrdersCreatedTotal.inc({ modo_pagamento: parsed.data.paymentMethod });
      }
      response.status(checkout.replayed ? 200 : 201).json(checkout.result);
    }),
  );
}
