import type { Avaliacao } from "../types";

export function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0] ?? "Conta";
}

export function resumoAvaliacao(avaliacao: Avaliacao | null): string | null {
  if (!avaliacao?.count) return null;
  const media = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(avaliacao.average);
  return `★ ${media} (${avaliacao.count} ${avaliacao.count === 1 ? "avaliação" : "avaliações"})`;
}

export function senhaForte(valor: string): boolean {
  return valor.length >= 12 && valor.length <= 256 && /[a-z]/.test(valor) && /[A-Z]/.test(valor) && /\d/.test(valor);
}
