import pino from "pino";

import { config } from "../config.js";

export const logger = pino({
  base: {
    ambiente: config.nodeEnv,
    servico: config.observability.serviceName,
  },
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    censor: "[REDACTED]",
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "senha",
      "password",
      "token",
      "*.senha",
      "*.password",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.clientSecret",
    ],
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
