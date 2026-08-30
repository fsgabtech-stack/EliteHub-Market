import type { PoolClient } from "pg";

import { transaction } from "../../db/pool.js";
import { AppError } from "../../http/errors.js";

type CartRow = {
  created_at: Date;
  id: string;
  updated_at: Date;
};

type CartItemRow = {
  id: string;
  image_url: string | null;
  price_cents: number;
  product_id: string;
  product_title: string;
  quantity: number;
  stock_quantity: number;
  variant_attributes: Record<string, unknown> | null;
  variant_id: string | null;
  variant_price_cents: number | null;
  variant_stock_quantity: number | null;
};

export type CartView = {
  createdAt: string;
  id: string;
  items: Array<{
    id: string;
    imageUrl: string | null;
    product: { id: string; title: string };
    quantity: number;
    stockQuantity: number;
    unitPriceCents: number;
    variant: { attributes: Record<string, unknown>; id: string } | null;
  }>;
  subtotalCents: number;
  updatedAt: string;
};

async function getOrCreateActiveCart(client: PoolClient, userId: string): Promise<CartRow> {
  await client.query(
    `INSERT INTO carts(user_id, status)
     VALUES ($1, 'ACTIVE')
     ON CONFLICT DO NOTHING`,
    [userId],
  );
  const result = await client.query<CartRow>(
    `SELECT id, created_at, updated_at
     FROM carts
     WHERE user_id = $1 AND status = 'ACTIVE'
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`,
    [userId],
  );
  const cart = result.rows[0];
  if (!cart) {
    throw new AppError(409, "CONFLICT");
  }
  return cart;
}

async function readCart(client: PoolClient, cart: CartRow): Promise<CartView> {
  const items = await client.query<CartItemRow>(
    `SELECT cart_items.id, cart_items.product_id, cart_items.variant_id, cart_items.quantity,
            products.title AS product_title, products.image_url, products.price_cents,
            products.stock_quantity, product_variants.attributes AS variant_attributes,
            product_variants.price_cents AS variant_price_cents,
            product_variants.stock_quantity AS variant_stock_quantity
       FROM cart_items
       JOIN products ON products.id = cart_items.product_id
       LEFT JOIN product_variants ON product_variants.id = cart_items.variant_id
      WHERE cart_items.cart_id = $1
      ORDER BY cart_items.created_at ASC`,
    [cart.id],
  );
  const shapedItems = items.rows.map((item) => {
    const unitPriceCents = item.variant_price_cents ?? item.price_cents;
    return {
      id: item.id,
      imageUrl: item.image_url,
      product: { id: item.product_id, title: item.product_title },
      quantity: item.quantity,
      stockQuantity: item.variant_stock_quantity ?? item.stock_quantity,
      unitPriceCents,
      variant: item.variant_id ? { attributes: item.variant_attributes ?? {}, id: item.variant_id } : null,
    };
  });
  return {
    createdAt: cart.created_at.toISOString(),
    id: cart.id,
    items: shapedItems,
    subtotalCents: shapedItems.reduce((total, item) => total + item.quantity * item.unitPriceCents, 0),
    updatedAt: cart.updated_at.toISOString(),
  };
}

export async function getActiveCart(userId: string): Promise<CartView> {
  return transaction(async (client) => readCart(client, await getOrCreateActiveCart(client, userId)));
}

export async function setCartItem(input: {
  productId: string;
  quantity: number;
  userId: string;
  variantId?: string | undefined;
}): Promise<CartView> {
  return transaction(async (client) => {
    const cart = await getOrCreateActiveCart(client, input.userId);
    const inventory = await client.query<{
      product_stock: number;
      variant_id: string | null;
      variant_stock: number | null;
    }>(
      `SELECT products.stock_quantity AS product_stock, product_variants.id AS variant_id,
              product_variants.stock_quantity AS variant_stock
         FROM products
         LEFT JOIN product_variants
           ON product_variants.id = $2 AND product_variants.product_id = products.id
        WHERE products.id = $1
          AND products.status = 'ACTIVE'
          AND products.deleted_at IS NULL
        FOR UPDATE OF products`,
      [input.productId, input.variantId ?? null],
    );
    const product = inventory.rows[0];
    if (!product || (input.variantId && product.variant_id !== input.variantId)) {
      throw new AppError(404, "NOT_FOUND");
    }
    const stockQuantity = product.variant_stock ?? product.product_stock;
    if (input.quantity > stockQuantity) {
      throw new AppError(409, "INVENTORY_UNAVAILABLE");
    }
    await client.query(
      `INSERT INTO cart_items(cart_id, product_id, variant_id, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cart_id, product_id, variant_id)
       DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
      [cart.id, input.productId, input.variantId ?? null, input.quantity],
    );
    await client.query("UPDATE carts SET updated_at = now() WHERE id = $1", [cart.id]);
    return readCart(client, cart);
  });
}

export async function removeCartItem(userId: string, cartItemId: string): Promise<CartView> {
  return transaction(async (client) => {
    const cart = await getOrCreateActiveCart(client, userId);
    await client.query("DELETE FROM cart_items WHERE id = $1 AND cart_id = $2", [cartItemId, cart.id]);
    await client.query("UPDATE carts SET updated_at = now() WHERE id = $1", [cart.id]);
    return readCart(client, cart);
  });
}
