import "dotenv/config";

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function integer(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = optional(name);
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} deve ser um inteiro entre ${minimum} e ${maximum}.`);
  }
  return parsed;
}

function optionalInteger(name: string, minimum: number, maximum: number): number | undefined {
  const value = optional(name);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} deve ser um inteiro entre ${minimum} e ${maximum}.`);
  }
  return parsed;
}

function boolean(name: string, fallback = false): boolean {
  const value = optional(name);
  if (!value) {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${name} deve ser true ou false.`);
}

function portFromEnvironment(): number {
  const candidate = optional("PORT") ?? "8000";
  const port = Number(candidate);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT deve ser um inteiro entre 1 e 65535.");
  }
  return port;
}

const nodeEnv = optional("NODE_ENV") ?? "development";
const appOrigin = optional("APP_ORIGIN") ?? "http://localhost:8000";

export const config = Object.freeze({
  appOrigin,
  api: Object.freeze({
    authRateLimitMax: integer("AUTH_RATE_LIMIT_MAX", 20, 1, 1_000),
    rateLimitMax: integer("API_RATE_LIMIT_MAX", 120, 1, 10_000),
    rateLimitWindowMs: integer("API_RATE_LIMIT_WINDOW_MS", 60_000, 1_000, 3_600_000),
  }),
  databaseUrl: optional("DATABASE_URL"),
  events: Object.freeze({
    pollIntervalMs: integer("OUTBOX_POLL_INTERVAL_MS", 2_000, 250, 60_000),
    workerConcurrency: integer("WORKER_CONCURRENCY", 4, 1, 32),
  }),
  files: Object.freeze({
    accessKeyId: optional("S3_ACCESS_KEY_ID"),
    bucket: optional("S3_BUCKET"),
    endpoint: optional("S3_ENDPOINT"),
    region: optional("S3_REGION") ?? "sa-east-1",
    secretAccessKey: optional("S3_SECRET_ACCESS_KEY"),
  }),
  google: Object.freeze({
    clientId: optional("GOOGLE_CLIENT_ID"),
    clientSecret: optional("GOOGLE_CLIENT_SECRET"),
    redirectUri:
      optional("GOOGLE_REDIRECT_URI") ??
      `${appOrigin}/api/v1/auth/google/callback`,
  }),
  isProduction: nodeEnv === "production",
  metricsEnabled: boolean("METRICS_ENABLED", true),
  metricsBearerToken: optional("METRICS_BEARER_TOKEN"),
  nodeEnv,
  observability: Object.freeze({
    serviceName: optional("OTEL_SERVICE_NAME") ?? "elitehub-connect",
    tracingEndpoint: optional("OTEL_EXPORTER_OTLP_ENDPOINT"),
  }),
  payments: Object.freeze({
    commissionBasisPoints: optionalInteger("MARKETPLACE_COMMISSION_BPS", 0, 10_000),
    mercadoPagoAccessToken: optional("MERCADO_PAGO_ACCESS_TOKEN"),
    mercadoPagoWebhookSecret: optional("MERCADO_PAGO_WEBHOOK_SECRET"),
    provider: optional("PAYMENT_PROVIDER") ?? "disabled",
    sandbox: boolean("PAYMENT_SANDBOX", true),
    stripeSecretKey: optional("STRIPE_SECRET_KEY"),
    stripeWebhookSecret: optional("STRIPE_WEBHOOK_SECRET"),
  }),
  port: portFromEnvironment(),
  redisUrl: optional("REDIS_URL"),
  search: Object.freeze({
    index: optional("SEARCH_INDEX") ?? "elitehub-products",
    url: optional("SEARCH_URL"),
  }),
  sessionSecret: optional("SESSION_SECRET"),
  shipping: Object.freeze({
    fixedCents: optionalInteger("SHIPPING_FIXED_CENTS", 0, 1_000_000),
  }),
  smtpFrom: optional("SMTP_FROM"),
  smtpUrl: optional("SMTP_URL"),
  trustProxyHops: integer("TRUST_PROXY_HOPS", 0, 0, 10),
});

export function hasPersistenceConfiguration(): boolean {
  return Boolean(config.databaseUrl && config.sessionSecret);
}

export function persistenceConfigurationMessage(): string {
  if (!config.databaseUrl) {
    return "DATABASE_URL não está configurada.";
  }
  if (!config.sessionSecret) {
    return "SESSION_SECRET não está configurada.";
  }
  return "A configuração de persistência está disponível.";
}
