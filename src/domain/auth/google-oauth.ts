import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { OAuth2Client } from "google-auth-library";

import { config } from "../../config.js";
import { transaction } from "../../db/pool.js";
import { AppError, unavailable } from "../../http/errors.js";
import { digestToken, newOpaqueToken } from "../../http/security.js";
import { createSession } from "./session.js";

type OAuthContext = {
  codeVerifier: string;
  nonce: string;
  state: string;
};

type GoogleIdentity = {
  email: string;
  fullName: string;
  subject: string;
};

function credentials(): { clientId: string; clientSecret: string; redirectUri: string } {
  const { clientId, clientSecret, redirectUri } = config.google;
  if (!clientId || !clientSecret || !config.sessionSecret) {
    throw unavailable();
  }
  return { clientId, clientSecret, redirectUri };
}

function encryptionKey(): Buffer {
  if (!config.sessionSecret) {
    throw unavailable();
  }
  return createHash("sha256").update(config.sessionSecret).digest();
}

function encryptContext(context: OAuthContext): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const payload = Buffer.concat([
    cipher.update(JSON.stringify(context), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), payload]).toString("base64url");
}

function decryptContext(ciphertext: string): OAuthContext {
  const input = Buffer.from(ciphertext, "base64url");
  if (input.length < 29) {
    throw new AppError(400, "INVALID_REQUEST");
  }
  const iv = input.subarray(0, 12);
  const tag = input.subarray(12, 28);
  const payload = input.subarray(28);
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const value: unknown = JSON.parse(
      Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8"),
    );
    if (
      !value ||
      typeof value !== "object" ||
      typeof (value as OAuthContext).state !== "string" ||
      typeof (value as OAuthContext).nonce !== "string" ||
      typeof (value as OAuthContext).codeVerifier !== "string"
    ) {
      throw new Error("Invalid OAuth context");
    }
    return value as OAuthContext;
  } catch {
    throw new AppError(400, "INVALID_REQUEST");
  }
}

function equalSecrets(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function googleClient(): OAuth2Client {
  const { clientId, clientSecret, redirectUri } = credentials();
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

function authorizationUrl(context: OAuthContext): string {
  const { clientId, redirectUri } = credentials();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", context.state);
  url.searchParams.set("nonce", context.nonce);
  url.searchParams.set("code_challenge", createHash("sha256").update(context.codeVerifier).digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function beginGoogleAuthorization(): Promise<string> {
  credentials();
  const context: OAuthContext = {
    codeVerifier: newOpaqueToken(),
    nonce: newOpaqueToken(),
    state: newOpaqueToken(),
  };
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO oauth_authorization_states(state_hash, context_ciphertext, expires_at)
       VALUES ($1, $2, now() + interval '10 minutes')`,
      [digestToken(context.state), encryptContext(context)],
    );
  });
  return authorizationUrl(context);
}

async function consumeContext(state: string): Promise<OAuthContext> {
  return transaction(async (client) => {
    const result = await client.query<{ context_ciphertext: string }>(
      `UPDATE oauth_authorization_states
       SET consumed_at = now()
       WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > now()
       RETURNING context_ciphertext`,
      [digestToken(state)],
    );
    const record = result.rows[0];
    if (!record) {
      throw new AppError(400, "INVALID_REQUEST");
    }
    const context = decryptContext(record.context_ciphertext);
    if (!equalSecrets(state, context.state)) {
      throw new AppError(400, "INVALID_REQUEST");
    }
    return context;
  });
}

async function exchangeCode(code: string, context: OAuthContext): Promise<GoogleIdentity> {
  const { clientId, clientSecret, redirectUri } = credentials();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: context.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  if (!response.ok) {
    throw new AppError(400, "INVALID_REQUEST");
  }
  const tokenResponse: unknown = await response.json();
  const idToken =
    tokenResponse && typeof tokenResponse === "object" && typeof (tokenResponse as { id_token?: unknown }).id_token === "string"
      ? (tokenResponse as { id_token: string }).id_token
      : undefined;
  if (!idToken) {
    throw new AppError(400, "INVALID_REQUEST");
  }
  const ticket = await googleClient().verifyIdToken({ audience: clientId, idToken });
  const payload = ticket.getPayload();
  if (
    !payload?.sub ||
    !payload.email ||
    payload.email_verified !== true ||
    typeof payload.nonce !== "string" ||
    !equalSecrets(payload.nonce, context.nonce)
  ) {
    throw new AppError(400, "INVALID_REQUEST");
  }
  const email = payload.email.trim().toLowerCase();
  const rawName = typeof payload.name === "string" ? payload.name.trim().replace(/\s+/g, " ") : "";
  const fullName = rawName.length >= 3 && rawName.length <= 160 ? rawName : email.split("@")[0]!.slice(0, 160);
  return { email, fullName, subject: payload.sub };
}

async function findOrCreateGoogleUser(identity: GoogleIdentity): Promise<string> {
  return transaction(async (client) => {
    const existingIdentity = await client.query<{ user_id: string }>(
      "SELECT user_id FROM oauth_identities WHERE provider = 'GOOGLE' AND provider_subject = $1 FOR UPDATE",
      [identity.subject],
    );
    if (existingIdentity.rows[0]) {
      return existingIdentity.rows[0].user_id;
    }

    const existingUser = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1 FOR UPDATE",
      [identity.email],
    );
    let userId = existingUser.rows[0]?.id;
    if (!userId) {
      const created = await client.query<{ id: string }>(
        `INSERT INTO users(full_name, email, email_verified_at)
         VALUES ($1, $2, now())
         RETURNING id`,
        [identity.fullName, identity.email],
      );
      userId = created.rows[0]!.id;
      await client.query("INSERT INTO user_roles(user_id, role) VALUES ($1, 'BUYER')", [userId]);
    } else {
      const providerForUser = await client.query<{ provider_subject: string }>(
        "SELECT provider_subject FROM oauth_identities WHERE user_id = $1 AND provider = 'GOOGLE' FOR UPDATE",
        [userId],
      );
      const existingSubject = providerForUser.rows[0]?.provider_subject;
      if (existingSubject && !equalSecrets(existingSubject, identity.subject)) {
        throw new AppError(409, "CONFLICT");
      }
      await client.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1", [userId]);
    }

    await client.query(
      `INSERT INTO oauth_identities(user_id, provider, provider_subject, provider_email)
       VALUES ($1, 'GOOGLE', $2, $3)`,
      [userId, identity.subject, identity.email],
    );
    await client.query(
      `INSERT INTO audit_events(actor_user_id, action, target_type, target_id)
       VALUES ($1, 'GOOGLE_IDENTITY_LINKED', 'USER', $1)`,
      [userId],
    );
    return userId;
  });
}

export async function completeGoogleAuthorization(
  code: string,
  state: string,
): Promise<{ maxAgeMs: number; token: string }> {
  const context = await consumeContext(state);
  const identity = await exchangeCode(code, context);
  const userId = await findOrCreateGoogleUser(identity);
  return transaction((client) => createSession(client, userId, true));
}
