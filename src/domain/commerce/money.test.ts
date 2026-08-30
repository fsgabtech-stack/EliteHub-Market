import assert from "node:assert/strict";
import test from "node:test";

import { calculateOrderTotal, calculatePercentageDiscount } from "./money.js";

test("calcula desconto percentual em pontos-base sem usar ponto flutuante", () => {
  assert.equal(calculatePercentageDiscount(19_999, 1_250), 2_499);
});

test("impede total negativo", () => {
  assert.throws(() => calculateOrderTotal(1_000, 0, 1_001));
});
