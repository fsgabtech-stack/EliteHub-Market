import assert from "node:assert/strict";
import test from "node:test";

import { sandboxProviderConfigurationComplete } from "./payment-availability.js";

test("só considera provedor sandbox completo com chave de API e segredo de webhook", () => {
  assert.equal(sandboxProviderConfigurationComplete({ provider: "mercado_pago", sandbox: true }), false);
  assert.equal(sandboxProviderConfigurationComplete({ mercadoPagoAccessToken: "teste", mercadoPagoWebhookSecret: "segredo", provider: "mercado_pago", sandbox: true }), true);
  assert.equal(sandboxProviderConfigurationComplete({ provider: "stripe", sandbox: true, stripeSecretKey: "teste" }), false);
  assert.equal(sandboxProviderConfigurationComplete({ provider: "stripe", sandbox: true, stripeSecretKey: "teste", stripeWebhookSecret: "segredo" }), true);
  assert.equal(sandboxProviderConfigurationComplete({ provider: "stripe", sandbox: false, stripeSecretKey: "teste", stripeWebhookSecret: "segredo" }), false);
});
