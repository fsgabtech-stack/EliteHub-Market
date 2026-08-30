export const orderStatuses = [
  "CREATED",
  "PENDING_PAYMENT",
  "PAID",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
  "FAILED",
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

const allowedTransitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  CANCELLED: [],
  CREATED: ["PENDING_PAYMENT", "FAILED", "CANCELLED"],
  DELIVERED: ["REFUNDED"],
  FAILED: [],
  PAID: ["PROCESSING", "REFUNDED"],
  PENDING_PAYMENT: ["PAID", "FAILED", "CANCELLED"],
  PROCESSING: ["SHIPPED", "REFUNDED"],
  REFUNDED: [],
  SHIPPED: ["DELIVERED", "REFUNDED"],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertOrderStatus(value: string): asserts value is OrderStatus {
  if (!orderStatuses.includes(value as OrderStatus)) {
    throw new Error("Status de pedido inválido.");
  }
}
