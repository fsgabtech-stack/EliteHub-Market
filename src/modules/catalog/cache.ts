import { invalidateCachePrefix } from "../../infrastructure/cache/redis.js";
import { logger } from "../../observability/logger.js";

export async function invalidatePublicCatalogCache(): Promise<void> {
  try {
    await invalidateCachePrefix("catalog:");
  } catch (error) {
    logger.warn({ erro: error instanceof Error ? error.name : "Erro desconhecido" }, "falha ao invalidar cache do catálogo público");
  }
}
