import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { config } from "../../config.js";

function key(): Buffer {
  if (!config.sessionSecret) {
    throw new Error("SESSION_SECRET é obrigatória para proteger valores do servidor.");
  }
  return createHash("sha256").update(config.sessionSecret).digest();
}

export function sealServerValue(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function openServerValue(envelope: string): string {
  const input = Buffer.from(envelope, "base64url");
  if (input.length < 29) {
    throw new Error("Valor criptografado do servidor inválido.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), input.subarray(0, 12));
  decipher.setAuthTag(input.subarray(12, 28));
  return Buffer.concat([decipher.update(input.subarray(28)), decipher.final()]).toString("utf8");
}
