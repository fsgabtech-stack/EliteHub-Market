import type { ErrorRequestHandler, RequestHandler } from "express";

import { logger } from "../observability/logger.js";

export type PublicErrorCode =
  | "BACKEND_UNAVAILABLE"
  | "CHECKOUT_UNAVAILABLE"
  | "CONFLICT"
  | "COUPON_INVALID"
  | "EMAIL_DELIVERY_UNAVAILABLE"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "FORBIDDEN"
  | "IDEMPOTENCY_CONFLICT"
  | "INVENTORY_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "PAYMENT_CONFIGURATION_UNAVAILABLE"
  | "RATE_LIMITED"
  | "SESSION_EXPIRED"
  | "UNAUTHORIZED";

const publicMessages: Record<PublicErrorCode, string> = {
  BACKEND_UNAVAILABLE:
    "Não foi possível conectar ao serviço. Verifique se o servidor está em execução e tente novamente.",
  CHECKOUT_UNAVAILABLE: "Não foi possível iniciar o checkout neste momento. Tente novamente.",
  CONFLICT: "Não foi possível concluir esta ação com os dados atuais.",
  COUPON_INVALID: "O cupom informado não pode ser aplicado a este pedido.",
  EMAIL_DELIVERY_UNAVAILABLE:
    "O envio de e-mails não está disponível neste ambiente.",
  EMAIL_VERIFICATION_REQUIRED: "Confirme seu e-mail antes de continuar.",
  FORBIDDEN: "Você não tem permissão para realizar esta ação.",
  IDEMPOTENCY_CONFLICT: "A mesma chave de idempotência foi usada com uma solicitação diferente.",
  INVENTORY_UNAVAILABLE: "Um ou mais itens não possuem estoque disponível.",
  INVALID_REQUEST: "Verifique os dados informados e tente novamente.",
  NOT_FOUND: "O recurso solicitado não foi encontrado.",
  PAYMENT_CONFIGURATION_UNAVAILABLE: "O meio de pagamento não está configurado neste ambiente.",
  RATE_LIMITED: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.",
  SESSION_EXPIRED: "Sua sessão expirou. Entre novamente para continuar.",
  UNAUTHORIZED: "Entre novamente para continuar.",
};

export class AppError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: PublicErrorCode,
    public readonly detalhes?: Readonly<Record<string, string>>,
  ) {
    super(publicMessages[code]);
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
    logger.error({
      erro: error instanceof Error ? error.name : "Erro desconhecido",
      method: request.method,
      path: request.path,
      requestId: request.get("x-request-id"),
    }, "erro não tratado na requisição");
  }

  response.status(status).json({
    error: {
      code,
      ...(appError?.detalhes ? { detalhes: appError.detalhes } : {}),
      message: publicMessages[code],
      requestId: request.correlationId,
    },
  });
};

export function invalidRequest(detalhes?: Readonly<Record<string, string>>): AppError {
  return new AppError(400, "INVALID_REQUEST", detalhes);
}

export function unavailable(): AppError {
  return new AppError(503, "BACKEND_UNAVAILABLE");
}
