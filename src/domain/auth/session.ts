import type { PoolClient } from "pg";
import type { Request } from "express";

import { config } from "../../config.js";
import { query } from "../../db/pool.js";
import { AppError, unavailable } from "../../http/errors.js";
import { digestToken, newOpaqueToken, SESSION_COOKIE } from "../../http/security.js";

export type Role = "BUYER" | "SELLER" | "PROFESSIONAL";

export type SessionUser = {
  id: string;
  fullName: string;
  email: string;
  emailVerified: boolean;
  roles: Role[];
};

type SessionRow = {
  id: string;
  full_name: string;
  email: string;
  email_verified_at: Date | null;
  roles: Role[];
};

function tokenFrom(request: Request): string | undefined {
  const token = request.cookies?.[SESSION_COOKIE];
  return typeof token === "string" ? token : undefined;
}

export async function currentSession(request: Request): Promise<SessionUser | null> {
  const token = tokenFrom(request);
  if (!token) {
    return null;
  }

  const result = await query<SessionRow>(
    `SELECT users.id, users.full_name, users.email, users.email_verified_at,
            COALESCE(array_agg(user_roles.role) FILTER (WHERE user_roles.role IS NOT NULL), '{}') AS roles
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     LEFT JOIN user_roles ON user_roles.user_id = users.id
     WHERE sessions.token_hash = $1
       AND sessions.revoked_at IS NULL
       AND sessions.expires_at > now()
     GROUP BY users.id`,
    [digestToken(token)],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    email: row.email,
    emailVerified: Boolean(row.email_verified_at),
    fullName: row.full_name,
    id: row.id,
    roles: row.roles,
  };
}

export async function requireSession(request: Request): Promise<SessionUser> {
  const session = await currentSession(request);
  if (!session) {
    throw new AppError(401, "SESSION_EXPIRED");
  }
  return session;
}

export async function createSession(
  client: PoolClient,
  userId: string,
  rememberMe: boolean,
): Promise<{ token: string; maxAgeMs: number }> {
  if (!config.sessionSecret) {
    throw unavailable();
  }
  const maxAgeMs = rememberMe
    ? 1000 * 60 * 60 * 24 * 30
    : 1000 * 60 * 60 * 8;
  const token = newOpaqueToken();
  await client.query(
    `INSERT INTO sessions(user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3::text || ' milliseconds')::interval)`,
    [userId, digestToken(token), String(maxAgeMs)],
  );
  return { maxAgeMs, token };
}

export async function revokeCurrentSession(request: Request): Promise<void> {
  const token = tokenFrom(request);
  if (!token) {
    return;
  }
  await query(
    "UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
    [digestToken(token)],
  );
}
