export type AcaoPendente =
  | { destination: string; kind: "cart"; productId: string; variantId?: string }
  | { kind: "favorite"; productId: string }
  | { kind: "route"; path: string };

export type RequisicaoDoMercado = <T>(path: string, init?: RequestInit) => Promise<T>;

const storageKey = "elitehub-pending-action";

function isAction(value: unknown): value is AcaoPendente {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "route") return typeof candidate.path === "string" && candidate.path.startsWith("/");
  if (candidate.kind === "favorite") return typeof candidate.productId === "string";
  return candidate.kind === "cart" && typeof candidate.productId === "string" && typeof candidate.destination === "string" && candidate.destination.startsWith("/");
}

export function obterAcaoPendente(storage: Storage = sessionStorage): AcaoPendente | null {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return isAction(value) ? value : null;
  } catch {
    return null;
  }
}

export function salvarAcaoPendente(action: AcaoPendente | null, storage: Storage = sessionStorage): void {
  try {
    if (action) storage.setItem(storageKey, JSON.stringify(action));
    else storage.removeItem(storageKey);
  } catch {
    return;
  }
}

export async function retomarAcaoPendente(input: {
  action: AcaoPendente;
  adicionarFavorito: (productId: string) => void;
  navegar: (path: string) => void;
  publicarAviso: (message: string, kind: "error" | "info" | "success") => void;
  requisicao: RequisicaoDoMercado;
}): Promise<void> {
  if (input.action.kind === "route") {
    input.navegar(input.action.path);
    return;
  }
  if (input.action.kind === "cart") {
    await input.requisicao("/api/v1/cart/items", {
      body: JSON.stringify({ productId: input.action.productId, quantity: 1, ...(input.action.variantId ? { variantId: input.action.variantId } : {}) }),
      method: "PUT",
    });
    input.publicarAviso("Produto adicionado ao carrinho.", "success");
    input.navegar(input.action.destination);
    return;
  }
  await input.requisicao(`/api/v1/favorites/${input.action.productId}`, { method: "POST" });
  input.adicionarFavorito(input.action.productId);
  input.publicarAviso("Produto salvo nos favoritos.", "success");
}
