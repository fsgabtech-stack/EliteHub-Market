export function currency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" }).format(value / 100);
}

export function date(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
}

export function availability(value: "AVAILABLE" | "LOW_STOCK" | "OUT_OF_STOCK"): string {
  if (value === "OUT_OF_STOCK") return "Indisponível";
  if (value === "LOW_STOCK") return "Últimas unidades";
  return "Disponível";
}
