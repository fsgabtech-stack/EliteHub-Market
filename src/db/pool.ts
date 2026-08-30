import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { config, hasPersistenceConfiguration } from "../config.js";
import { unavailable } from "../http/errors.js";
import { logger } from "../observability/logger.js";

let pool: Pool | undefined;

function databasePool(): Pool {
  if (!hasPersistenceConfiguration() || !config.databaseUrl) {
    throw unavailable();
  }

  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 10,
      ssl: config.isProduction ? { rejectUnauthorized: true } : undefined,
    });
    pool.on("error", (error) => {
      logger.error({ erro: error.name }, "erro no pool PostgreSQL");
    });
  }

  return pool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
  try {
    return await databasePool().query<T>(text, values);
  } catch (error) {
    if (error instanceof Error && error.name === "AppError") {
      throw error;
    }
    logger.error({ erro: error instanceof Error ? error.name : "Erro desconhecido" }, "consulta PostgreSQL falhou");
    throw unavailable();
  }
}

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  let client: PoolClient;
  try {
    client = await databasePool().connect();
  } catch (error) {
    logger.error({ erro: error instanceof Error ? error.name : "Erro desconhecido" }, "conexão PostgreSQL falhou");
    throw unavailable();
  }

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabase(): Promise<boolean> {
  if (!hasPersistenceConfiguration()) {
    return false;
  }
  try {
    await databasePool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
