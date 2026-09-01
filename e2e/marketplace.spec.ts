import { expect, test, type Page } from "@playwright/test";

const mailpitBaseUrl = process.env.ELITEHUB_MAILPIT_BASE_URL ?? "http://localhost:8025";

type MensagemMailpit = { ID: string; To: Array<{ Address: string }> };

async function urlDeConfirmacao(email: string): Promise<string> {
  const limite = Date.now() + 20_000;
  while (Date.now() < limite) {
    const listagem = await fetch(`${mailpitBaseUrl}/api/v1/messages`);
    if (listagem.ok) {
      const corpo = await listagem.json() as { messages: MensagemMailpit[] };
      const mensagem = corpo.messages.find((item) => item.To.some((destinatario) => destinatario.Address === email));
      if (mensagem) {
        const detalhe = await fetch(`${mailpitBaseUrl}/api/v1/message/${encodeURIComponent(mensagem.ID)}`);
        if (detalhe.ok) {
          const conteudo = await detalhe.json() as { HTML?: string; Text?: string };
          const origem = `${conteudo.Text ?? ""}\n${conteudo.HTML ?? ""}`;
          const encontrada = origem.match(/http:\/\/localhost:8001\/static\/confirm-email\.html#token=[A-Za-z0-9_-]+/);
          if (encontrada?.[0]) return encontrada[0];
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("A confirmação de e-mail não chegou ao Mailpit no tempo esperado.");
}

async function idDoProduto(page: Page, busca: string): Promise<string> {
  const response = await page.request.get(`/api/v1/catalog/products?limit=12&q=${encodeURIComponent(busca)}`);
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as { items: Array<{ id: string }> };
  const item = body.items[0];
  if (!item) throw new Error(`Produto de desenvolvimento não encontrado para ${busca}.`);
  return item.id;
}

async function entrarPeloModal(page: Page, email: string, password: string): Promise<void> {
  await page.locator(".auth-switch button").click();
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { exact: true, name: "Entrar" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

test.describe.serial("marketplace no Compose", () => {
  test("visitante navega do catálogo ao produto real", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Categorias" })).toBeVisible();
    await page.getByLabel("Buscar produtos").fill("Fone");
    await expect(page.getByRole("option", { name: "Fone Bluetooth Aurora" })).toBeVisible();
    await page.getByRole("option", { name: "Fone Bluetooth Aurora" }).click();
    await expect(page.getByRole("heading", { name: "Fone Bluetooth Aurora" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Adicionar ao carrinho" })).toBeVisible();
  });

  test("visitante recebe o bloqueio de autenticação ao adicionar produto", async ({ page }) => {
    await page.goto(`/produto/${await idDoProduto(page, "Fone")}`);
    await page.getByRole("button", { name: "Adicionar ao carrinho" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Entre para adicionar produtos ao carrinho.")).toBeVisible();
  });

  test("retoma a adição ao carrinho após login real", async ({ page }) => {
    await page.goto(`/produto/${await idDoProduto(page, "Fone")}`);
    await page.getByRole("button", { name: "Adicionar ao carrinho" }).click();
    await entrarPeloModal(page, "cliente.dev@elitehub.local", "ClienteEliteHub#2026");
    await expect(page).toHaveURL(/\/carrinho$/);
    await expect(page.getByRole("heading", { name: "Meu carrinho" })).toBeVisible();
    await expect(page.getByText("Fone Bluetooth Aurora")).toBeVisible();
    await page.getByLabel("Aumentar quantidade").click();
    await expect(page.locator(".quantity-control-react output")).toHaveText("2");
    await page.getByLabel("Diminuir quantidade").click();
    await expect(page.locator(".quantity-control-react output")).toHaveText("1");
  });

  test("confirma o e-mail por SMTP sandbox e libera a conta real", async ({ page }) => {
    const email = `confirmacao.e2e.${Date.now()}@elitehub.local`;
    const senha = "ConfirmacaoEliteHub#2026";
    await page.goto("/");
    await page.getByRole("button", { name: "Conta" }).click();
    await page.getByRole("menuitem", { name: "Criar conta" }).click();
    await page.getByLabel("Nome completo").fill("Cliente de Confirmação E2E");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(senha);
    await page.getByRole("button", { name: "Criar conta", exact: true }).click();
    await expect(page.getByText("Solicitação processada. Você poderá entrar caso a conta tenha sido criada.")).toBeVisible();

    await page.goto(await urlDeConfirmacao(email));
    await expect(page.locator("#status")).toHaveText("E-mail confirmado. Você já pode voltar à EliteHub Connect.");

    await page.goto("/");
    await page.getByRole("button", { name: "Conta" }).click();
    await page.getByRole("menuitem", { name: "Entrar" }).click();
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(senha);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.goto("/conta");
    await expect(page.getByText("E-mail confirmado")).toBeVisible();
  });

  test("checkout cria pedido real pendente sem cobrança simulada", async ({ page }) => {
    await page.goto(`/produto/${await idDoProduto(page, "Carregador")}`);
    await page.getByRole("button", { name: "Comprar agora" }).click();
    await entrarPeloModal(page, "cliente.dev@elitehub.local", "ClienteEliteHub#2026");
    await expect(page).toHaveURL(/\/checkout$/);
    await page.getByRole("button", { name: "Criar pedido" }).click();
    await expect(page).toHaveURL(/\/pedidos$/);
    await expect(page.getByText(/PENDING_PAYMENT/)).toBeVisible();
  });

  test("rotas privadas solicitam autenticação para visitante", async ({ page }) => {
    for (const route of ["/carrinho", "/checkout", "/conta", "/vendedor", "/admin"]) {
      await test.step(`gate de ${route}`, async () => {
        await page.goto(route);
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.getByRole("button", { name: "Fechar autenticação" }).click();
      });
    }
  });

  test("vendedor não recebe privilégios administrativos", async ({ page }) => {
    await page.goto(`/produto/${await idDoProduto(page, "Fone")}`);
    await page.getByRole("button", { name: "Adicionar ao carrinho" }).click();
    await entrarPeloModal(page, "vendedor.pendente.dev@elitehub.local", "PendenteEliteHub#2026");
    await expect(page).toHaveURL(/\/carrinho$/);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Acesso restrito" })).toBeVisible();
  });

  test("vendedor aprovado visualiza pedidos recebidos", async ({ page }) => {
    await page.goto(`/produto/${await idDoProduto(page, "Fone")}`);
    await page.getByRole("button", { name: "Adicionar ao carrinho" }).click();
    await entrarPeloModal(page, "vendedor.dev@elitehub.local", "VendedorEliteHub#2026");
    await expect(page).toHaveURL(/\/carrinho$/);
    await page.goto("/pedidos");
    await page.getByRole("tab", { name: "Vendas recebidas" }).click();
    await expect(page.getByText("Pedido EH-DEV-HISTORICO-0001")).toBeVisible();
  });

  test("administrador modera vendedor e avaliação persistentes", async ({ page }) => {
    await page.goto(`/produto/${await idDoProduto(page, "Fone")}`);
    await page.getByRole("button", { name: "Adicionar ao carrinho" }).click();
    await entrarPeloModal(page, "admin.dev@elitehub.local", "AdminEliteHub#2026");
    await expect(page).toHaveURL(/\/carrinho$/);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Administração" })).toBeVisible();
    await expect(page.getByText("Oficina Pendente")).toBeVisible();
    await page.getByRole("button", { name: "Aprovar" }).click();
    await expect(page.getByText("Nenhum vendedor pendente.")).toBeVisible();
    await page.getByRole("button", { name: "Publicar" }).click();
    await expect(page.getByText("Nenhuma avaliação pendente.")).toBeVisible();
  });
});
