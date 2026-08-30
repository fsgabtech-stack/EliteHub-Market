import type { PoolClient } from "pg";
import type { Request } from "express";

import { config } from "../../config.js";
import { query, transaction } from "../../db/pool.js";
import { AppError, unavailable } from "../../http/errors.js";
import { ACCESS_TOKEN_COOKIE, digestToken, newOpaqueToken, SESSION_COOKIE } from "../../http/security.js";
import { verifyAccessToken } from "./access-token.js";

export type Role = "CUSTOMER" | "SELLER" | "PROFESSIONAL" | "ADMIN" | "SUPPORT";

export type SessionUser = {
  id: string;
  fullName: string;
  email: string;
  emailVerified: boolean;
  roles: Role[];
};

type SessionRow = {
  session_id: string;
  id: string;
  full_name: string;
  email: string;
  email_verified_at: Date | null;
  roles: Role[];
};

function refreshTokenFrom(request: Request): string | undefined {
  const token = request.cookies?.[SESSION_COOKIE];
  return typeof token === "string" ? token : undefined;
}

function accessTokenFrom(request: Request): string | undefined {
  const authorization = request.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }
  const token = request.cookies?.[ACCESS_TOKEN_COOKIE];
  return typeof token === "string" ? token : undefined;
}

async function sessionByWhere(where: string, values: unknown[]): Promise<SessionUser | null> {
  const result = await query<SessionRow>(
    `SELECT sessions.id AS session_id, users.id, users.full_name, users.email, users.email_verified_at,
            COALESCE(array_agg(user_roles.role) FILTER (WHERE user_roles.role IS NOT NULL), '{}') AS roles
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     LEFT JOIN user_roles ON user_roles.user_id = users.id
     WHERE ${where}
       AND users.deleted_at IS NULL
       AND sessions.revoked_at IS NULL
       AND sessions.expires_at > now()
     GROUP BY sessions.id, users.id`,
    values,
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

export async function currentSession(request: Request): Promise<SessionUser | null> {
  const accessToken = accessTokenFrom(request);
  if (accessToken) {
    const payload = verifyAccessToken(accessToken);
    if (payload) {
      const fromAccessToken = await sessionByWhere("sessions.id = $1 AND users.id = $2", [payload.sid, payload.sub]);
      if (fromAccessToken) {
        return fromAccessToken;
      }
    }
  }
  const refreshToken = refreshTokenFrom(request);
  return refreshToken ? sessionByWhere("sessions.token_hash = $1", [digestToken(refreshToken)]) : null;
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
): Promise<{ maxAgeMs: number; sessionId: string; token: string; userId: string }> {
  if (!config.sessionSecret) {
    throw unavailable();
  }
  const maxAgeMs = rememberMe
    ? 1000 * 60 * 60 * 24 * 30
    : 1000 * 60 * 60 * 8;
  const token = newOpaqueToken();
  const created = await client.query<{ id: string }>(
    `INSERT INTO sessions(user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3::text || ' milliseconds')::interval)
     RETURNING id`,
    [userId, digestToken(token), String(maxAgeMs)],
  );
  const session = created.rows[0];
  if (!session) {
    throw unavailable();
  }
  return { maxAgeMs, sessionId: session.id, token, userId };
}

export async function revokeCurrentSession(request: Request): Promise<void> {
  const refreshToken = refreshTokenFrom(request);
  if (refreshToken) {
    await query(
      "UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
      [digestToken(refreshToken)],
    );
    return;
  }
  const accessToken = accessTokenFrom(request);
  const payload = accessToken ? verifyAccessToken(accessToken) : null;
  if (payload) {
    await query("UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [payload.sid]);
  }
}

export async function rotateCurrentSession(request: Request): Promise<{ maxAgeMs: number; sessionId: string; token: string; userId: string }> {
  const refreshToken = refreshTokenFrom(request);
  if (!refreshToken) {
    throw new AppError(401, "SESSION_EXPIRED");
  }
  return transaction(async (client) => {
    const existing = await client.query<{ created_at: Date; expires_at: Date; user_id: string }>(
      `SELECT user_id, created_at, expires_at
         FROM sessions
        WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
        FOR UPDATE`,
      [digestToken(refreshToken)],
    );
    const session = existing.rows[0];
    if (!session) {
      throw new AppError(401, "SESSION_EXPIRED");
    }
    await client.query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1", [digestToken(refreshToken)]);
    const remembered = session.expires_at.getTime() - session.created_at.getTime() > 24 * 60 * 60 * 1_000;
    return createSession(client, session.user_id, remembered);
  });
}
