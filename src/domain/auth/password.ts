import argon2 from "argon2";

export function hasValidPasswordShape(password: string): boolean {
  return (
    password.length >= 12 &&
    password.length <= 256 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password)
  );
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    memoryCost: 19_456,
    parallelism: 1,
    timeCost: 2,
    type: argon2.argon2id,
  });
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
