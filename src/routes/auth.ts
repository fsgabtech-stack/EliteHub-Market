import { randomUUID } from "node:crypto";

import type { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";

import { config } from "../config.js";
import { transaction } from "../db/pool.js";
import {
  beginGoogleAuthorization,
  completeGoogleAuthorization,
} from "../domain/auth/google-oauth.js";
import { hashPassword, hasValidPasswordShape, verifyPassword } from "../domain/auth/password.js";
import {
  createSession,
  currentSession,
  requireSession,
  revokeCurrentSession,
  rotateCurrentSession,
} from "../domain/auth/session.js";
import { issueAccessToken } from "../domain/auth/access-token.js";
import { sealServerValue } from "../domain/auth/secret-envelope.js";
import { AppError, asyncRoute, invalidRequest } from "../http/errors.js";
import { logger } from "../observability/logger.js";
import {
  csrfCookieOptions,
  accessTokenCookieOptions,
  ACCESS_TOKEN_COOKIE,
  csrfProtection,
  newOpaqueToken,
  sessionCookieOptions,
  SESSION_COOKIE,
  CSRF_COOKIE,
  digestToken,
} from "../http/security.js";

const registrationSchema = z
  .object({
    fullName: z.string().trim().min(3).max(160),
    email: z.string().trim().toLowerCase().email().max(320),
    password: z.string(),
    passwordConfirmation: z.string(),
  })
  .superRefine((value, context) => {
    if (value.password !== value.passwordConfirmation) {
      context.addIssue({ code: "custom", message: "password-mismatch", path: ["passwordConfirmation"] });
    }
    if (!hasValidPasswordShape(value.password)) {
      context.addIssue({ code: "custom", message: "password-policy", path: ["password"] });
    }
  });

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(256),
  rememberMe: z.boolean().optional().default(false),
});

const recoverySchema = z.object({ email: z.string().trim().toLowerCase().email().max(320) });
const emailVerificationSchema = z.object({ token: z.string().min(40).max(200) });

const passwordResetSchema = z
  .object({
    password: z.string(),
    passwordConfirmation: z.string(),
    token: z.string().min(40).max(200),
  })
  .superRefine((value, context) => {
    if (value.password !== value.passwordConfirmation) {
      context.addIssue({ code: "custom", message: "password-mismatch", path: ["passwordConfirmation"] });
    }
    if (!hasValidPasswordShape(value.password)) {
      context.addIssue({ code: "custom", message: "password-policy", path: ["password"] });
    }
  });

const authLimiter = rateLimit({
  handler: (_request, _response, next) => next(new AppError(429, "RATE_LIMITED")),
  limit: config.api.authRateLimitMax,
  standardHeaders: "draft-8",
  windowMs: 15 * 60 * 1000,
});

const googleInitiationLimiter = rateLimit({
  handler: (_request, response) => {
    response.redirect("/?auth_error=google_rate_limited");
  },
  limit: 10,
  standardHeaders: "draft-8",
  windowMs: 15 * 60 * 1000,
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw invalidRequest();
  }
  return parsed.data;
}

async function enqueueEmailVerification(client: import("pg").PoolClient, userId: string, recipientEmail: string): Promise<void> {
  const rawToken = newOpaqueToken();
  await client.query("UPDATE email_confirmation_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [userId]);
  await client.query(
    `INSERT INTO email_confirmation_tokens(user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '24 hours')`,
    [userId, digestToken(rawToken)],
  );
  await client.query(
    `INSERT INTO outbox_events(aggregate_type, aggregate_id, event_type, payload)
     VALUES ('USER', $1, 'email.confirmation_requested', $2::jsonb)`,
    [
      userId,
      JSON.stringify({
        confirmationTokenEnvelope: sealServerValue(rawToken),
        recipientEmail,
      }),
    ],
  );
}

export function registerAuthRoutes(router: Router): void {
  router.get("/security/csrf", (request, response) => {
    const existing = request.cookies[CSRF_COOKIE];
    const token = typeof existing === "string" ? existing : newOpaqueToken();
    response.cookie(CSRF_COOKIE, token, csrfCookieOptions).json({ ok: true });
  });

  router.get("/auth/providers", (_request, response) => {
    response.json({
      google: Boolean(config.google.clientId && config.google.clientSecret),
      microsoft: false,
    });
  });

  router.get(
    "/auth/session",
    asyncRoute(async (request, response) => {
      const session = await currentSession(request);
      if (!session) {
        response.status(401).json({ error: { code: "SESSION_EXPIRED", message: "Sua sessão expirou. Entre novamente para continuar." } });
        return;
      }
      response.json({ user: session });
    }),
  );

  router.post(
    "/auth/register",
    authLimiter,
    csrfProtection,
    asyncRoute(async (request, response) => {
      const input = parseBody(registrationSchema, request.body);
      const passwordHash = await hashPassword(input.password);

      await transaction(async (client) => {
        const created = await client.query<{ id: string }>(
          `INSERT INTO users(full_name, email, password_hash)
           VALUES ($1, $2, $3)
           ON CONFLICT (email) DO NOTHING
           RETURNING id`,
          [input.fullName, input.email, passwordHash],
        );
        const user = created.rows[0];
        if (!user) {
          return;
        }
        await client.query("INSERT INTO user_roles(user_id, role) VALUES ($1, 'CUSTOMER')", [user.id]);
        await client.query(
          `INSERT INTO audit_events(actor_user_id, action, target_type, target_id)
           VALUES ($1, 'AUTH_REGISTERED', 'USER', $1)`,
          [user.id],
        );
        await enqueueEmailVerification(client, user.id, input.email);
      });

      response.status(202).json({
        message: "Solicitação processada. Você poderá entrar caso a conta tenha sido criada.",
      });
    }),
  );

  router.post(
    "/auth/email-verification",
    authLimiter,
    csrfProtection,
    asyncRoute(async (request, response) => {
      const input = parseBody(emailVerificationSchema, request.body);
      await transaction(async (client) => {
        const found = await client.query<{ id: string; user_id: string }>(
          `SELECT id, user_id
             FROM email_confirmation_tokens
            WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
            FOR UPDATE`,
          [digestToken(input.token)],
        );
        const token = found.rows[0];
        if (!token) {
          throw new AppError(400, "INVALID_REQUEST");
        }
        await client.query("UPDATE email_confirmation_tokens SET used_at = now() WHERE id = $1", [token.id]);
        await client.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1", [token.user_id]);
        await client.query(
          `INSERT INTO audit_events(actor_user_id, action, target_type, target_id)
           VALUES ($1, 'EMAIL_VERIFIED', 'USER', $1)`,
          [token.user_id],
        );
      });
      response.json({ message: "E-mail confirmado com segurança." });
    }),
  );

  router.post(
    "/auth/email-verification/resend",
    authLimiter,
    csrfProtection,
    asyncRoute(async (request, response) => {
      if (!config.smtpUrl || !config.smtpFrom) {
        throw new AppError(503, "EMAIL_DELIVERY_UNAVAILABLE");
      }
      const user = await requireSession(request);
      if (!user.emailVerified) {
        await transaction((client) => enqueueEmailVerification(client, user.id, user.email));
      }
      response.status(202).json({ message: "Se necessário, enviaremos uma nova confirmação para seu e-mail." });
    }),
  );

  router.post(
    "/auth/login",
    authLimiter,
    csrfProtection,
    asyncRoute(async (request, response) => {
      const input = parseBody(loginSchema, request.body);
      const session = await transaction(async (client) => {
        const failures = await client.query<{
          failure_count: number;
          window_started_at: Date;
          locked_until: Date | null;
        }>(
          "SELECT failure_count, window_started_at, locked_until FROM auth_login_failures WHERE email = $1 FOR UPDATE",
          [input.email],
        );
        const failure = failures.rows[0];
        if (failure?.locked_until && failure.locked_until > new Date()) {
          throw new AppError(429, "RATE_LIMITED");
        }

        const users = await client.query<{ id: string; password_hash: string | null }>(
          "SELECT id, password_hash FROM users WHERE email = $1",
          [input.email],
        );
        const user = users.rows[0];
        const storedHash = user?.password_hash;
        const valid = storedHash
          ? await verifyPassword(storedHash, input.password)
          : false;
        if (!user || !valid) {
          const sameWindow = Boolean(
            failure && Date.now() - failure.window_started_at.getTime() < 15 * 60 * 1000,
          );
          const failureCount = sameWindow ? (failure?.failure_count ?? 0) + 1 : 1;
          const lockedUntil = failureCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
          await client.query(
            `INSERT INTO auth_login_failures(email, failure_count, window_started_at, locked_until)
             VALUES ($1, $2, now(), $3)
             ON CONFLICT (email) DO UPDATE SET
               failure_count = EXCLUDED.failure_count,
               window_started_at = EXCLUDED.window_started_at,
               locked_until = EXCLUDED.locked_until,
               updated_at = now()`,
            [input.email, failureCount, lockedUntil],
          );
          await client.query(
            `INSERT INTO audit_events(action, target_type, metadata)
             VALUES ('AUTH_LOGIN_FAILED', 'EMAIL', jsonb_build_object('emailHash', $1))`,
            [digestToken(input.email)],
          );
          throw new AppError(401, "UNAUTHORIZED");
        }

        await client.query("DELETE FROM auth_login_failures WHERE email = $1", [input.email]);
        await client.query(
          `INSERT INTO audit_events(actor_user_id, action, target_type, target_id)
           VALUES ($1, 'AUTH_LOGIN_SUCCEEDED', 'USER', $1)`,
          [user.id],
        );
        return createSession(client, user.id, input.rememberMe);
      });

      response
        .cookie(SESSION_COOKIE, session.token, { ...sessionCookieOptions, maxAge: session.maxAgeMs })
        .cookie(ACCESS_TOKEN_COOKIE, issueAccessToken({ sessionId: session.sessionId, userId: session.userId }), accessTokenCookieOptions)
        .status(200)
        .json({ message: "Login realizado com segurança." });
    }),
  );

  router.post(
    "/auth/logout",
    csrfProtection,
    asyncRoute(async (request, response) => {
      await revokeCurrentSession(request);
      response
        .clearCookie(SESSION_COOKIE, sessionCookieOptions)
        .clearCookie(ACCESS_TOKEN_COOKIE, accessTokenCookieOptions)
        .status(204)
        .send();
    }),
  );

  router.post(
    "/auth/password-recovery",
    authLimiter,
    csrfProtection,
    asyncRoute(async (request, response) => {
      const input = parseBody(recoverySchema, request.body);
      if (!config.smtpUrl || !config.smtpFrom) {
        throw new AppError(503, "EMAIL_DELIVERY_UNAVAILABLE");
      }
      await transaction(async (client) => {
        const users = await client.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [input.email]);
        const user = users.rows[0];
        if (!user) {
          return;
        }
        const rawToken = newOpaqueToken();
        await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [user.id]);
        await client.query(
          `INSERT INTO password_reset_tokens(user_id, token_hash, expires_at)
           VALUES ($1, $2, now() + interval '30 minutes')`,
          [user.id, digestToken(rawToken)],
        );
        await client.query(
          `INSERT INTO outbox_events(aggregate_type, aggregate_id, event_type, payload)
           VALUES ('USER', $1, 'email.password_reset_requested', $2::jsonb)`,
          [
            user.id,
            JSON.stringify({
              recipientEmail: input.email,
              resetTokenEnvelope: sealServerValue(rawToken),
            }),
          ],
        );
        await client.query(
          `INSERT INTO audit_events(actor_user_id, action, target_type, target_id)
           VALUES ($1, 'PASSWORD_RESET_REQUESTED', 'USER', $1)`,
          [user.id],
        );
      });
      response.status(202).json({
        message: "Se existir uma conta para este e-mail, enviaremos as instruções de recuperação.",
      });
    }),
  );

  router.post(
    "/auth/password-reset",
    authLimiter,
    csrfProtection,
    asyncRoute(async (request, response) => {
      const input = parseBody(passwordResetSchema, request.body);
      const passwordHash = await hashPassword(input.password);
      await transaction(async (client) => {
        const tokens = await client.query<{ id: string; user_id: string }>(
          `SELECT id, user_id
           FROM password_reset_tokens
           WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
           FOR UPDATE`,
          [digestToken(input.token)],
        );
        const token = tokens.rows[0];
        if (!token) {
          throw new AppError(400, "INVALID_REQUEST");
        }

        await client.query(
          "UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1",
          [token.user_id, passwordHash],
        );
        await client.query(
          "UPDATE password_reset_tokens SET used_at = now() WHERE id = $1",
          [token.id],
        );
        await client.query(
          "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
          [token.user_id],
        );
        await client.query(
          `INSERT INTO audit_events(actor_user_id, action, target_type, target_id)
           VALUES ($1, 'PASSWORD_RESET_COMPLETED', 'USER', $1)`,
          [token.user_id],
        );
      });
      response.json({ message: "Sua senha foi redefinida. Entre novamente para continuar." });
    }),
  );

  router.get("/auth/google", googleInitiationLimiter, asyncRoute(async (_request, response) => {
    if (!config.google.clientId || !config.google.clientSecret) {
      response.redirect("/?auth_error=google_unavailable");
      return;
    }
    try {
      response.redirect(await beginGoogleAuthorization());
    } catch {
      logger.warn("início do OAuth Google falhou");
      response.redirect("/?auth_error=google_unavailable");
    }
  }));

  router.get("/auth/google/callback", asyncRoute(async (request, response) => {
    const code = typeof request.query.code === "string" ? request.query.code : undefined;
    const state = typeof request.query.state === "string" ? request.query.state : undefined;
    if (!code || !state || typeof request.query.error === "string") {
      response.redirect("/?auth_error=google_callback_failed");
      return;
    }
    try {
      const session = await completeGoogleAuthorization(code, state);
      response
        .cookie(SESSION_COOKIE, session.token, { ...sessionCookieOptions, maxAge: session.maxAgeMs })
        .cookie(ACCESS_TOKEN_COOKIE, issueAccessToken({ sessionId: session.sessionId, userId: session.userId }), accessTokenCookieOptions)
        .redirect("/");
    } catch {
      logger.warn("callback do OAuth Google falhou");
      response.redirect("/?auth_error=google_callback_failed");
    }
  }));

  router.post(
    "/auth/refresh",
    csrfProtection,
    asyncRoute(async (request, response) => {
      const session = await rotateCurrentSession(request);
      response
        .cookie(SESSION_COOKIE, session.token, { ...sessionCookieOptions, maxAge: session.maxAgeMs })
        .cookie(ACCESS_TOKEN_COOKIE, issueAccessToken({ sessionId: session.sessionId, userId: session.userId }), accessTokenCookieOptions)
        .json({ message: "Sessão renovada com segurança." });
    }),
  );

  router.get(
    "/auth/require-session",
    asyncRoute(async (request, response) => {
      const user = await requireSession(request);
      response.json({ user, requestId: randomUUID() });
    }),
  );
}
