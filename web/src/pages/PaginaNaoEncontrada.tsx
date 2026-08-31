import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { EstadoVazio } from "../shared/estado";

export function PaginaNaoEncontrada(): ReactNode {
  return <EstadoVazio title="Página não encontrada" description="O endereço solicitado não existe ou não está mais disponível." action={<Link className="button button--primary" to="/">Voltar ao início</Link>} />;
}
