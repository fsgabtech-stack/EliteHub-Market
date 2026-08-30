import type { RequestHandler } from "express";

import { config } from "../config.js";
import { incrementRateLimit } from "../infrastructure/cache/redis.js";
import { AppError } from "./errors.js";

const localCounters = new Map<string, number>();

export const distributedRateLimit: RequestHandler = (request, _response, next) => {
  const window = Math.floor(Date.now() / config.api.rateLimitWindowMs);
  const key = `rate-limit:api:${request.ip}:${window}`;
  incrementRateLimit(key, config.api.rateLimitWindowMs)
    .then((count) => {
      const effectiveCount = count ?? ((localCounters.get(key) ?? 0) + 1);
      if (count === null) {
        localCounters.set(key, effectiveCount);
        if (localCounters.size > 10_000) {
          localCounters.clear();
        }
      }
      if (effectiveCount > config.api.rateLimitMax) {
        next(new AppError(429, "RATE_LIMITED"));
        return;
      }
      next();
    })
    .catch(next);
};
