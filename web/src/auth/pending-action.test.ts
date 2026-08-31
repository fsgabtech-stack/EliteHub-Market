import { beforeEach, describe, expect, it, vi } from "vitest";

import { obterAcaoPendente, retomarAcaoPendente, salvarAcaoPendente } from "./pending-action";

describe("continuação autenticada de ações", () => {
  beforeEach(() => sessionStorage.clear());

  it("persiste somente uma ação suportada e a restaura", () => {
    salvarAcaoPendente({ destination: "/checkout", kind: "cart", productId: "produto-1", variantId: "variacao-1" });
    expect(obterAcaoPendente()).toEqual({ destination: "/checkout", kind: "cart", productId: "produto-1", variantId: "variacao-1" });
    sessionStorage.setItem("elitehub-pending-action", JSON.stringify({ kind: "route", path: "https://externo.invalido" }));
    expect(obterAcaoPendente()).toBeNull();
  });

  it("adiciona o produto real ao carrinho após autenticação", async () => {
    const requisicao = vi.fn().mockResolvedValue({});
    const navegar = vi.fn();
    const publicarAviso = vi.fn();
    await retomarAcaoPendente({
      action: { destination: "/carrinho", kind: "cart", productId: "produto-1", variantId: "variacao-1" },
      adicionarFavorito: vi.fn(),
      navegar,
      publicarAviso,
      requisicao,
    });
    expect(requisicao).toHaveBeenCalledWith("/api/v1/cart/items", {
      body: JSON.stringify({ productId: "produto-1", quantity: 1, variantId: "variacao-1" }),
      method: "PUT",
    });
    expect(navegar).toHaveBeenCalledWith("/carrinho");
    expect(publicarAviso).toHaveBeenCalledWith("Produto adicionado ao carrinho.", "success");
  });
});
