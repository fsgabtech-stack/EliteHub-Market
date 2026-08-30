import type { Router } from "express";
import { z } from "zod";

import { requireAuthenticatedUser } from "../http/authorization.js";
import { asyncRoute, invalidRequest } from "../http/errors.js";
import { csrfProtection } from "../http/security.js";
import { getActiveCart, removeCartItem, setCartItem } from "../modules/cart/cart-service.js";

const cartItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100),
  variantId: z.string().uuid().optional(),
});

export function registerCartRoutes(router: Router): void {
  router.get(
    "/cart",
    asyncRoute(async (request, response) => {
      const user = await requireAuthenticatedUser(request);
      response.json({ cart: await getActiveCart(user.id) });
    }),
  );

  router.put(
    "/cart/items",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const parsed = cartItemSchema.safeParse(request.body);
      if (!parsed.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      response.json({ cart: await setCartItem({ ...parsed.data, userId: user.id }) });
    }),
  );

  router.delete(
    "/cart/items/:id",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const itemId = z.string().uuid().safeParse(request.params.id);
      if (!itemId.success) {
        throw invalidRequest();
      }
      const user = await requireAuthenticatedUser(request);
      response.json({ cart: await removeCartItem(user.id, itemId.data) });
    }),
  );
}
