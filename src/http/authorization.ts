import type { Request } from "express";

import { AppError } from "./errors.js";
import { requireSession, type Role, type SessionUser } from "../domain/auth/session.js";

export async function requireAuthenticatedUser(request: Request): Promise<SessionUser> {
  return requireSession(request);
}

export function requireAnyRole(user: SessionUser, roles: readonly Role[]): void {
  if (!roles.some((role) => user.roles.includes(role))) {
    throw new AppError(403, "FORBIDDEN");
  }
}

export function requireVerifiedEmail(user: SessionUser): void {
  if (!user.emailVerified) {
    throw new AppError(403, "EMAIL_VERIFICATION_REQUIRED");
  }
}

export function requireSameUserOrRole(
  user: SessionUser,
  targetUserId: string,
  elevatedRoles: readonly Role[],
): void {
  if (user.id !== targetUserId && !elevatedRoles.some((role) => user.roles.includes(role))) {
    throw new AppError(403, "FORBIDDEN");
  }
}
