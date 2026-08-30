import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";

import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";

import { config, hasPersistenceConfiguration, persistenceConfigurationMessage } from "./config.js";
import { checkDatabase } from "./db/pool.js";
import { AppError, errorHandler } from "./http/errors.js";
import { requestContext } from "./http/request-context.js";
import { distributedRateLimit } from "./http/rate-limit.js";
import { documentoOpenApi } from "./openapi.js";
import { metricRegistry } from "./observability/metrics.js";
import { logger } from "./observability/logger.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAddressRoutes } from "./routes/addresses.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerCartRoutes } from "./routes/cart.js";
import { registerCheckoutRoutes } from "./routes/checkout.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerFavoriteRoutes } from "./routes/favorites.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerOrderRoutes } from "./routes/orders.js";
import { registerPaymentWebhookRoutes } from "./routes/payment-webhooks.js";
import { registerPublicSellerRoutes } from "./routes/public-sellers.js";
import { registerSellerRoutes } from "./routes/seller.js";

function validMetricsAuthorization(value: string | undefined): boolean {
  if (!config.isProduction) {
    return true;
  }
  const token = config.metricsBearerToken;
  if (!token || !value?.startsWith("Bearer ")) {
    return false;
  }
  const expected = Buffer.from(`Bearer ${token}`, "utf8");
  const received = Buffer.from(value, "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function criarAplicacao(): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxyHops);
  app.use(requestContext);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          baseUri: ["'self'"],
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "https:", "data:"],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  registerPaymentWebhookRoutes(app);
  app.use(express.json({ limit: "64kb", type: ["application/json", "application/*+json"] }));
  app.use(cookieParser());
  app.use("/static", express.static(join(process.cwd(), "static"), { fallthrough: false, index: false }));
  app.get("/openapi.json", (_request, response) => response.json(documentoOpenApi));
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(documentoOpenApi, { customSiteTitle: "EliteHub Connect API" }));

  const api = express.Router();
  api.use(distributedRateLimit);
  api.get("/live", (_request, response) => response.status(200).json({ status: "ok" }));
  api.get("/ready", async (_request, response) => {
    const databaseReady = await checkDatabase();
    response.status(databaseReady ? 200 : 503).json({ database: databaseReady ? "ready" : "unavailable", status: databaseReady ? "ok" : "degraded" });
  });
  api.get("/health", async (_request, response) => {
    const databaseReady = await checkDatabase();
    response.status(databaseReady ? 200 : 503).json({
      database: databaseReady ? "ready" : "unavailable",
      persistenceConfigured: hasPersistenceConfiguration(),
      status: databaseReady ? "ok" : "degraded",
    });
  });
  registerAuthRoutes(api);
  registerCatalogRoutes(api);
  registerCatalogRoutes(api, "/catalog");
  registerPublicSellerRoutes(api);
  registerAccountRoutes(api);
  registerAddressRoutes(api);
  registerCartRoutes(api);
  registerCheckoutRoutes(api);
  registerFileRoutes(api);
  registerFavoriteRoutes(api);
  registerNotificationRoutes(api);
  registerOrderRoutes(api);
  registerSellerRoutes(api);
  registerAdminRoutes(api);
  app.use("/api/v1", api);

  if (config.metricsEnabled) {
    app.get("/metrics", async (request, response, next) => {
      if (!validMetricsAuthorization(request.get("authorization"))) {
        next(new AppError(401, "UNAUTHORIZED"));
        return;
      }
      response.setHeader("content-type", metricRegistry.contentType);
      response.send(await metricRegistry.metrics());
    });
  }

  app.use((request, response) => {
    if (request.path.startsWith("/api/")) {
      response.status(404).json({ error: { code: "NOT_FOUND", message: "O recurso solicitado não foi encontrado.", requestId: request.correlationId } });
      return;
    }
    if (request.accepts("html")) {
      response.redirect(302, "/static/elitehub.html");
      return;
    }
    response.status(404).json({ error: { code: "NOT_FOUND", message: "O recurso solicitado não foi encontrado.", requestId: request.correlationId } });
  });
  app.use(errorHandler);

  if (!hasPersistenceConfiguration()) {
    logger.warn({ motivo: persistenceConfigurationMessage() }, "persistência indisponível");
  }
  return app;
}
