import { randomUUID } from "node:crypto";
import { join } from "node:path";

import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";

import { config, hasPersistenceConfiguration, persistenceConfigurationMessage } from "./config.js";
import { checkDatabase } from "./db/pool.js";
import { errorHandler } from "./http/errors.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCatalogRoutes } from "./routes/catalog.js";

const app = express();

app.disable("x-powered-by");
app.use((request, response, next) => {
  const requestId = request.get("x-request-id") ?? randomUUID();
  response.setHeader("x-request-id", requestId);
  next();
});
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
app.use(express.json({ limit: "64kb", type: "application/json" }));
app.use(cookieParser());
app.use("/static", express.static(join(process.cwd(), "static"), { fallthrough: false, index: false }));

const api = express.Router();
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
app.use("/api/v1", api);

app.use((request, response) => {
  if (request.accepts("html")) {
    response.redirect(302, "/static/elitehub.html");
    return;
  }
  response.status(404).json({ error: { code: "NOT_FOUND", message: "O recurso solicitado não foi encontrado." } });
});
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`EliteHub Connect listening on ${config.appOrigin}`);
  if (!hasPersistenceConfiguration()) {
    console.warn(`Persistence is unavailable: ${persistenceConfigurationMessage()}`);
  }
});
