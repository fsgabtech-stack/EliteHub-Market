import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { closePool, query } from "../db/pool.js";

async function main(): Promise<void> {
  const directory = join(process.cwd(), "src", "db", "migrations");
  const files = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name)).sort();
  const applied = await query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name ASC");
  const appliedNames = new Set(applied.rows.map((migration) => migration.name));
  for (const file of files) {
    console.log(`${appliedNames.has(file) ? "APLICADA" : "PENDENTE"} ${file}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error("Não foi possível consultar o estado das migrações", { erro: error instanceof Error ? error.name : "Erro desconhecido" });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
