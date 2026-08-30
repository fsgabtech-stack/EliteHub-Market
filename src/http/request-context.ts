import { randomUUID } from "node:crypto";

import type { RequestHandler } from "express";

import { httpRequestsTotal } from "../observability/metrics.js";
import { logger } from "../observability/logger.js";

declare module "express-serve-static-core" {
  interface Request {
    correlationId: string;
  }
}

export const requestContext: RequestHandler = (request, response, next) => {
  const supplied = request.get("x-request-id");
  request.correlationId = supplied && supplied.length <= 128 ? supplied : randomUUID();
  response.setHeader("x-request-id", request.correlationId);
  const startedAt = performance.now();

  response.on("finish", () => {
    const route = request.route?.path ? String(request.route.path) : request.path;
    httpRequestsTotal.inc({ metodo: request.method, rota: route, status: String(response.statusCode) });
    logger.info(
      {
        duracaoMs: Math.round(performance.now() - startedAt),
        metodo: request.method,
        requisicaoId: request.correlationId,
        rota: route,
        status: response.statusCode,
      },
      "requisição concluída",
    );
  });
  next();
};
