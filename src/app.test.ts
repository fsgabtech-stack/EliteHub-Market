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
    const response = await fetch(`${origin}/`, { redirect: "manual" });
    assert.ok(response.status === 200 || response.status === 302);
    if (response.status === 200) {
      const page = await response.text();
      assert.match(page, /id="root"/);
      return;
    }
    assert.equal(response.headers.get("location"), "/static/elitehub.html");
    const legacy = await fetch(`${origin}/static/elitehub.html`);
    const page = await legacy.text();
    assert.match(page, /id="catalog-page"/);
    assert.match(page, /avatar-login-elitehub\.png/);
  });
});

test("serve os recursos globais de motion", async () => {
  await withApplication(async (origin) => {
    const [style, script] = await Promise.all([
      fetch(`${origin}/static/motion.css`),
      fetch(`${origin}/static/motion.js`),
    ]);
    assert.equal(style.status, 200);
    assert.equal(script.status, 200);
    assert.match(await style.text(), /prefers-reduced-motion/);
    assert.match(await script.text(), /EliteHubMotion/);
  });
});

test("serve o avatar de autenticação fornecido como imagem PNG", async () => {
  await withApplication(async (origin) => {
    const response = await fetch(`${origin}/static/assets/avatar-login-elitehub.png`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /image\/png/);
    assert.ok((await response.arrayBuffer()).byteLength > 1_000_000);
  });
});

test("informa a disponibilidade real dos provedores de autenticação", async () => {
  await withApplication(async (origin) => {
    const response = await fetch(`${origin}/api/v1/auth/providers`);
    assert.equal(response.status, 200);
    const body = await response.json() as { google: unknown; microsoft: unknown };
    assert.equal(typeof body.google, "boolean");
    assert.equal(typeof body.microsoft, "boolean");
  });
});

test("expõe somente meios de pagamento realmente disponíveis para visitantes", async () => {
  await withApplication(async (origin) => {
    const response = await fetch(`${origin}/api/v1/payments/availability`);
    assert.equal(response.status, 200);
    const body = await response.json() as { methods: Array<{ available: boolean; code: string }> };
    assert.ok(body.methods.some((method) => method.code === "PIX"));
    assert.equal(body.methods.find((method) => method.code === "CREDIT_CARD")?.available, false);
    assert.equal(body.methods.find((method) => method.code === "BOLETO")?.available, false);
  });
});

test("recusa consulta de frete com CEP ou UF inválidos", async () => {
  await withApplication(async (origin) => {
    const response = await fetch(`${origin}/api/v1/shipping/quote?postalCode=invalido&state=sp`);
    assert.equal(response.status, 400);
  });
});

test("permite consultar o catálogo publicamente quando a persistência está disponível", { skip: !config.databaseUrl }, async () => {
  await withApplication(async (origin) => {
    const response = await fetch(`${origin}/api/v1/catalog/products?limit=1`);
    assert.equal(response.status, 200);
    const body = await response.json() as { items: Array<{ availability?: unknown; stockQuantity?: unknown }>; page: { total: number } };
    assert.ok(Array.isArray(body.items));
    assert.equal(typeof body.page.total, "number");
    if (body.items[0]) {
      assert.equal(typeof body.items[0].availability, "string");
      assert.equal(body.items[0].stockQuantity, undefined);
    }
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

    const review = await fetch(`${origin}/api/v1/products/00000000-0000-4000-8000-000000000001/reviews`, {
      body: JSON.stringify({ body: "Avaliação válida de uma compra entregue.", rating: 5, title: "Muito bom" }),
      headers: {
        "content-type": "application/json",
        cookie: setCookie.split(";")[0],
        "x-csrf-token": decodeURIComponent(csrfValue),
      },
      method: "POST",
    });
    assert.equal(review.status, 401);
  });
});
