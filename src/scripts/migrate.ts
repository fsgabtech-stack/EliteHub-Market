import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { closePool, transaction } from "../db/pool.js";

async function migrationsDirectory(): Promise<string> {
  const candidates = [
    join(process.cwd(), "dist", "db", "migrations"),
    join(process.cwd(), "src", "db", "migrations"),
  ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  throw new Error("Diretório de migrações SQL não encontrado.");
}

async function migrate(): Promise<void> {
  const directory = await migrationsDirectory();
  const names = (await readdir(directory))
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

      const sql = await readFile(join(directory, name), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
      console.log(`Migração aplicada: ${name}`);
    });
  }
}

migrate()
  .then(async () => closePool())
  .catch(async (error: unknown) => {
    console.error("migração falhou", {
      message: error instanceof Error ? error.message : "Erro desconhecido",
    });
    await closePool();
    process.exitCode = 1;
  });
