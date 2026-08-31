import assert from "node:assert/strict";
import test from "node:test";

import { availabilityFromStock, isAvailableForPurchase } from "./availability.js";

test("classifica disponibilidade pública sem expor a quantidade de estoque", () => {
  assert.equal(availabilityFromStock(0), "OUT_OF_STOCK");
  assert.equal(availabilityFromStock(1), "LOW_STOCK");
  assert.equal(availabilityFromStock(3), "LOW_STOCK");
  assert.equal(availabilityFromStock(4), "IN_STOCK");
  assert.equal(isAvailableForPurchase("OUT_OF_STOCK"), false);
  assert.equal(isAvailableForPurchase("IN_STOCK"), true);
});
