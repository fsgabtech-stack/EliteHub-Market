import type { PoolClient } from "pg";

export async function releasePendingOrderResources(client: PoolClient, orderId: string): Promise<boolean> {
  const reservations = await client.query<{
    product_id: string;
    quantity: number;
    variant_id: string | null;
  }>(
    `SELECT product_id, variant_id, quantity
       FROM inventory_reservations
      WHERE order_id = $1 AND status = 'ACTIVE'
      FOR UPDATE`,
    [orderId],
  );
  for (const reservation of reservations.rows) {
    if (reservation.variant_id) {
      await client.query(
        "UPDATE product_variants SET stock_quantity = stock_quantity + $2, updated_at = now() WHERE id = $1",
        [reservation.variant_id, reservation.quantity],
      );
    } else {
      await client.query(
        "UPDATE products SET stock_quantity = stock_quantity + $2, updated_at = now() WHERE id = $1",
        [reservation.product_id, reservation.quantity],
      );
    }
    await client.query(
      `INSERT INTO inventory_movements(product_id, variant_id, delta, reason, order_id)
       VALUES ($1, $2, $3, 'RESERVATION_RELEASED', $4)`,
      [reservation.product_id, reservation.variant_id, reservation.quantity, orderId],
    );
  }
  if (reservations.rows.length > 0) {
    await client.query(
      "UPDATE inventory_reservations SET status = 'RELEASED', released_at = now() WHERE order_id = $1 AND status = 'ACTIVE'",
      [orderId],
    );
  }

  const redemptions = await client.query<{ coupon_id: string }>(
    "DELETE FROM coupon_redemptions WHERE order_id = $1 RETURNING coupon_id",
    [orderId],
  );
  for (const redemption of redemptions.rows) {
    await client.query(
      "UPDATE coupons SET usage_count = GREATEST(usage_count - 1, 0), updated_at = now() WHERE id = $1",
      [redemption.coupon_id],
    );
  }
  return reservations.rows.length > 0 || redemptions.rows.length > 0;
}
