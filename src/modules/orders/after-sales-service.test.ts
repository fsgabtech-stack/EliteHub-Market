import assert from "node:assert/strict";
import test from "node:test";

import { canTransitionAfterSales } from "./after-sales-service.js";

test("operações só aprovam ou recusam uma solicitação pendente", () => {
  assert.equal(canTransitionAfterSales("OPERATIONS", "PENDING", "APPROVED", "RETURN"), true);
  assert.equal(canTransitionAfterSales("OPERATIONS", "PENDING", "REJECTED", "CANCELLATION"), true);
  assert.equal(canTransitionAfterSales("OPERATIONS", "PENDING", "REFUND_PENDING", "RETURN"), false);
});

test("vendedor só confirma recebimento de devolução previamente aprovada", () => {
  assert.equal(canTransitionAfterSales("SELLER", "APPROVED", "RECEIVED", "RETURN"), true);
  assert.equal(canTransitionAfterSales("SELLER", "APPROVED", "RECEIVED", "CANCELLATION"), false);
  assert.equal(canTransitionAfterSales("SELLER", "PENDING", "RECEIVED", "RETURN"), false);
});

test("cliente só pode cancelar a própria solicitação enquanto está pendente", () => {
  assert.equal(canTransitionAfterSales("BUYER", "PENDING", "CANCELLED", "RETURN"), true);
  assert.equal(canTransitionAfterSales("BUYER", "APPROVED", "CANCELLED", "RETURN"), false);
});
