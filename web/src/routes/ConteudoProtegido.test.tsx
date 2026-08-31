import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConteudoProtegido } from "./ConteudoProtegido";

describe("proteção de rotas", () => {
  it("solicita autenticação uma única vez antes de mostrar conteúdo privado", async () => {
    const exigirAutenticacao = vi.fn();
    const view = render(
      <ConteudoProtegido authenticated={false} destination="/checkout" message="Entre para continuar sua compra." onRequireAuthentication={exigirAutenticacao}>
        <p>Checkout privado</p>
      </ConteudoProtegido>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Aguardando autenticação");
    await waitFor(() => expect(exigirAutenticacao).toHaveBeenCalledWith("/checkout", "Entre para continuar sua compra."));
    view.rerender(
      <ConteudoProtegido authenticated destination="/checkout" message="Entre para continuar sua compra." onRequireAuthentication={exigirAutenticacao}>
        <p>Checkout privado</p>
      </ConteudoProtegido>,
    );
    expect(screen.getByText("Checkout privado")).toBeInTheDocument();
    expect(exigirAutenticacao).toHaveBeenCalledTimes(1);
    view.rerender(
      <ConteudoProtegido authenticated={false} destination="/carrinho" message="Entre para acessar seu carrinho." onRequireAuthentication={exigirAutenticacao}>
        <p>Carrinho privado</p>
      </ConteudoProtegido>,
    );
    await waitFor(() => expect(exigirAutenticacao).toHaveBeenCalledWith("/carrinho", "Entre para acessar seu carrinho."));
    expect(exigirAutenticacao).toHaveBeenCalledTimes(2);
  });
});
