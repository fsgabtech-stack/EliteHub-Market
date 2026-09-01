import type { Router } from "express";

import { asyncRoute } from "../http/errors.js";
import { paymentAvailability } from "../modules/payments/payment-availability.js";

export function registerPaymentRoutes(router: Router): void {
  router.get(
    "/payments/availability",
    asyncRoute(async (_request, response) => {
      response.json(paymentAvailability());
    }),
  );
}
