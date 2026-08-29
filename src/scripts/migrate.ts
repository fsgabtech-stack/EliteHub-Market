import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { closePool, transaction } from "../db/pool.js";

const migrationsDirectory = join(process.cwd(), "src", "db", "migrations");

async function migrate(): Promise<void> {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
    .sort();

  for (const name of names) {
    await transaction(async (client) => {
      await client.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      const existing = await client.query<{ name: string }>(
        "SELECT name FROM schema_migrations WHERE name = $1",
        [name],
      );
      if (existing.rowCount) {
        return;
      }

      const sql = await readFile(join(migrationsDirectory, name), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
      console.log(`Applied migration ${name}`);
    });
  }
}

migrate()
  .then(async () => closePool())
  .catch(async (error: unknown) => {
    console.error("Migration failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    await closePool();
    process.exitCode = 1;
  });
