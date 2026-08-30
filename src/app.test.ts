import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { criarAplicacao } from "./app.js";
import { config } from "./config.js";
import { closePool } from "./db/pool.js";
import { closeRedis } from "./infrastructure/cache/redis.js";

async function withApplication<T>(callback: (origin: string) => Promise<T>): Promise<T> {
  const server = createServer(criarAplicacao());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await Promise.all([closePool(), closeRedis()]);
  }
}

test("não redireciona rotas de API inexistentes para a interface", async () => {
  await withApplication(async (origin) => {
    const response = await fetch(`${origin}/api/v1/recurso-inexistente`, {
      headers: { accept: "text/html" },
    });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "NOT_FOUND");
  });
});

test("entrega a vitrine pública sem parede de autenticação", async () => {
  await withApplication(async (origin) => {
    const response = await fetch(`${origin}/static/elitehub.html`);
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.match(page, /id="catalog-page"/);
    assert.match(page, /id="auth-dialog"/);
    assert.doesNotMatch(page, /id="auth-view"/);
  });
});

test("permite consultar o catálogo publicamente quando a persistência está disponível", { skip: !config.databaseUrl }, async () => {
  await withApplication(async (origin) => {
    const response = await fetch(`${origin}/api/v1/catalog/products?limit=1`);
    assert.equal(response.status, 200);
    const body = await response.json() as { items: unknown[]; page: { total: number } };
    assert.ok(Array.isArray(body.items));
    assert.equal(typeof body.page.total, "number");
  });
});

test("mantém carrinho e checkout protegidos para visitante anônimo", async () => {
  await withApplication(async (origin) => {
    const cart = await fetch(`${origin}/api/v1/cart`);
    assert.equal(cart.status, 401);
    const favorites = await fetch(`${origin}/api/v1/favorites`);
    assert.equal(favorites.status, 401);
    const notifications = await fetch(`${origin}/api/v1/notifications`);
    assert.equal(notifications.status, 401);

    const csrf = await fetch(`${origin}/api/v1/security/csrf`);
    assert.equal(csrf.status, 200);
    const setCookie = csrf.headers.get("set-cookie");
    assert.ok(setCookie);
    const csrfValue = /elitehub_csrf=([^;]+)/.exec(setCookie)?.[1];
    assert.ok(csrfValue);

    const checkout = await fetch(`${origin}/api/v1/checkout`, {
      body: JSON.stringify({ addressId: "00000000-0000-4000-8000-000000000001", paymentMethod: "PIX" }),
      headers: {
        "content-type": "application/json",
        cookie: setCookie.split(";")[0],
        "idempotency-key": "00000000-0000-4000-8000-000000000002",
        "x-csrf-token": decodeURIComponent(csrfValue),
      },
      method: "POST",
    });
    assert.equal(checkout.status, 401);
    const body = await checkout.json() as { error: { code: string } };
    assert.equal(body.error.code, "SESSION_EXPIRED");
  });
});
