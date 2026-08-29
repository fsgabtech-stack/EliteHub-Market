import "dotenv/config";

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function portFromEnvironment(): number {
  const candidate = optional("PORT") ?? "8000";
  const port = Number(candidate);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

const nodeEnv = optional("NODE_ENV") ?? "development";

export const config = Object.freeze({
  appOrigin: optional("APP_ORIGIN") ?? "http://localhost:8000",
  databaseUrl: optional("DATABASE_URL"),
  google: Object.freeze({
    clientId: optional("GOOGLE_CLIENT_ID"),
    clientSecret: optional("GOOGLE_CLIENT_SECRET"),
    redirectUri:
      optional("GOOGLE_REDIRECT_URI") ??
      "http://localhost:8000/api/v1/auth/google/callback",
  }),
  isProduction: nodeEnv === "production",
  nodeEnv,
  port: portFromEnvironment(),
  sessionSecret: optional("SESSION_SECRET"),
  smtpFrom: optional("SMTP_FROM"),
  smtpUrl: optional("SMTP_URL"),
});

export function hasPersistenceConfiguration(): boolean {
  return Boolean(config.databaseUrl && config.sessionSecret);
}

export function persistenceConfigurationMessage(): string {
  if (!config.databaseUrl) {
    return "DATABASE_URL is not configured.";
  }
  if (!config.sessionSecret) {
    return "SESSION_SECRET is not configured.";
  }
  return "Persistence configuration is available.";
}
