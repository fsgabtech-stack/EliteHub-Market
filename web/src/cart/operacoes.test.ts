import { describe, expect, it, vi } from "vitest";

import type { Carrinho } from "../types";
import { definirQuantidade, removerItem } from "./operacoes";

const cart: Carrinho = {
  id: "carrinho-1",
  items: [{ id: "item-1", imageUrl: null, product: { id: "produto-1", title: "Produto" }, quantity: 2, stockQuantity: 3, unitPriceCents: 1000, variant: { attributes: { cor: "Azul" }, id: "variacao-1" } }],
  subtotalCents: 2000,
};

describe("operações persistentes do carrinho", () => {
  it("atualiza a quantidade do item pela API", async () => {
    const requisicao = vi.fn().mockResolvedValue({ cart });
    const item = cart.items[0];
    if (!item) throw new Error("Fixture de carrinho sem item.");
    await expect(definirQuantidade(requisicao, item, 3)).resolves.toEqual(cart);
    expect(requisicao).toHaveBeenCalledWith("/api/v1/cart/items", {
      body: JSON.stringify({ productId: "produto-1", quantity: 3, variantId: "variacao-1" }),
      method: "PUT",
    });
  });

  it("remove o item pela API", async () => {
    const requisicao = vi.fn().mockResolvedValue({ cart: { ...cart, items: [] } });
    await expect(removerItem(requisicao, "item-1")).resolves.toEqual({ ...cart, items: [] });
    expect(requisicao).toHaveBeenCalledWith("/api/v1/cart/items/item-1", { method: "DELETE" });
  });
});
