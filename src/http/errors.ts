import type { ErrorRequestHandler, RequestHandler } from "express";

export type PublicErrorCode =
  | "BACKEND_UNAVAILABLE"
  | "CONFLICT"
  | "EMAIL_DELIVERY_UNAVAILABLE"
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "SESSION_EXPIRED"
  | "UNAUTHORIZED";

const publicMessages: Record<PublicErrorCode, string> = {
  BACKEND_UNAVAILABLE:
    "Não foi possível conectar ao serviço. Verifique se o servidor está em execução e tente novamente.",
  CONFLICT: "Não foi possível concluir esta ação com os dados atuais.",
  EMAIL_DELIVERY_UNAVAILABLE:
    "O envio de e-mails não está disponível neste ambiente.",
  FORBIDDEN: "Você não tem permissão para realizar esta ação.",
  INVALID_REQUEST: "Verifique os dados informados e tente novamente.",
  NOT_FOUND: "O recurso solicitado não foi encontrado.",
  RATE_LIMITED: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.",
  SESSION_EXPIRED: "Sua sessão expirou. Entre novamente para continuar.",
  UNAUTHORIZED: "Entre novamente para continuar.",
};

export class AppError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: PublicErrorCode,
    message?: string,
  ) {
    super(message ?? publicMessages[code]);
    this.name = "AppError";
  }
}

export const asyncRoute = (handler: RequestHandler): RequestHandler =>
  (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  request,
  response,
  _next,
) => {
  const appError = error instanceof AppError ? error : undefined;
  const status = appError?.status ?? 500;
  const code = appError?.code ?? "BACKEND_UNAVAILABLE";

  if (!appError) {
    console.error("Unhandled request error", {
      method: request.method,
      path: request.path,
      requestId: request.get("x-request-id"),
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }

  response.status(status).json({
    error: {
      code,
      message: publicMessages[code],
    },
  });
};

export function invalidRequest(message?: string): AppError {
  return new AppError(400, "INVALID_REQUEST", message);
}

export function unavailable(): AppError {
  return new AppError(503, "BACKEND_UNAVAILABLE");
}
