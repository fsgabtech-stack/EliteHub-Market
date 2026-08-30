import assert from "node:assert/strict";
import test from "node:test";

import { canTransitionOrder } from "./order-status.js";

test("permite o ciclo operacional de pedido", () => {
  assert.equal(canTransitionOrder("PENDING_PAYMENT", "PAID"), true);
  assert.equal(canTransitionOrder("PAID", "PROCESSING"), true);
  assert.equal(canTransitionOrder("PROCESSING", "SHIPPED"), true);
});

test("impede regressão de pedido entregue", () => {
  assert.equal(canTransitionOrder("DELIVERED", "PROCESSING"), false);
});
