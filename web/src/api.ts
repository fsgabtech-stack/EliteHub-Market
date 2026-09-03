export type ErroApi = { code?: string; message?: string };

export class FalhaDaApi extends Error {
  readonly code: string;

  constructor(error: ErroApi) {
    super(error.message ?? "Não foi possível concluir esta ação.");
    this.code = error.code ?? "BACKEND_UNAVAILABLE";
  }
}

function tokenCsrf(): string | undefined {
  const prefix = "elitehub_csrf=";
  const value = document.cookie.split("; ").find((entry) => entry.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : undefined;
}

export async function requisicao<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method?.toUpperCase() ?? "GET";
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type") && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = tokenCsrf();
    if (csrf) headers.set("x-csrf-token", csrf);
  }
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: "same-origin", headers });
  } catch {
    throw new FalhaDaApi({ code: "BACKEND_UNAVAILABLE" });
  }
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = typeof body === "object" && body !== null && "error" in body
      ? (body as { error: ErroApi }).error
      : { code: "BACKEND_UNAVAILABLE" };
    throw new FalhaDaApi(error);
  }
  return body as T;
}

export function mensagemPublica(error: unknown): string {
  const code = error instanceof FalhaDaApi ? error.code : "BACKEND_UNAVAILABLE";
  if (code === "SESSION_EXPIRED" || code === "UNAUTHORIZED") return "Entre novamente para continuar.";
  if (code === "RATE_LIMITED") return "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.";
  if (code === "EMAIL_VERIFICATION_REQUIRED") return "Confirme seu e-mail antes de continuar a compra.";
  if (code === "INVENTORY_UNAVAILABLE") return "Este produto não possui disponibilidade suficiente.";
  if (error instanceof Error && error.message) return error.message;
  return "Não foi possível conectar ao serviço. Tente novamente em instantes.";
}
