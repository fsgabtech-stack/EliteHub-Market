# EliteHub Connect

Marketplace interno em português do Brasil, implementado como monólito modular:

```text
static frontend -> Express API -> PostgreSQL -> transactional outbox -> worker
```

## Pré-requisitos

- Node.js 22.13 ou superior
- PostgreSQL 16 ou superior

## Inicialização local

```powershell
npm install
Copy-Item .env.example .env
# edite DATABASE_URL e SESSION_SECRET em .env
npm run db:migrate
npm run dev
```

A aplicação fica em [http://localhost:8000/static/elitehub.html](http://localhost:8000/static/elitehub.html).

Sem PostgreSQL, o servidor ainda entrega a interface para diagnóstico, mas APIs que exigem persistência retornam indisponibilidade. Isso é intencional: autenticação, pedidos, estoque e pagamentos não usam armazenamento de navegador como substituto.

## VS Code e Codex

O workspace recomenda a extensão **ChatGPT – Work with Codex** (`openai.chatgpt`), já detectada neste computador. No VS Code, abra esta pasta, use `Ctrl+Shift+P` e execute **Codex: Open Sidebar**. A extensão trata a pasta aberta como o projeto local; não é necessário configurar um executável manualmente.

## Google OAuth local

O backend inicia OAuth 2.0 Authorization Code com PKCE, estado de uso único no PostgreSQL e validação do ID token no servidor. Quando houver credenciais reais, configure no Google Cloud Console:

- Origem JavaScript autorizada: `http://localhost:8000`
- URI de redirecionamento autorizada: `http://localhost:8000/api/v1/auth/google/callback`

Não preencha valores fictícios. Enquanto variáveis ou configuração externa estiverem ausentes, o fluxo deve falhar de forma segura e legível.

Variáveis necessárias:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:8000/api/v1/auth/google/callback
```

## Recuperação de senha

A recuperação somente é ativada quando há uma entrega SMTP real. O token é armazenado apenas em hash, expira em 30 minutos, tem uso único e é transmitido ao worker em envelope criptografado.

```env
SMTP_URL=
SMTP_FROM=
```

Depois de configurar SMTP, execute o worker em outro terminal:

```powershell
npm run worker
```
