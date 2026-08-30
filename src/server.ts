import { config } from "./config.js";
import { closePool } from "./db/pool.js";
import { closeRedis } from "./infrastructure/cache/redis.js";
import { logger } from "./observability/logger.js";
import { iniciarTracing, encerrarTracing } from "./observability/tracing.js";

iniciarTracing();
const { criarAplicacao } = await import("./app.js");
const app = criarAplicacao();

const server = app.listen(config.port, () => {
  logger.info({ origemAplicacao: config.appOrigin, porta: config.port }, "API iniciada");
});

function encerrarServidor(sinal: string): void {
  server.close(() => {
    Promise.allSettled([encerrarTracing(), closePool(), closeRedis()])
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
  logger.info({ sinal }, "encerramento da API solicitado");
}

process.once("SIGINT", () => encerrarServidor("SIGINT"));
process.once("SIGTERM", () => encerrarServidor("SIGTERM"));
