# EliteHub Connect

Marketplace brasileiro implementado como monólito modular TypeScript. A aplicação preserva a stack existente — Express e PostgreSQL — e organiza os domínios por casos de uso, portas de infraestrutura e adaptadores HTTP. Não há um segundo backend Java: adicionar Spring Boot a este repositório criaria duplicação operacional e não resolveria nenhum requisito de negócio.

```text
Frontend estático
       │
Express /api/v1 ── PostgreSQL ── Outbox transacional ── Worker
       │                │                 │
 Redis opcional      Auditoria       E-mail, pagamento e busca opcional
       │
 S3 ou MinIO para arquivos
```

## Estado de implementação

Implementado no código:

- autenticação com Argon2id, cookies HttpOnly, CSRF, OAuth Google com PKCE, token JWT curto em cookie HttpOnly, rotação da sessão opaca e revogação;
- RBAC para `CUSTOMER`, `SELLER`, `PROFESSIONAL`, `ADMIN` e `SUPPORT`;
- catálogo pesquisável e paginado, categorias, produtos, variantes, estoque e imagens S3/MinIO;
- onboarding e aprovação de vendedor, gestão de produtos e ajustes auditáveis de estoque;
- carrinho persistente, endereços, cupom, checkout idempotente e reserva de estoque transacional;
- pedidos com histórico de estados, consulta por comprador ou vendedor e transições autorizadas;
- outbox persistente, worker contínuo, `FOR UPDATE SKIP LOCKED`, retentativa exponencial e fila morta no PostgreSQL;
- adaptadores de Pix sandbox para Mercado Pago e Stripe, confirmação direta no provedor, webhook assinado e idempotente, ledger de partidas dobradas e estrutura de split;
- métricas Prometheus, logs estruturados com ID de correlação, liveness, readiness, OpenAPI e Swagger;
- Redis opcional para cache do catálogo e rate limiting distribuído; fallback local quando Redis não estiver configurado;
- confirmação de e-mail com token de uso único, consentimentos LGPD, exportação de dados e anonimização condicionada à inexistência de pedidos ativos;
- Docker, Compose, Nginx, GitHub Actions e configuração compatível com SonarQube.
- experiência pública de marketplace: catálogo, busca com sugestões, filtros, ordenação, paginação, detalhes de produto, imagens, lojas aprovadas e páginas institucionais sem parede de autenticação;
- favoritos e notificações persistentes por usuário, acessíveis apenas após autenticação.

Não são afirmados como ativos sem configuração externa e teste real:

- Google OAuth, SMTP, Mercado Pago, Stripe, MinIO/S3, Redis e OpenSearch;
- cálculo de frete por transportadora, pois não existe política comercial nem credencial de cotação aprovada;
- pagamento com cartão ou boleto: o backend não recebe PAN/CVV e exige um fluxo PCI do provedor antes de ativação;
- qualquer ambiente de staging ou produção.

## Navegação pública e ações protegidas

A página inicial é pública. Um visitante pode abrir o catálogo, usar busca com sugestões, filtrar e ordenar resultados, navegar por categorias, consultar detalhes, imagens e variações de produtos, compartilhar um produto e acessar o perfil público de lojas aprovadas.

São públicos por `GET`:

- `/api/v1/catalog/categories`, `/api/v1/catalog/products`, `/api/v1/catalog/search-suggestions` e `/api/v1/catalog/products/:id`;
- `/api/v1/sellers/:id` para perfis de lojas aprovadas;
- `/api/v1/files/:id` somente quando o arquivo é imagem de produto; documentos de vendedor e avatares continuam privados;
- `/static/elitehub.html`, `/static/help.html` e páginas legais.

Continuam protegidos por sessão, RBAC e, nas escritas, CSRF:

- carrinho, checkout, pedidos, endereços, favoritos, notificações, conta, vendedor, administração, arquivos privados e pagamentos;
- nenhuma rota pública entrega e-mail, telefone, endereço, documento, dados de pagamento, metadados administrativos ou auditoria de vendedores e usuários.

Ao clicar em adicionar ao carrinho, comprar agora, carrinho, favoritos ou notificações sem sessão, a interface abre o modal de autenticação com o motivo da solicitação. A intenção — produto, variação, quantidade e rota de retorno — é guardada apenas na sessão do navegador. Após login por e-mail/senha ou retorno OAuth, a ação é retomada contra a API real. O carrinho de visitante permanece desativado; a coluna de token de convidado no banco é apenas preparação para decisão futura.

## Pré-requisitos

- Node.js 22.13 ou superior;
- PostgreSQL 16 ou superior;
- Docker Desktop somente para o ambiente composto opcional.

## Execução local com PostgreSQL instalado

```powershell
npm install
Copy-Item .env.example .env
```

Edite o `.env` local sem versioná-lo. São obrigatórios ao menos `DATABASE_URL` válido, `SESSION_SECRET`, `SHIPPING_FIXED_CENTS` e `MARKETPLACE_COMMISSION_BPS` antes do checkout. Não envie essas credenciais por chat nem as coloque em código.

```powershell
npm run db:migrate
npm run db:status
npm run dev
```

A interface pública é servida pelo backend em [http://localhost:8000/static/elitehub.html](http://localhost:8000/static/elitehub.html). Não use `file://` nem Live Server. A página de ajuda pública está em `/static/help.html`.

Em outro terminal, execute o worker:

```powershell
npm run worker
```

## Ambiente composto

O Compose inicia PostgreSQL, Redis e MinIO junto da API e do worker. Por padrão, publica a API em `8001` e PostgreSQL em `5433`, sem colidir com serviços locais em `8000` e `5432`. Antes de usá-lo, defina no `.env` local valores não vazios para `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `SESSION_SECRET`, `SHIPPING_FIXED_CENTS` e `MARKETPLACE_COMMISSION_BPS`.

```powershell
docker compose up --build
```

O serviço `migrate` é executado antes da API e do worker; acompanhe-o com `docker compose logs migrate`. Não aplique manualmente uma migração em paralelo ao Compose.

O Docker não deve ser usado como prova de produção. Staging e produção exigem TLS, banco gerenciado com PITR, gestão de segredos, testes de restore, observabilidade e políticas financeiras aprovadas.

## Contratos HTTP

- Execução direta: Swagger em [http://localhost:8000/api-docs](http://localhost:8000/api-docs) e OpenAPI em [http://localhost:8000/openapi.json](http://localhost:8000/openapi.json)
- Docker Compose: Swagger em [http://localhost:8001/api-docs](http://localhost:8001/api-docs) e OpenAPI em [http://localhost:8001/openapi.json](http://localhost:8001/openapi.json)
- Liveness: `GET /api/v1/live`
- Readiness: `GET /api/v1/ready`
- Métricas: `GET /metrics`

Rotas centrais:

| Domínio | Rotas principais |
| --- | --- |
| Autenticação | `/api/v1/auth/register`, `/login`, `/refresh`, `/logout`, `/password-recovery`, `/password-reset`, `/email-verification` |
| Catálogo | `/api/v1/catalog/categories`, `/api/v1/catalog/products`, `/api/v1/catalog/products/:id` |
| Descoberta pública | `/api/v1/catalog/search-suggestions`, `/api/v1/sellers/:id`, `/api/v1/files/:id` para imagens de produto |
| Carrinho | `/api/v1/cart`, `/api/v1/cart/items` |
| Endereços e checkout | `/api/v1/addresses`, `/api/v1/checkout` |
| Conta e LGPD | `/api/v1/account/consents`, `/data-export`, `/deletion` |
| Favoritos e notificações | `/api/v1/favorites`, `/api/v1/favorites/:productId`, `/api/v1/notifications` |
| Pedidos | `/api/v1/orders`, `/api/v1/orders/:id`, `/api/v1/orders/:id/status` |
| Vendedores | `/api/v1/seller/onboarding`, `/api/v1/seller/products`, `/api/v1/seller/products/:id/stock-adjustments` |
| Administração | `/api/v1/admin/categories`, `/api/v1/admin/sellers/:id/approval`, `/api/v1/admin/coupons` |
| Arquivos | `/api/v1/seller/products/:id/images`, `/api/v1/files/:id` |
| Webhooks | `/api/v1/payments/webhooks/mercado-pago`, `/api/v1/payments/webhooks/stripe` |

Operações de escrita autenticadas por cookie exigem `X-CSRF-Token`, obtido em `GET /api/v1/security/csrf`. Checkout exige também `Idempotency-Key` no formato UUID. O preço, cupom, vendedor e estoque são recalculados e bloqueados no servidor; o frontend não é fonte de verdade.

Em produção, `GET /metrics` exige `Authorization: Bearer <METRICS_BEARER_TOKEN>`. Configure `TRUST_PROXY_HOPS` para a quantidade real de proxies confiáveis; usar valor maior que a topologia real permite falsificar IP e enfraquece o rate limiting.

## Pagamentos e webhooks

`PAYMENT_PROVIDER` aceita `mercado_pago`, `stripe` ou `disabled`. A ativação só é permitida com sandbox e política comercial explícita. O checkout não é liberado sem configuração de frete e comissão, evitando cobranças sem total financeiro aprovado.

O webhook:

1. recebe o corpo bruto antes do parser JSON;
2. valida assinatura e janela temporal;
3. grava recibo idempotente e auditável;
4. consulta o estado diretamente no provedor;
5. atualiza pagamento, pedido, reserva e ledger em transação;
6. publica eventos de pagamento e notificação.

Não existe endpoint que marque pagamento aprovado a partir do navegador.

## Qualidade

```powershell
npm run lint
npm run typecheck
npm test
npm run openapi:validate
npm run build
npm audit --omit=dev --audit-level=high
```

Testes de integração com PostgreSQL, Redis e MinIO dependem de Docker ou de serviços locais configurados. Não considere a aplicação persistente funcional enquanto `npm run db:migrate` não terminar com sucesso e `GET /api/v1/ready` não retornar `200`.

## Operação e segurança

- Não registre senhas, cookies, tokens, chaves OAuth, chaves de pagamento ou chaves S3.
- Não altere `pg_hba.conf` para `trust` para contornar uma senha inválida.
- Não habilite cobrança real, split ou webhook público sem aprovação comercial, domínio HTTPS e teste sandbox E2E.
- O worker deve rodar separado da API em qualquer ambiente com mais de uma instância.
- O arquivo [infra/nginx/elitehub.conf](infra/nginx/elitehub.conf) é apenas um ponto de partida para proxy reverso; TLS e cabeçalhos de borda pertencem ao ambiente.
