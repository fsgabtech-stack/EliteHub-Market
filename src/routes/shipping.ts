import type { Router } from "express";
import { z } from "zod";

import { asyncRoute, invalidRequest } from "../http/errors.js";
import { shippingQuotesTotal } from "../observability/metrics.js";
import { cotarFrete } from "../modules/shipping/shipping-service.js";

const quoteSchema = z.object({
  postalCode: z.string().regex(/^\d{8}$/),
  state: z.string().regex(/^[A-Z]{2}$/),
});

export function registerShippingRoutes(router: Router): void {
  router.get(
    "/shipping/quote",
    asyncRoute(async (request, response) => {
      const parsed = quoteSchema.safeParse(request.query);
      if (!parsed.success) {
        throw invalidRequest();
      }
      const quote = cotarFrete(parsed.data);
      shippingQuotesTotal.inc({ region: quote.region });
      response.json({ quote });
    }),
  );
}
