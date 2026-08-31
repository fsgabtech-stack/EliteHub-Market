import { render } from "@testing-library/react";
import { expect, test } from "vitest";

import { Icone } from "./icone";

test("mantém o estado ativo do ícone de favorito para a animação e acessibilidade", () => {
  const { container } = render(<Icone nome="heart" ativo />);
  const icon = container.querySelector("svg");
  expect(icon).toHaveClass("icone", "icone--heart");
  expect(icon).toHaveAttribute("data-ativo", "true");
});
