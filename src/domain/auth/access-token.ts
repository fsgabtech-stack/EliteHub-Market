import { createHmac, timingSafeEqual } from "node:crypto";

import { config } from "../../config.js";

type AccessTokenPayload = {
  exp: number;
  iat: number;
  sid: string;
  sub: string;
};

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signature(data: string): string {
  if (!config.sessionSecret) {
    throw new Error("SESSION_SECRET é obrigatório para emitir tokens.");
  }
  return createHmac("sha256", config.sessionSecret).update(data).digest("base64url");
}

function equal(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function issueAccessToken(input: { sessionId: string; userId: string }): string {
  const now = Math.floor(Date.now() / 1_000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ exp: now + 15 * 60, iat: now, sid: input.sessionId, sub: input.userId } satisfies AccessTokenPayload);
  const signed = `${header}.${payload}`;
  return `${signed}.${signature(signed)}`;
}

export function verifyAccessToken(value: string): AccessTokenPayload | null {
  const [header, payload, suppliedSignature, ...rest] = value.split(".");
  if (!header || !payload || !suppliedSignature || rest.length > 0 || !equal(signature(`${header}.${payload}`), suppliedSignature)) {
    return null;
  }
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      !decoded ||
      typeof decoded !== "object" ||
      typeof (decoded as AccessTokenPayload).sub !== "string" ||
      typeof (decoded as AccessTokenPayload).sid !== "string" ||
      typeof (decoded as AccessTokenPayload).exp !== "number" ||
      (decoded as AccessTokenPayload).exp <= Math.floor(Date.now() / 1_000)
    ) {
      return null;
    }
    return decoded as AccessTokenPayload;
  } catch {
    return null;
  }
}
