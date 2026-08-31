import type { RequisicaoDoMercado } from "../auth/pending-action";
import type { Carrinho } from "../types";

export async function definirQuantidade(
  requisicao: RequisicaoDoMercado,
  item: Carrinho["items"][number],
  quantity: number,
): Promise<Carrinho> {
  const result = await requisicao<{ cart: Carrinho }>("/api/v1/cart/items", {
    body: JSON.stringify({ productId: item.product.id, quantity, ...(item.variant ? { variantId: item.variant.id } : {}) }),
    method: "PUT",
  });
  return result.cart;
}

export async function removerItem(requisicao: RequisicaoDoMercado, id: string): Promise<Carrinho> {
  const result = await requisicao<{ cart: Carrinho }>(`/api/v1/cart/items/${id}`, { method: "DELETE" });
  return result.cart;
}
