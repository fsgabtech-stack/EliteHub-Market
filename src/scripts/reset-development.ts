import { config } from "../config.js";
import { closePool, transaction } from "../db/pool.js";

function assertDevelopmentResetIsAllowed(): void {
  if (config.nodeEnv !== "development" || process.env.ELITEHUB_DEVELOPMENT_RESET !== "enabled") {
    throw new Error("A limpeza local exige NODE_ENV=development e ELITEHUB_DEVELOPMENT_RESET=enabled.");
  }
}

async function reset(): Promise<void> {
  assertDevelopmentResetIsAllowed();
  await transaction(async (client) => {
    await client.query("TRUNCATE TABLE users, categories, outbox_events, payment_webhook_receipts RESTART IDENTITY CASCADE");
  });
  console.log("Dados de desenvolvimento removidos. As migrações permanecem aplicadas.");
}

reset()
  .catch((error: unknown) => {
    console.error("Limpeza de desenvolvimento falhou", { message: error instanceof Error ? error.message : "Erro desconhecido" });
    process.exitCode = 1;
  })
  .finally(async () => closePool());
