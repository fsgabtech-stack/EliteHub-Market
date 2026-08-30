import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { verifyMercadoPagoWebhookSignature, verifyStripeWebhookSignature } from "./payment-gateway.js";

test("aceita assinatura Stripe atual e preserva rotação de segredo", () => {
  const body = Buffer.from('{"id":"evt_1"}', "utf8");
  const timestamp = "1735689600";
  const secret = "segredo-de-teste";
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body.toString("utf8")}`).digest("hex");

  assert.equal(verifyStripeWebhookSignature({
    header: `t=${timestamp},v1=invalida,v1=${signature}`,
    nowMilliseconds: 1_735_689_600_000,
    rawBody: body,
    secret,
  }), true);
});

test("rejeita assinatura Stripe expirada ou adulterada", () => {
  const body = Buffer.from('{"id":"evt_1"}', "utf8");
  const timestamp = "1735689600";
  const secret = "segredo-de-teste";
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body.toString("utf8")}`).digest("hex");

  assert.equal(verifyStripeWebhookSignature({
    header: `t=${timestamp},v1=${signature}`,
    nowMilliseconds: 1_735_690_000_000,
    rawBody: body,
    secret,
  }), false);
  assert.equal(verifyStripeWebhookSignature({
    header: `t=${timestamp},v1=${signature}`,
    nowMilliseconds: 1_735_689_600_000,
    rawBody: Buffer.from('{"id":"evt_alterado"}', "utf8"),
    secret,
  }), false);
});

test("aceita somente a assinatura Mercado Pago formada com o manifesto esperado", () => {
  const secret = "segredo-mercado";
  const dataId = "12345";
  const requestId = "requisicao-1";
  const timestamp = "1735689600";
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  const signature = createHmac("sha256", secret).update(manifest).digest("hex");
  const headers = { "x-request-id": requestId, "x-signature": `ts=${timestamp},v1=${signature}` };

  assert.equal(verifyMercadoPagoWebhookSignature({ dataId, headers, secret }), true);
  assert.equal(verifyMercadoPagoWebhookSignature({ dataId: "12346", headers, secret }), false);
});
