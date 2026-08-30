export function calculatePercentageDiscount(subtotalCents: number, basisPoints: number): number {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) {
    throw new Error("Subtotal inválido.");
  }
  if (!Number.isInteger(basisPoints) || basisPoints < 1 || basisPoints > 10_000) {
    throw new Error("Percentual de desconto inválido.");
  }
  return Math.floor((subtotalCents * basisPoints) / 10_000);
}

export function calculateOrderTotal(
  subtotalCents: number,
  shippingCents: number,
  discountCents: number,
): number {
  if (![subtotalCents, shippingCents, discountCents].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Valores monetários inválidos.");
  }
  const total = subtotalCents + shippingCents - discountCents;
  if (total < 0) {
    throw new Error("O desconto não pode exceder o subtotal mais o frete.");
  }
  return total;
}
