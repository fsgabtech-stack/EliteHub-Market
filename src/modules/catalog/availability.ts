export const PUBLIC_AVAILABILITY = ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"] as const;

export type PublicAvailability = (typeof PUBLIC_AVAILABILITY)[number];

export function availabilityFromStock(stockQuantity: number): PublicAvailability {
  if (stockQuantity <= 0) {
    return "OUT_OF_STOCK";
  }
  if (stockQuantity <= 3) {
    return "LOW_STOCK";
  }
  return "IN_STOCK";
}

export function isAvailableForPurchase(availability: PublicAvailability): boolean {
  return availability !== "OUT_OF_STOCK";
}
