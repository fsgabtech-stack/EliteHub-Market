import assert from "node:assert/strict";
import test from "node:test";

import { hasValidPasswordShape } from "./password.js";

test("password policy accepts a long mixed password", () => {
  assert.equal(hasValidPasswordShape("SenhaForte2026"), true);
});

test("password policy rejects weak and oversized passwords", () => {
  assert.equal(hasValidPasswordShape("senhafraca"), false);
  assert.equal(hasValidPasswordShape("A1".repeat(129)), false);
});
