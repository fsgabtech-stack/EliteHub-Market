import { describe, expect, it, vi } from "vitest";

import type { Carrinho } from "../types";
import { checkoutDisponivel, enviarCheckout } from "./submit-checkout";

const cart: Carrinho = {
  id: "carrinho-1",
  items: [{ id: "item-1", imageUrl: null, product: { id: "produto-1", title: "Produto" }, quantity: 1, stockQuantity: 3, unitPriceCents: 1000, variant: null }],
  subtotalCents: 1000,
};

describe("envio de checkout", () => {
  it("bloqueia estado sem endereço ou sem itens", () => {
    expect(checkoutDisponivel(null, "endereco-1")).toBe(false);
    expect(checkoutDisponivel({ ...cart, items: [] }, "endereco-1")).toBe(false);
    expect(checkoutDisponivel(cart, undefined)).toBe(false);
    expect(checkoutDisponivel(cart, "endereco-1")).toBe(true);
  });

  it("envia endereço, método e chave de idempotência para a API", async () => {
    const requisicao = vi.fn().mockResolvedValue({ payment: { integrationPending: true } });
    await expect(enviarCheckout(requisicao, { addressId: "endereco-1", paymentMethod: "PIX" }, "00000000-0000-4000-8000-000000000001")).resolves.toEqual({ payment: { integrationPending: true } });
    expect(requisicao).toHaveBeenCalledWith("/api/v1/checkout", {
      body: JSON.stringify({ addressId: "endereco-1", paymentMethod: "PIX" }),
      headers: { "idempotency-key": "00000000-0000-4000-8000-000000000001" },
      method: "POST",
    });
  });
});
