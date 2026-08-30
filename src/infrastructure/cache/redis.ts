import { createClient } from "redis";

import { config } from "../../config.js";
import { logger } from "../../observability/logger.js";

type RedisConnection = ReturnType<typeof createClient>;

let client: RedisConnection | undefined;
let connecting: Promise<RedisConnection | undefined> | undefined;

async function redisClient(): Promise<RedisConnection | undefined> {
  if (!config.redisUrl) {
    return undefined;
  }
  if (client?.isOpen) {
    return client;
  }
  if (!connecting) {
    const candidate = createClient({ url: config.redisUrl });
    candidate.on("error", (error: Error) => logger.warn({ erro: error.name }, "Redis indisponível"));
    connecting = candidate.connect()
      .then(() => {
        client = candidate;
        return candidate;
      })
      .catch((error: unknown) => {
        logger.warn({ erro: error instanceof Error ? error.name : "Erro desconhecido" }, "falha ao conectar no Redis");
        return undefined;
      })
      .finally(() => {
        connecting = undefined;
      });
  }
  return connecting;
}

export async function readCachedJson<T>(key: string): Promise<T | null> {
  const redis = await redisClient();
  if (!redis) {
    return null;
  }
  const value = await redis.get(key);
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    await redis.del(key);
    return null;
  }
}

export async function writeCachedJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const redis = await redisClient();
  if (redis) {
    await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
  }
}

export async function invalidateCachePrefix(prefix: string): Promise<void> {
  const redis = await redisClient();
  if (!redis) {
    return;
  }
  for await (const key of redis.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
    await redis.del(key);
  }
}

export async function incrementRateLimit(key: string, windowMilliseconds: number): Promise<number | null> {
  const redis = await redisClient();
  if (!redis) {
    return null;
  }
  const value = await redis.incr(key);
  if (value === 1) {
    await redis.pExpire(key, windowMilliseconds);
  }
  return value;
}

export async function closeRedis(): Promise<void> {
  const active = client;
  client = undefined;
  connecting = undefined;
  if (!active?.isOpen) {
    return;
  }
  try {
    await active.quit();
  } catch {
    active.disconnect();
  }
}
