import { createContext, useContext } from "react";

import type { AcaoPendente } from "../auth/pending-action";
import type { UsuarioDaSessao } from "../types";

export type ModoAutenticacao = "welcome" | "login" | "register" | "recovery" | "reset";
export type Provedores = { google: boolean; microsoft: boolean };
export type Aviso = { kind: "error" | "info" | "success"; message: string };

export type ContextoMercado = {
  abrirAutenticacao: (message: string, action?: AcaoPendente, mode?: ModoAutenticacao) => void;
  abrirRotaProtegida: (path: string, message: string) => void;
  adicionarAoCarrinho: (productId: string, variantId: string | undefined, destination: string) => Promise<void>;
  favoritos: ReadonlySet<string>;
  providers: Provedores;
  publicarAviso: (message: string, kind?: Aviso["kind"]) => void;
  sair: () => Promise<void>;
  sessaoVerificada: boolean;
  toggleFavorito: (productId: string) => Promise<void>;
  user: UsuarioDaSessao | null;
};

export const MercadoContext = createContext<ContextoMercado | null>(null);

export function useMercado(): ContextoMercado {
  const context = useContext(MercadoContext);
  if (!context) throw new Error("O contexto da EliteHub não está disponível.");
  return context;
}
