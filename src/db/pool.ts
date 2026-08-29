import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { config, hasPersistenceConfiguration } from "../config.js";
import { unavailable } from "../http/errors.js";

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
      console.error("PostgreSQL pool error", { message: error.message });
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
    console.error("PostgreSQL query failed", { message: error instanceof Error ? error.message : "Unknown error" });
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
    console.error("PostgreSQL connection failed", { message: error instanceof Error ? error.message : "Unknown error" });
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
