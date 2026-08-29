import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { CookieOptions, RequestHandler } from "express";

import { config } from "../config.js";
import { AppError } from "./errors.js";

export const SESSION_COOKIE = "elitehub_session";
export const CSRF_COOKIE = "elitehub_csrf";

export const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  maxAge: 1000 * 60 * 60 * 8,
  path: "/",
  sameSite: "lax",
  secure: config.isProduction,
};

export const csrfCookieOptions: CookieOptions = {
  httpOnly: false,
  maxAge: 1000 * 60 * 60 * 8,
  path: "/",
  sameSite: "strict",
  secure: config.isProduction,
};

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const csrfProtection: RequestHandler = (request, _response, next) => {
  const cookie = request.cookies[CSRF_COOKIE];
  const header = request.get("x-csrf-token");

  if (typeof cookie !== "string" || typeof header !== "string") {
    return next(new AppError(403, "FORBIDDEN"));
  }

  const cookieBytes = Buffer.from(cookie);
  const headerBytes = Buffer.from(header);
  if (
    cookieBytes.length !== headerBytes.length ||
    !timingSafeEqual(cookieBytes, headerBytes)
  ) {
    return next(new AppError(403, "FORBIDDEN"));
  }

  next();
};
