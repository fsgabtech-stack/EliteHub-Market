import type { Carrinho } from "../types";
import type { RequisicaoDoMercado } from "../auth/pending-action";

export type CheckoutResponse = { payment: { integrationPending: boolean } };

export function checkoutDisponivel(cart: Carrinho | null, addressId: string | undefined): boolean {
  return Boolean(addressId && cart?.items.length);
}

export async function enviarCheckout(
  requisicao: RequisicaoDoMercado,
  input: { addressId: string; couponCode?: string; paymentMethod: "BOLETO" | "CREDIT_CARD" | "PIX" },
  idempotencyKey: string,
): Promise<CheckoutResponse> {
  return requisicao<CheckoutResponse>("/api/v1/checkout", {
    body: JSON.stringify(input),
    headers: { "idempotency-key": idempotencyKey },
    method: "POST",
  });
}
