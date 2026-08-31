import { config } from "../config.js";
import { closePool, transaction } from "../db/pool.js";
import { hashPassword } from "../domain/auth/password.js";

type SeedUser = {
  email: string;
  fullName: string;
  password: string;
  roles: readonly ("CUSTOMER" | "SELLER" | "ADMIN")[];
};

type SeedProduct = {
  attributes: Readonly<Record<string, string>>;
  categorySlug: string;
  description: string;
  imageUrl: string;
  priceCents: number;
  sku: string;
  stockQuantity: number;
  title: string;
  variants?: readonly {
    attributes: Readonly<Record<string, string>>;
    priceCents: number | null;
    sku: string;
    stockQuantity: number;
  }[];
};

const contas: Record<"admin" | "cliente" | "vendedor" | "vendedorPendente", SeedUser> = {
  admin: {
    email: "admin.dev@elitehub.local",
    fullName: "Administração EliteHub",
    password: "AdminEliteHub#2026",
    roles: ["CUSTOMER", "ADMIN"],
  },
  cliente: {
    email: "cliente.dev@elitehub.local",
    fullName: "Cliente Desenvolvimento",
    password: "ClienteEliteHub#2026",
    roles: ["CUSTOMER"],
  },
  vendedor: {
    email: "vendedor.dev@elitehub.local",
    fullName: "Marina Costa",
    password: "VendedorEliteHub#2026",
    roles: ["CUSTOMER", "SELLER"],
  },
  vendedorPendente: {
    email: "vendedor.pendente.dev@elitehub.local",
    fullName: "Rafael Lima",
    password: "PendenteEliteHub#2026",
    roles: ["CUSTOMER", "SELLER"],
  },
};

const categorias = [
  { name: "Eletrônicos", slug: "eletronicos" },
  { name: "Moda", slug: "moda" },
  { name: "Casa e decoração", slug: "casa-e-decoracao" },
  { name: "Acessórios", slug: "acessorios" },
] as const;

const produtos: readonly SeedProduct[] = [
  {
    attributes: { bateria: "30 horas", conectividade: "Bluetooth 5.3", garantia: "12 meses" },
    categorySlug: "eletronicos",
    description: "Fone sem fio com cancelamento passivo de ruído, estojo de recarga USB-C e controles táteis para uso diário.",
    imageUrl: "/static/assets/dev-products/fone-aurora.svg",
    priceCents: 14990,
    sku: "EH-DEV-FONE-AURORA",
    stockQuantity: 36,
    title: "Fone Bluetooth Aurora",
    variants: [
      { attributes: { cor: "Azul" }, priceCents: null, sku: "EH-DEV-FONE-AURORA-AZUL", stockQuantity: 18 },
      { attributes: { cor: "Grafite" }, priceCents: null, sku: "EH-DEV-FONE-AURORA-GRAFITE", stockQuantity: 18 },
    ],
  },
  {
    attributes: { capacidade: "22 litros", material: "Poliéster reciclado", compartimentos: "3" },
    categorySlug: "acessorios",
    description: "Mochila urbana resistente à água, com compartimento acolchoado para notebook de até 15 polegadas e organização interna.",
    imageUrl: "/static/assets/dev-products/mochila-urbana.svg",
    priceCents: 18990,
    sku: "EH-DEV-MOCHILA-URBANA",
    stockQuantity: 24,
    title: "Mochila Urbana Atlas",
    variants: [
      { attributes: { cor: "Areia" }, priceCents: null, sku: "EH-DEV-MOCHILA-ATLAS-AREIA", stockQuantity: 12 },
      { attributes: { cor: "Marinho" }, priceCents: null, sku: "EH-DEV-MOCHILA-ATLAS-MARINHO", stockQuantity: 12 },
    ],
  },
  {
    attributes: { acabamento: "Alumínio fosco", potencia: "8W LED", temperatura: "3000K" },
    categorySlug: "casa-e-decoracao",
    description: "Luminária de mesa com luz quente, haste ajustável e acionamento sensível ao toque para escritório ou leitura.",
    imageUrl: "/static/assets/dev-products/luminaria-orbita.svg",
    priceCents: 12990,
    sku: "EH-DEV-LUMINARIA-ORBITA",
    stockQuantity: 15,
    title: "Luminária de Mesa Órbita",
  },
  {
    attributes: { entrada: "USB-C", potencia: "65W", protecao: "Sobretensão e temperatura" },
    categorySlug: "eletronicos",
    description: "Carregador compacto de 65W com porta USB-C Power Delivery para notebook, tablet e smartphone compatíveis.",
    imageUrl: "/static/assets/dev-products/carregador-pulse.svg",
    priceCents: 11990,
    sku: "EH-DEV-CARREGADOR-PULSE",
    stockQuantity: 42,
    title: "Carregador USB-C Pulse 65W",
  },
];

function assertDevelopmentSeedIsAllowed(): void {
  if (config.nodeEnv !== "development" || process.env.ELITEHUB_DEVELOPMENT_SEED !== "enabled") {
    throw new Error("A seed de desenvolvimento exige NODE_ENV=development e ELITEHUB_DEVELOPMENT_SEED=enabled.");
  }
}

async function upsertUser(client: import("pg").PoolClient, account: SeedUser): Promise<string> {
  const passwordHash = await hashPassword(account.password);
  const result = await client.query<{ id: string }>(
    `INSERT INTO users(full_name, email, password_hash, email_verified_at, deleted_at, anonymized_at)
     VALUES ($1, $2, $3, now(), NULL, NULL)
     ON CONFLICT (email) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           password_hash = EXCLUDED.password_hash,
           email_verified_at = COALESCE(users.email_verified_at, now()),
           deleted_at = NULL,
           anonymized_at = NULL,
           updated_at = now()
     RETURNING id`,
    [account.fullName, account.email, passwordHash],
  );
  const user = result.rows[0];
  if (!user) throw new Error(`Não foi possível criar a conta ${account.email}.`);
  for (const role of account.roles) {
    await client.query("INSERT INTO user_roles(user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING", [user.id, role]);
  }
  return user.id;
}

async function upsertCategory(client: import("pg").PoolClient, category: { name: string; slug: string }): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO categories(name, slug)
     VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [category.name, category.slug],
  );
  const value = result.rows[0];
  if (!value) throw new Error(`Não foi possível criar a categoria ${category.slug}.`);
  return value.id;
}

async function upsertProduct(client: import("pg").PoolClient, sellerId: string, categoryId: string, product: SeedProduct): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM products WHERE seller_id = $1 AND sku = $2 AND deleted_at IS NULL FOR UPDATE`,
    [sellerId, product.sku],
  );
  const current = existing.rows[0];
  if (current) {
    await client.query(
      `UPDATE products
          SET category_id = $2, title = $3, description = $4, image_url = $5,
              price_cents = $6, stock_quantity = $7, status = 'ACTIVE',
              attributes = $8::jsonb, updated_at = now()
        WHERE id = $1`,
      [current.id, categoryId, product.title, product.description, product.imageUrl, product.priceCents, product.stockQuantity, JSON.stringify(product.attributes)],
    );
    return current.id;
  }
  const created = await client.query<{ id: string }>(
    `INSERT INTO products(seller_id, category_id, title, description, image_url, price_cents, stock_quantity, status, sku, attributes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, $9::jsonb)
     RETURNING id`,
    [sellerId, categoryId, product.title, product.description, product.imageUrl, product.priceCents, product.stockQuantity, product.sku, JSON.stringify(product.attributes)],
  );
  const value = created.rows[0];
  if (!value) throw new Error(`Não foi possível criar o produto ${product.sku}.`);
  return value.id;
}

async function ensureInitialInventory(client: import("pg").PoolClient, productId: string, sellerId: string, delta: number, variantId?: string): Promise<void> {
  await client.query(
    `INSERT INTO inventory_movements(product_id, variant_id, delta, reason, actor_user_id)
     SELECT $1, $2, $3, 'INITIAL_STOCK', $4
      WHERE NOT EXISTS (
        SELECT 1 FROM inventory_movements
         WHERE product_id = $1 AND variant_id IS NOT DISTINCT FROM $2 AND reason = 'INITIAL_STOCK'
      )`,
    [productId, variantId ?? null, delta, sellerId],
  );
}

async function upsertVariants(client: import("pg").PoolClient, productId: string, sellerId: string, product: SeedProduct): Promise<void> {
  await ensureInitialInventory(client, productId, sellerId, product.stockQuantity);
  for (const variant of product.variants ?? []) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO product_variants(product_id, sku, attributes, price_cents, stock_quantity)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (product_id, sku) DO UPDATE
         SET attributes = EXCLUDED.attributes, price_cents = EXCLUDED.price_cents,
             stock_quantity = EXCLUDED.stock_quantity, updated_at = now()
       RETURNING id`,
      [productId, variant.sku, JSON.stringify(variant.attributes), variant.priceCents, variant.stockQuantity],
    );
    const value = result.rows[0];
    if (!value) throw new Error(`Não foi possível criar a variação ${variant.sku}.`);
    await ensureInitialInventory(client, productId, sellerId, variant.stockQuantity, value.id);
  }
}

async function ensureAddress(client: import("pg").PoolClient, customerId: string): Promise<string> {
  const current = await client.query<{ id: string }>(
    "SELECT id FROM addresses WHERE user_id = $1 AND label = 'Casa de desenvolvimento' ORDER BY created_at ASC LIMIT 1 FOR UPDATE",
    [customerId],
  );
  const address = current.rows[0];
  if (address) return address.id;
  const result = await client.query<{ id: string }>(
    `INSERT INTO addresses(user_id, label, recipient_name, postal_code, street, number, complement, neighborhood, city, state)
     VALUES ($1, 'Casa de desenvolvimento', 'Cliente Desenvolvimento', '01310930', 'Avenida Paulista', '1000', 'Conjunto 101', 'Bela Vista', 'São Paulo', 'SP')
     RETURNING id`,
    [customerId],
  );
  const value = result.rows[0];
  if (!value) throw new Error("Não foi possível criar o endereço de desenvolvimento.");
  return value.id;
}

async function ensureHistoricalOrder(
  client: import("pg").PoolClient,
  customerId: string,
  sellerId: string,
  addressId: string,
  productId: string,
  product: SeedProduct,
): Promise<void> {
  const number = "EH-DEV-HISTORICO-0001";
  const existing = await client.query<{ id: string }>("SELECT id FROM orders WHERE order_number = $1 FOR UPDATE", [number]);
  const order = existing.rows[0] ?? (await client.query<{ id: string }>(
    `INSERT INTO orders(order_number, buyer_id, seller_id, address_id, status, payment_status, subtotal_cents, shipping_cents, discount_cents, total_cents)
     VALUES ($1, $2, $3, $4, 'DELIVERED', 'APPROVED', $5, 0, 0, $5)
     RETURNING id`,
    [number, customerId, sellerId, addressId, product.priceCents],
  )).rows[0];
  if (!order) throw new Error("Não foi possível criar o pedido histórico de desenvolvimento.");
  await client.query(
    `INSERT INTO order_items(order_id, product_id, variant_id, title_snapshot, unit_price_cents, quantity)
     SELECT $1, $2, NULL, $3, $4, 1
      WHERE NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = $1 AND product_id = $2)`,
    [order.id, productId, product.title, product.priceCents],
  );
  await client.query(
    `INSERT INTO order_status_history(order_id, from_status, to_status, actor_user_id, reason)
     SELECT $1, NULL, 'DELIVERED', $2, 'Pedido histórico para validação local'
      WHERE NOT EXISTS (SELECT 1 FROM order_status_history WHERE order_id = $1)`,
    [order.id, customerId],
  );
  await client.query(
    `INSERT INTO product_reviews(product_id, buyer_id, order_id, rating, title, body, status)
     VALUES ($1, $2, $3, 5, 'Produto muito bom', 'Compra de desenvolvimento para validar a fila real de moderação de avaliações.', 'PENDING')
     ON CONFLICT (product_id, buyer_id) DO UPDATE
       SET order_id = EXCLUDED.order_id, rating = EXCLUDED.rating, title = EXCLUDED.title,
           body = EXCLUDED.body, status = 'PENDING', moderation_note = NULL,
           moderated_by = NULL, moderated_at = NULL, updated_at = now()`,
    [productId, customerId, order.id],
  );
}

async function ensureCoupon(client: import("pg").PoolClient, adminId: string): Promise<void> {
  const updated = await client.query<{ id: string }>(
    `UPDATE coupons
        SET discount_type = 'PERCENTAGE', discount_value = 1000, minimum_order_cents = 5000,
            usage_limit = 1000, usage_count = 0, starts_at = now() - interval '1 day',
            expires_at = now() + interval '365 days', active = true, updated_at = now()
      WHERE upper(code) = 'BEMVINDO10'
      RETURNING id`,
  );
  if (updated.rows[0]) return;
  await client.query(
    `INSERT INTO coupons(code, scope, seller_id, discount_type, discount_value, minimum_order_cents, usage_limit, starts_at, expires_at, active, created_by)
     VALUES ('BEMVINDO10', 'PLATFORM', NULL, 'PERCENTAGE', 1000, 5000, 1000, now() - interval '1 day', now() + interval '365 days', true, $1)`,
    [adminId],
  );
}

async function seed(): Promise<void> {
  assertDevelopmentSeedIsAllowed();
  await transaction(async (client) => {
    const customerId = await upsertUser(client, contas.cliente);
    const sellerId = await upsertUser(client, contas.vendedor);
    const adminId = await upsertUser(client, contas.admin);
    const pendingSellerId = await upsertUser(client, contas.vendedorPendente);
    await client.query(
      `INSERT INTO seller_profiles(user_id, store_name, legal_name, description, support_email, approval_status)
       VALUES ($1, 'Aurora Store', 'Aurora Store Desenvolvimento LTDA', 'Loja local aprovada para validar catálogo, estoque, pedidos recebidos e atualizações de status.', 'suporte.dev@elitehub.local', 'APPROVED')
       ON CONFLICT (user_id) DO UPDATE
         SET store_name = EXCLUDED.store_name, legal_name = EXCLUDED.legal_name,
             description = EXCLUDED.description, support_email = EXCLUDED.support_email,
             approval_status = 'APPROVED', updated_at = now()`,
      [sellerId],
    );
    await client.query(
      `INSERT INTO seller_profiles(user_id, store_name, legal_name, description, support_email, approval_status)
       VALUES ($1, 'Oficina Pendente', 'Oficina Pendente Desenvolvimento LTDA', 'Cadastro local pendente para validar a moderação administrativa de vendedores.', 'pendente.dev@elitehub.local', 'PENDING')
       ON CONFLICT (user_id) DO UPDATE
         SET store_name = EXCLUDED.store_name, legal_name = EXCLUDED.legal_name,
             description = EXCLUDED.description, support_email = EXCLUDED.support_email,
             approval_status = 'PENDING', updated_at = now()`,
      [pendingSellerId],
    );
    const categoryIds = new Map<string, string>();
    for (const category of categorias) categoryIds.set(category.slug, await upsertCategory(client, category));
    const productIds = new Map<string, string>();
    for (const product of produtos) {
      const categoryId = categoryIds.get(product.categorySlug);
      if (!categoryId) throw new Error(`Categoria ausente para ${product.sku}.`);
      const productId = await upsertProduct(client, sellerId, categoryId, product);
      await upsertVariants(client, productId, sellerId, product);
      productIds.set(product.sku, productId);
    }
    const historicalProduct = produtos[0];
    const historicalProductId = historicalProduct ? productIds.get(historicalProduct.sku) : undefined;
    if (!historicalProduct || !historicalProductId) throw new Error("Produto histórico de desenvolvimento ausente.");
    const addressId = await ensureAddress(client, customerId);
    await ensureHistoricalOrder(client, customerId, sellerId, addressId, historicalProductId, historicalProduct);
    await ensureCoupon(client, adminId);
  });
  console.log("Seed de desenvolvimento concluída com contas, catálogo, estoque e dados de moderação locais.");
}

seed()
  .catch((error: unknown) => {
    console.error("Seed de desenvolvimento falhou", { message: error instanceof Error ? error.message : "Erro desconhecido" });
    process.exitCode = 1;
  })
  .finally(async () => closePool());
