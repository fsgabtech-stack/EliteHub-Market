export const documentoOpenApi = {
  components: {
    securitySchemes: {
      cookieSessao: { in: "cookie", name: "elitehub_session", type: "apiKey" },
      tokenPortador: { bearerFormat: "JWT", scheme: "bearer", type: "http" },
    },
  },
  info: {
    description: "API do marketplace EliteHub Connect. Catálogo, busca, produtos, lojas aprovadas e imagens públicas permitem leitura anônima. Carrinho, compra, favoritos, notificações e áreas privadas exigem sessão autenticada; operações de escrita por cookie exigem o cabeçalho X-CSRF-Token.",
    title: "EliteHub Connect API",
    version: "1.0.0",
  },
  openapi: "3.1.0",
  paths: {
    "/api/v1/live": {
      get: { description: "Verifica se o processo HTTP está ativo.", responses: { "200": { description: "Processo ativo" } } },
    },
    "/api/v1/ready": {
      get: { description: "Verifica se a API pode atender tráfego dependente de persistência.", responses: { "200": { description: "Dependências disponíveis" }, "503": { description: "Persistência indisponível" } } },
    },
    "/api/v1/health": {
      get: { description: "Verifica a disponibilidade da API e do PostgreSQL.", responses: { "200": { description: "Serviço disponível" }, "503": { description: "Persistência indisponível" } } },
    },
    "/api/v1/security/csrf": {
      get: { description: "Emite ou renova o token CSRF para requisições autenticadas por cookie.", responses: { "200": { description: "Token emitido" } } },
    },
    "/api/v1/auth/session": {
      get: { description: "Consulta a sessão autenticada atual.", responses: { "200": { description: "Sessão ativa" }, "401": { description: "Sessão ausente ou expirada" } } },
    },
    "/api/v1/auth/providers": {
      get: { description: "Informa se Google e Microsoft podem iniciar autenticação. A interface mantém os dois botões visíveis, mas habilita somente provedores configurados e implementados.", responses: { "200": { description: "Disponibilidade dos provedores" } } },
    },
    "/api/v1/auth/register": {
      post: { description: "Solicita o cadastro de uma conta de cliente sem enumerar e-mails existentes.", responses: { "202": { description: "Solicitação processada" } } },
    },
    "/api/v1/auth/login": {
      post: { description: "Autentica por e-mail e senha e emite sessão opaca e JWT curto em cookies HttpOnly.", responses: { "200": { description: "Autenticação realizada" }, "401": { description: "Credenciais inválidas" } } },
    },
    "/api/v1/auth/logout": {
      post: { description: "Revoga a sessão atual e remove os cookies de autenticação.", responses: { "204": { description: "Sessão encerrada" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/auth/refresh": {
      post: { description: "Rotaciona a sessão opaca e emite novo JWT curto.", responses: { "200": { description: "Sessão renovada" }, "401": { description: "Sessão expirada" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/auth/password-recovery": {
      post: { description: "Solicita recuperação de senha sem enumerar contas.", responses: { "202": { description: "Solicitação processada" }, "503": { description: "E-mail indisponível" } } },
    },
    "/api/v1/auth/password-reset": {
      post: { description: "Redefine a senha mediante token de uso único e revoga sessões existentes.", responses: { "200": { description: "Senha redefinida" } } },
    },
    "/api/v1/auth/email-verification": {
      post: { description: "Confirma e-mail com token de uso único de 24 horas. A página estática de confirmação usa o token no fragmento da URL.", responses: { "200": { description: "E-mail confirmado" }, "400": { description: "Token inválido ou expirado" } } },
    },
    "/api/v1/auth/email-verification/resend": {
      post: { description: "Reemite confirmação para a sessão autenticada que ainda não confirmou o e-mail.", responses: { "202": { description: "Solicitação processada" }, "503": { description: "E-mail indisponível" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/auth/google": {
      get: { description: "Inicia OAuth 2.0 Google com PKCE, estado e nonce persistidos.", responses: { "302": { description: "Redirecionamento ao provedor ou à tela de autenticação" } } },
    },
    "/api/v1/auth/google/callback": {
      get: { description: "Recebe o callback Google, valida identidade e cria sessão segura.", responses: { "302": { description: "Redirecionamento seguro à aplicação" } } },
    },
    "/api/v1/auth/require-session": {
      get: { description: "Exemplo de rota autenticada por sessão ou token portador JWT.", responses: { "200": { description: "Usuário autenticado" }, "401": { description: "Sessão expirada" } } },
    },
    "/api/v1/catalog/categories": {
      get: { description: "Lista categorias públicas que possuem ao menos um produto ativo de vendedor aprovado.", responses: { "200": { description: "Categorias publicadas" } } },
    },
    "/api/v1/catalog/products": {
      get: { description: "Lista apenas produtos ativos de vendedores aprovados, com paginação, busca, filtros de categoria, vendedor, faixa de preço e ordenação. Expõe disponibilidade comercial, nunca a quantidade interna de estoque.", responses: { "200": { description: "Catálogo público paginado" } } },
    },
    "/api/v1/catalog/search-suggestions": {
      get: { description: "Retorna sugestões de produtos ativos de vendedores aprovados para busca assistida.", responses: { "200": { description: "Sugestões de busca" } } },
    },
    "/api/v1/catalog/products/{id}": {
      get: { description: "Obtém produto publicado por vendedor aprovado, variantes, atributos e imagens. A disponibilidade é comercial e não revela o saldo interno de estoque.", responses: { "200": { description: "Produto" }, "404": { description: "Produto inexistente ou indisponível" } } },
    },
    "/api/v1/products/{id}/reviews": {
      get: { description: "Lista avaliações publicadas de compradores verificados para produto ativo de vendedor aprovado.", responses: { "200": { description: "Avaliações públicas paginadas" }, "404": { description: "Produto inexistente ou indisponível" } } },
      post: { description: "Envia avaliação para moderação. Exige sessão, e-mail confirmado e compra entregue do produto pelo próprio usuário.", responses: { "202": { description: "Avaliação recebida para moderação" }, "401": { description: "Sessão ausente ou expirada" }, "409": { description: "Compra entregue inexistente ou avaliação já enviada" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/categories": {
      get: { description: "Rota legada compatível para listagem de categorias.", responses: { "200": { description: "Categorias" } } },
    },
    "/api/v1/products": {
      get: { description: "Rota legada compatível para busca e paginação de produtos.", responses: { "200": { description: "Catálogo paginado" } } },
    },
    "/api/v1/products/{id}": {
      get: { description: "Rota legada compatível para detalhe de produto.", responses: { "200": { description: "Produto" } } },
    },
    "/api/v1/sellers/{id}": {
      get: { description: "Obtém o perfil público seguro de uma loja aprovada, sem e-mail, documento ou dados administrativos.", responses: { "200": { description: "Loja pública" }, "404": { description: "Loja indisponível" } } },
    },
    "/api/v1/addresses": {
      get: { description: "Lista endereços do usuário autenticado.", responses: { "200": { description: "Endereços" } }, security: [{ cookieSessao: [] }] },
      post: { description: "Cria endereço brasileiro validado para checkout.", responses: { "201": { description: "Endereço criado" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/account/consents": {
      post: { description: "Registra ou revoga consentimento LGPD para finalidade opcional.", responses: { "204": { description: "Consentimento registrado" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/account/data-export": {
      get: { description: "Exporta dados pessoais e de consumo da conta autenticada em JSON.", responses: { "200": { description: "Exportação de dados" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/account/deletion": {
      post: { description: "Anonimiza a conta após confirmação explícita quando não houver pedidos ativos. Registros financeiros são preservados por referência anonimizada.", responses: { "204": { description: "Conta anonimizada" }, "409": { description: "Pedido ativo impede a anonimização" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/cart": {
      get: { description: "Obtém o carrinho ativo do cliente autenticado.", responses: { "200": { description: "Carrinho" }, "401": { description: "Sessão ausente ou expirada" } } },
    },
    "/api/v1/cart/items": {
      put: { description: "Inclui ou altera a quantidade de um item no carrinho.", responses: { "200": { description: "Carrinho atualizado" }, "409": { description: "Estoque indisponível" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/cart/items/{id}": {
      delete: { description: "Remove um item do carrinho pertencente ao usuário autenticado.", responses: { "200": { description: "Carrinho atualizado" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/favorites": {
      get: { description: "Lista os produtos favoritos do usuário autenticado.", responses: { "200": { description: "Favoritos" }, "401": { description: "Sessão ausente ou expirada" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/favorites/{productId}": {
      post: { description: "Salva um produto ativo nos favoritos do usuário autenticado.", responses: { "201": { description: "Favorito criado" }, "404": { description: "Produto inexistente" } }, security: [{ cookieSessao: [] }] },
      delete: { description: "Remove um produto dos favoritos do usuário autenticado.", responses: { "204": { description: "Favorito removido" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/notifications": {
      get: { description: "Lista notificações privadas do usuário autenticado.", responses: { "200": { description: "Notificações" }, "401": { description: "Sessão ausente ou expirada" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/notifications/{id}/read": {
      patch: { description: "Marca uma notificação própria como lida.", responses: { "204": { description: "Notificação atualizada" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/checkout": {
      post: { description: "Reserva estoque, cria pedido pendente de pagamento e publica evento transacional. Requer Idempotency-Key UUID.", responses: { "201": { description: "Pedido criado" }, "409": { description: "Conflito de estoque, vendedor ou idempotência" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/orders": {
      get: { description: "Lista pedidos do comprador ou pedidos recebidos do vendedor.", responses: { "200": { description: "Pedidos paginados" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/orders/{id}": {
      get: { description: "Retorna pedido com itens e histórico, respeitando posse e papel.", responses: { "200": { description: "Pedido" }, "403": { description: "Acesso negado" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/orders/{id}/status": {
      post: { description: "Executa transição válida de status conforme posse e papel.", responses: { "200": { description: "Status atualizado" }, "409": { description: "Transição inválida" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/seller/profile": {
      get: { description: "Consulta o perfil e a situação de aprovação do vendedor autenticado.", responses: { "200": { description: "Perfil do vendedor" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/seller/onboarding": {
      post: { description: "Submete ou atualiza o onboarding de vendedor para aprovação administrativa.", responses: { "202": { description: "Onboarding recebido" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/seller/products": {
      post: { description: "Cria produto pertencente a vendedor aprovado.", responses: { "201": { description: "Produto criado" }, "403": { description: "Vendedor não aprovado" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/seller/products/{id}": {
      put: { description: "Edita produto próprio sem alterar estoque fora do fluxo auditável.", responses: { "204": { description: "Produto atualizado" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/seller/products/{id}/variants": {
      post: { description: "Cria variante de produto próprio.", responses: { "201": { description: "Variante criada" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/seller/products/{id}/stock-adjustments": {
      post: { description: "Registra ajuste de estoque auditável e impede saldo negativo.", responses: { "204": { description: "Estoque ajustado" }, "409": { description: "Estoque insuficiente" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/seller/products/{id}/images": {
      post: { description: "Envia imagem JPEG, PNG ou WebP ao armazenamento S3/MinIO configurado.", responses: { "201": { description: "Arquivo criado" }, "503": { description: "Armazenamento indisponível" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/seller/coupons": {
      post: { description: "Cria cupom restrito ao vendedor aprovado.", responses: { "201": { description: "Cupom criado" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/admin/categories": {
      post: { description: "Cria categoria administrativa.", responses: { "201": { description: "Categoria criada" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/admin/sellers/{id}/approval": {
      post: { description: "Aprova ou rejeita vendedor e registra auditoria.", responses: { "204": { description: "Aprovação atualizada" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/admin/coupons": {
      post: { description: "Cria cupom de plataforma ou de vendedor.", responses: { "201": { description: "Cupom criado" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/admin/reviews/{id}": {
      patch: { description: "Publica, oculta ou rejeita uma avaliação e registra auditoria. Permitida apenas a administração e suporte.", responses: { "204": { description: "Avaliação moderada" }, "404": { description: "Avaliação inexistente" } }, security: [{ cookieSessao: [] }] },
    },
    "/api/v1/files/{id}": {
      get: { description: "Redireciona imagem apenas quando vinculada a produto ativo de vendedor aprovado. Imagens privadas, documentos e avatares exigem posse ou papel administrativo e não revelam sua existência a visitantes.", responses: { "302": { description: "URL temporária" }, "404": { description: "Arquivo inexistente, não publicável ou sem acesso" } } },
    },
    "/api/v1/payments/webhooks/{provedor}": {
      post: { description: "Recebe evento de pagamento; exige assinatura válida, idempotência e auditoria.", responses: { "202": { description: "Evento aceito" }, "401": { description: "Assinatura inválida" } } },
    },
  },
} as const;
