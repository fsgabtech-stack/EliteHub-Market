const endpoints = {
  addresses: "/api/v1/addresses",
  cart: "/api/v1/cart",
  cartItems: "/api/v1/cart/items",
  categories: "/api/v1/catalog/categories",
  checkout: "/api/v1/checkout",
  csrf: "/api/v1/security/csrf",
  favorites: "/api/v1/favorites",
  health: "/api/v1/health",
  login: "/api/v1/auth/login",
  logout: "/api/v1/auth/logout",
  notifications: "/api/v1/notifications",
  orders: "/api/v1/orders",
  products: "/api/v1/catalog/products",
  providers: "/api/v1/auth/providers",
  recovery: "/api/v1/auth/password-recovery",
  register: "/api/v1/auth/register",
  reset: "/api/v1/auth/password-reset",
  session: "/api/v1/auth/session",
  suggestions: "/api/v1/catalog/search-suggestions",
};

const state = {
  activeCategory: null,
  favoriteIds: new Set(),
  filters: { maxPriceCents: null, minPriceCents: null, sort: "newest" },
  page: { limit: 12, offset: 0, total: 0 },
  pendingAction: null,
  resetToken: null,
  searchTerm: "",
  selectedVariantId: null,
  user: null,
};

const catalogPage = document.querySelector("#catalog-page");
const detailPage = document.querySelector("#detail-page");
const marketStatus = document.querySelector("#market-status");
const authStatus = document.querySelector("#auth-status");
const productList = document.querySelector("#product-list");
const categoryList = document.querySelector("#category-list");
const pagination = document.querySelector("#pagination");
const catalogSummary = document.querySelector("#catalog-summary");
const authDialog = document.querySelector("#auth-dialog");
const accountMenu = document.querySelector("#account-menu");
const accountButton = document.querySelector("#account-button");
const accountLabel = document.querySelector("#account-label");
const accountAvatar = document.querySelector("#account-avatar");
const searchInput = document.querySelector("#product-search");
const searchSuggestions = document.querySelector("#search-suggestions");
const googleSection = document.querySelector("#google-section");
let suggestionPosition = -1;

function svg(icon) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  element.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#icone-${icon}`);
  element.append(use);
  return element;
}

function node(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.type) element.type = options.type;
  if (options.href) element.href = options.href;
  if (options.disabled) element.disabled = true;
  if (options.attrs) Object.entries(options.attrs).forEach(([name, value]) => {
    if (value !== undefined && value !== null) element.setAttribute(name, String(value));
  });
  if (options.onClick) element.addEventListener("click", options.onClick);
  children.filter(Boolean).forEach((child) => element.append(child));
  return element;
}

function button(label, onClick, className = "button button--secondary") {
  return node("button", { className, text: label, type: "button", onClick });
}

function publicMessage(error) {
  if (error?.code === "BACKEND_UNAVAILABLE") return "Não foi possível conectar ao serviço. Tente novamente em instantes.";
  if (error?.code === "SESSION_EXPIRED" || error?.code === "UNAUTHORIZED") return "Entre novamente para continuar.";
  if (error?.code === "RATE_LIMITED") return "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.";
  if (error?.code === "EMAIL_VERIFICATION_REQUIRED") return "Confirme seu e-mail antes de continuar a compra.";
  if (error && typeof error.message === "string") return error.message;
  return "Não foi possível concluir esta ação. Tente novamente.";
}

function setStatus(target, message, kind = "error") {
  target.hidden = !message;
  target.dataset.kind = kind;
  target.textContent = message || "";
}

function csrfToken() {
  const cookie = document.cookie.split("; ").find((item) => item.startsWith("elitehub_csrf="));
  return cookie ? decodeURIComponent(cookie.slice("elitehub_csrf=".length)) : null;
}

async function request(url, options = {}) {
  const method = options.method || "GET";
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = csrfToken();
    if (token) headers.set("x-csrf-token", token);
  }
  let response;
  try {
    response = await fetch(url, { ...options, credentials: "same-origin", headers });
  } catch {
    throw { code: "BACKEND_UNAVAILABLE" };
  }
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw payload?.error || { code: "BACKEND_UNAVAILABLE" };
  return payload;
}

function formatCurrency(cents) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
}

function firstName(fullName) {
  return fullName?.trim().split(/\s+/)[0] || "Conta";
}

function currentRoute() {
  return window.location.hash || "#inicio";
}

function navigate(route, replace = false) {
  const safeRoute = typeof route === "string" && route.startsWith("#") ? route : "#inicio";
  if (replace) history.replaceState({}, "", safeRoute);
  else if (window.location.hash !== safeRoute) window.location.hash = safeRoute;
  else void renderRoute();
}

function savePendingAction(action) {
  state.pendingAction = action;
  try { sessionStorage.setItem("elitehub-pending-action", JSON.stringify(action)); } catch { }
}

function restorePendingAction() {
  try {
    const raw = sessionStorage.getItem("elitehub-pending-action");
    if (raw) state.pendingAction = JSON.parse(raw);
  } catch { state.pendingAction = null; }
}

function clearPendingAction() {
  state.pendingAction = null;
  try { sessionStorage.removeItem("elitehub-pending-action"); } catch { }
}

function showAuth(message, action = null, mode = "login") {
  if (action) savePendingAction(action);
  switchAuthMode(mode, true);
  setStatus(authStatus, message, "error");
  if (!authDialog.open) authDialog.showModal();
  document.querySelector("#login-email")?.focus({ preventScroll: true });
}

function requireProtectedRoute(route, message) {
  if (state.user) {
    navigate(route);
    return;
  }
  showAuth(message, { kind: "route", route });
}

async function resumePendingAction() {
  const action = state.pendingAction;
  if (!action || !state.user) return;
  try {
    if (action.kind === "route") {
      clearPendingAction();
      navigate(action.route);
      return;
    }
    if (action.kind === "cart") {
      await addCartItem(action.productId, action.quantity, action.variantId);
      clearPendingAction();
      setStatus(marketStatus, "Produto adicionado ao carrinho.", "success");
      navigate(action.nextRoute || "#carrinho");
      return;
    }
    if (action.kind === "favorite") {
      await request(`${endpoints.favorites}/${action.productId}`, { method: "POST" });
      state.favoriteIds.add(action.productId);
      clearPendingAction();
      setStatus(marketStatus, "Produto salvo nos favoritos.", "success");
      void renderRoute();
    }
  } catch (error) {
    setStatus(marketStatus, publicMessage(error));
  }
}

const modes = {
  login: { subtitle: "Use seu e-mail e senha para continuar.", title: "Entre na sua conta", form: "#login-form", prompt: "Ainda não tenho uma conta", switchLabel: "Criar conta", switchMode: "register", google: true },
  register: { subtitle: "Crie seu acesso para salvar produtos e comprar com segurança.", title: "Crie sua conta", form: "#register-form", prompt: "Já tenho uma conta", switchLabel: "Entrar", switchMode: "login", google: true },
  recovery: { subtitle: "Informe seu e-mail para solicitar a recuperação.", title: "Recuperar senha", form: "#recovery-form", prompt: "Lembrou sua senha?", switchLabel: "Voltar para entrar", switchMode: "login", google: false },
  reset: { subtitle: "Escolha uma nova senha forte para sua conta.", title: "Defina uma nova senha", form: "#reset-form", prompt: "Já definiu sua senha?", switchLabel: "Voltar para entrar", switchMode: "login", google: false },
};

function switchAuthMode(mode, preserveStatus = false) {
  const current = modes[mode] || modes.login;
  document.querySelectorAll(".form-stack").forEach((form) => { form.hidden = `#${form.id}` !== current.form; });
  document.querySelector("#auth-title").textContent = current.title;
  document.querySelector("#auth-subtitle").textContent = current.subtitle;
  document.querySelector("#auth-switch-prompt").textContent = current.prompt;
  const switchButton = document.querySelector("#auth-switch");
  switchButton.textContent = current.switchLabel;
  switchButton.dataset.authMode = current.switchMode;
  googleSection.hidden = !current.google || googleSection.dataset.available !== "true";
  if (!preserveStatus) setStatus(authStatus, "");
}

function clearErrors(form) {
  form.querySelectorAll(".field-error").forEach((element) => { element.textContent = ""; });
}

function showInputError(id, message) {
  const target = document.querySelector(`#${id}`);
  if (target) target.textContent = message;
}

function setSubmitState(buttonElement, loading, label) {
  if (!buttonElement.dataset.defaultLabel) buttonElement.dataset.defaultLabel = buttonElement.textContent.trim();
  buttonElement.disabled = loading;
  buttonElement.textContent = loading ? label : buttonElement.dataset.defaultLabel;
}

function passwordIsStrong(password) {
  return password.length >= 12 && password.length <= 256 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
}

function renderAccountMenu() {
  accountMenu.replaceChildren();
  if (!state.user) {
    accountLabel.textContent = "Conta";
    accountAvatar.replaceChildren(svg("usuario"));
    const enter = node("button", { text: "Entrar", type: "button", onClick: () => { closeAccountMenu(); showAuth("Entre para acessar sua conta."); } });
    const register = node("button", { text: "Criar conta", type: "button", onClick: () => { closeAccountMenu(); showAuth("Crie sua conta para comprar com segurança.", null, "register"); } });
    accountMenu.append(enter, register);
    return;
  }
  accountLabel.textContent = firstName(state.user.fullName);
  accountAvatar.textContent = firstName(state.user.fullName).slice(0, 2).toUpperCase();
  const head = node("div", { className: "account-menu__head" });
  head.append(node("strong", { text: state.user.fullName }), node("span", { text: state.user.email }));
  const entries = [
    ["Minha conta", "#conta"], ["Meus pedidos", "#pedidos"], ["Favoritos", "#favoritos"],
  ];
  accountMenu.append(head, ...entries.map(([label, route]) => node("button", { text: label, type: "button", onClick: () => { closeAccountMenu(); navigate(route); } })));
  accountMenu.append(node("button", { className: "menu-danger", text: "Sair", type: "button", onClick: logout }));
}

function closeAccountMenu() {
  accountMenu.hidden = true;
  accountButton.setAttribute("aria-expanded", "false");
}

function syncThemeButtonLabels() {
  const dark = document.documentElement.dataset.theme === "dark";
  document.querySelector("[data-theme-label]").textContent = dark ? "Ativar tema claro" : "Ativar tema escuro";
}

async function loadProviders() {
  try {
    const providers = await request(endpoints.providers);
    googleSection.dataset.available = String(providers.google);
  } catch { googleSection.dataset.available = "false"; }
}

async function loadFavoriteIds() {
  if (!state.user) return;
  try {
    const result = await request(endpoints.favorites);
    state.favoriteIds = new Set(result.items.map((item) => item.id));
  } catch { state.favoriteIds = new Set(); }
}

async function initializeSession(resume = false) {
  try {
    const result = await request(endpoints.session);
    state.user = result.user;
    renderAccountMenu();
    await loadFavoriteIds();
    if (resume) await resumePendingAction();
  } catch (error) {
    state.user = null;
    renderAccountMenu();
    if (error?.code !== "SESSION_EXPIRED") setStatus(marketStatus, publicMessage(error));
  }
}

function renderSkeletons() {
  const template = document.querySelector("#product-skeleton-template");
  productList.replaceChildren(...Array.from({ length: 8 }, () => template.content.cloneNode(true)));
  productList.setAttribute("aria-busy", "true");
}

function imageFor(url, alt, className = "") {
  const image = new Image();
  image.className = className;
  image.alt = alt;
  image.loading = "lazy";
  image.src = url || "";
  image.addEventListener("error", () => image.remove(), { once: true });
  return image;
}

function renderProductCard(product) {
  const card = node("article", { className: "product-card" });
  const favorite = node("button", { className: "icon-button card-favorite", type: "button", attrs: { "aria-label": "Salvar nos favoritos", "aria-pressed": String(state.favoriteIds.has(product.id)), title: "Salvar nos favoritos" }, onClick: (event) => { event.stopPropagation(); void toggleFavorite(product.id); } }, [svg("coracao")]);
  const open = node("button", { className: "product-card__link", type: "button", attrs: { "aria-label": `Ver detalhes de ${product.title}` }, onClick: () => navigate(`#produto/${product.id}`) });
  const picture = node("div", { className: "product-card__image", text: product.imageUrl ? "" : "Imagem indisponível" });
  if (product.imageUrl) picture.append(imageFor(product.imageUrl, product.title));
  const content = node("div", { className: "product-card__content" });
  content.append(node("h3", { className: "product-card__title", text: product.title }), node("p", { className: "product-card__price", text: formatCurrency(product.priceCents) }), node("p", { className: "product-card__meta", text: product.category?.name || "Sem categoria" }));
  open.append(picture, content);
  const seller = node("a", { className: "product-card__seller", href: `#loja/${product.seller.id}`, text: product.seller.name });
  const stock = node("p", { className: `stock ${product.stockQuantity > 0 ? "stock--available" : "stock--unavailable"}`, text: product.stockQuantity > 0 ? "Em estoque" : "Indisponível" });
  card.append(favorite, open, seller, stock);
  return card;
}

function renderProducts(items) {
  productList.setAttribute("aria-busy", "false");
  if (!items.length) {
    productList.replaceChildren(node("div", { className: "empty-state" }, [node("h2", { text: "Nenhum produto encontrado" }), node("p", { text: "Tente remover filtros ou pesquisar outro termo." })]));
    return;
  }
  productList.replaceChildren(...items.map(renderProductCard));
}

function renderPagination(page) {
  pagination.replaceChildren();
  pagination.hidden = page.total <= page.limit;
  if (pagination.hidden) return;
  const previous = button("Anterior", () => { state.page.offset = Math.max(0, state.page.offset - state.page.limit); void loadProducts(); });
  previous.disabled = state.page.offset === 0;
  const next = button("Próxima", () => { state.page.offset += state.page.limit; void loadProducts(); });
  next.disabled = !page.hasNext;
  pagination.append(previous, node("span", { text: `Página ${Math.floor(state.page.offset / state.page.limit) + 1}` }), next);
}

async function loadProducts() {
  renderSkeletons();
  const params = new URLSearchParams({ limit: String(state.page.limit), offset: String(state.page.offset), sort: state.filters.sort });
  if (state.searchTerm) params.set("q", state.searchTerm);
  if (state.activeCategory) params.set("category", state.activeCategory);
  if (state.filters.minPriceCents !== null) params.set("minPriceCents", String(state.filters.minPriceCents));
  if (state.filters.maxPriceCents !== null) params.set("maxPriceCents", String(state.filters.maxPriceCents));
  try {
    const result = await request(`${endpoints.products}?${params}`);
    state.page.total = result.page.total;
    catalogSummary.textContent = result.page.total === 1 ? "1 produto encontrado" : `${result.page.total} produtos encontrados`;
    renderProducts(result.items);
    renderPagination(result.page);
  } catch (error) {
    productList.setAttribute("aria-busy", "false");
    productList.replaceChildren(node("div", { className: "empty-state" }, [node("h2", { text: "Não foi possível carregar o catálogo" }), node("p", { text: publicMessage(error) })]));
    setStatus(marketStatus, publicMessage(error));
  }
}

async function loadCategories() {
  try {
    const result = await request(endpoints.categories);
    categoryList.replaceChildren();
    const all = button("Todas", () => { state.activeCategory = null; state.page.offset = 0; void loadCategories(); void loadProducts(); }, "category-chip");
    all.setAttribute("aria-pressed", String(!state.activeCategory));
    categoryList.append(all);
    result.items.forEach((category) => {
      const item = button(category.name, () => { state.activeCategory = category.id; state.page.offset = 0; navigate("#ofertas"); void loadCategories(); void loadProducts(); }, "category-chip");
      item.setAttribute("aria-pressed", String(state.activeCategory === category.id));
      categoryList.append(item);
    });
  } catch { categoryList.replaceChildren(); }
}

async function loadSuggestions() {
  const term = searchInput.value.trim();
  if (term.length < 2) return hideSuggestions();
  try {
    const result = await request(`${endpoints.suggestions}?q=${encodeURIComponent(term)}`);
    searchSuggestions.replaceChildren(...result.items.map((item) => {
      const itemButton = button(item.label, () => { hideSuggestions(); navigate(`#produto/${item.id}`); }, "");
      itemButton.setAttribute("role", "option");
      return node("li", {}, [itemButton]);
    }));
    suggestionPosition = -1;
    searchSuggestions.hidden = result.items.length === 0;
    searchInput.setAttribute("aria-expanded", String(result.items.length > 0));
  } catch { hideSuggestions(); }
}

function hideSuggestions() {
  suggestionPosition = -1;
  searchSuggestions.hidden = true;
  searchInput.setAttribute("aria-expanded", "false");
}

function showCatalog() {
  catalogPage.hidden = false;
  detailPage.hidden = true;
  detailPage.replaceChildren();
  document.title = "EliteHub Connect | Marketplace";
}

function showDetail() {
  catalogPage.hidden = true;
  detailPage.hidden = false;
  detailPage.replaceChildren();
}

function selectedProductValues(product) {
  const variant = product.variants.find((item) => item.id === state.selectedVariantId) || null;
  return {
    priceCents: variant?.priceCents ?? product.priceCents,
    stockQuantity: variant?.stockQuantity ?? product.stockQuantity,
    variantId: variant?.id,
  };
}

async function renderProduct(productId) {
  showDetail();
  detailPage.textContent = "Carregando produto…";
  try {
    const { product } = await request(`${endpoints.products}/${productId}`);
    state.selectedVariantId = null;
    document.title = `${product.title} | EliteHub Connect`;
    const page = node("div");
    page.append(button("Voltar ao catálogo", () => navigate("#ofertas"), "back-link"));
    const layout = node("div", { className: "detail-layout" });
    const gallery = node("div", { className: "product-gallery" });
    const mainImage = node("div", { className: "product-gallery__main" });
    const images = [...new Set([product.imageUrl, ...product.images.map((image) => image.url)].filter(Boolean))];
    const updateImage = (url) => { mainImage.replaceChildren(url ? imageFor(url, product.title) : node("span", { className: "product-gallery__fallback", text: "Imagem indisponível" })); };
    updateImage(images[0]);
    gallery.append(mainImage);
    if (images.length > 1) {
      const thumbs = node("div", { className: "gallery-thumbs" });
      images.forEach((url, index) => {
        const thumb = node("button", { type: "button", attrs: { "aria-label": `Ver imagem ${index + 1}`, "aria-pressed": String(index === 0) }, onClick: () => { updateImage(url); [...thumbs.children].forEach((item, position) => item.setAttribute("aria-pressed", String(position === index))); } }, [imageFor(url, `${product.title} - imagem ${index + 1}`)]);
        thumbs.append(thumb);
      });
      gallery.append(thumbs);
    }
    const info = node("div", { className: "product-info" });
    const category = node("p", { className: "eyebrow", text: product.category?.name || "Produto" });
    const title = node("h1", { text: product.title });
    const price = node("p", { className: "product-info__price" });
    const stock = node("p", { className: "stock" });
    const refreshProductValues = () => {
      const values = selectedProductValues(product);
      price.textContent = formatCurrency(values.priceCents);
      stock.className = `stock ${values.stockQuantity > 0 ? "stock--available" : "stock--unavailable"}`;
      stock.textContent = values.stockQuantity > 0 ? "Em estoque" : "Indisponível";
      add.disabled = values.stockQuantity <= 0;
      buy.disabled = values.stockQuantity <= 0;
    };
    const seller = node("a", { className: "product-info__seller", href: `#loja/${product.seller.id}`, text: `Vendido por ${product.seller.name}` });
    const description = node("p", { className: "product-info__description", text: product.description });
    info.append(category, title, price, stock, seller, description);
    if (product.variants.length) {
      const variantWrap = node("div");
      variantWrap.append(node("p", { className: "eyebrow", text: "Variações" }));
      const choices = node("div", { className: "variant-list" });
      product.variants.forEach((variant) => {
        const label = Object.values(variant.attributes).map(String).join(" · ") || "Variação";
        const choice = node("button", { type: "button", text: label, attrs: { "aria-pressed": "false" }, onClick: () => { state.selectedVariantId = variant.id; [...choices.children].forEach((item) => item.setAttribute("aria-pressed", String(item === choice))); refreshProductValues(); } });
        choices.append(choice);
      });
      variantWrap.append(choices);
      info.append(variantWrap);
    }
    const add = button("Adicionar ao carrinho", () => { const values = selectedProductValues(product); void requestCartIntent(product.id, values.variantId, "#carrinho"); }, "button button--secondary");
    const buy = button("Comprar agora", () => { const values = selectedProductValues(product); void requestCartIntent(product.id, values.variantId, "#checkout"); }, "button button--primary");
    const actions = node("div", { className: "product-actions" }, [add, buy]);
    const favorite = button(state.favoriteIds.has(product.id) ? "Remover dos favoritos" : "Salvar nos favoritos", () => void toggleFavorite(product.id), "button button--secondary");
    const share = button("Compartilhar", () => void shareProduct(product), "button button--secondary");
    info.append(actions, node("div", { className: "product-utility" }, [favorite, share]));
    if (Object.keys(product.attributes).length) {
      const details = node("section", { className: "info-panel" });
      details.append(node("h2", { text: "Detalhes do produto" }));
      const list = node("dl");
      Object.entries(product.attributes).forEach(([key, value]) => list.append(node("dt", { text: key }), node("dd", { text: typeof value === "string" ? value : JSON.stringify(value) })));
      details.append(list);
      info.append(details);
    }
    refreshProductValues();
    layout.append(gallery, info);
    page.append(layout);
    detailPage.replaceChildren(page);
    if (product.category?.id) void appendRelatedProducts(page, product);
  } catch (error) {
    detailPage.replaceChildren(node("div", { className: "empty-state" }, [node("h2", { text: "Produto indisponível" }), node("p", { text: publicMessage(error) }), button("Voltar ao catálogo", () => navigate("#ofertas"))]));
  }
}

async function appendRelatedProducts(page, product) {
  try {
    const result = await request(`${endpoints.products}?category=${product.category.id}&limit=4`);
    const related = result.items.filter((item) => item.id !== product.id);
    if (!related.length) return;
    const section = node("section", { className: "category-section" });
    section.append(node("p", { className: "eyebrow", text: "Mais desta categoria" }), node("h2", { text: "Produtos relacionados" }), node("div", { className: "product-grid" }, related.map(renderProductCard)));
    page.append(section);
  } catch { }
}

async function shareProduct(product) {
  const url = `${window.location.origin}${window.location.pathname}#produto/${product.id}`;
  try {
    if (navigator.share) await navigator.share({ title: product.title, text: `Confira ${product.title} na EliteHub Connect.`, url });
    else if (navigator.clipboard) { await navigator.clipboard.writeText(url); setStatus(marketStatus, "Link do produto copiado.", "success"); }
    else setStatus(marketStatus, "Não foi possível compartilhar neste navegador.");
  } catch (error) {
    if (error?.name !== "AbortError") setStatus(marketStatus, "Não foi possível compartilhar o produto.");
  }
}

async function toggleFavorite(productId) {
  if (!state.user) {
    showAuth("Entre para salvar produtos nos favoritos.", { kind: "favorite", productId });
    return;
  }
  try {
    if (state.favoriteIds.has(productId)) {
      await request(`${endpoints.favorites}/${productId}`, { method: "DELETE" });
      state.favoriteIds.delete(productId);
      setStatus(marketStatus, "Produto removido dos favoritos.", "success");
    } else {
      await request(`${endpoints.favorites}/${productId}`, { method: "POST" });
      state.favoriteIds.add(productId);
      setStatus(marketStatus, "Produto salvo nos favoritos.", "success");
    }
    void renderRoute();
  } catch (error) { setStatus(marketStatus, publicMessage(error)); }
}

async function addCartItem(productId, quantity = 1, variantId) {
  const payload = { productId, quantity, ...(variantId ? { variantId } : {}) };
  return request(endpoints.cartItems, { method: "PUT", body: JSON.stringify(payload) });
}

async function requestCartIntent(productId, variantId, nextRoute) {
  const action = { kind: "cart", productId, quantity: 1, variantId, nextRoute };
  if (!state.user) {
    showAuth(nextRoute === "#checkout" ? "Entre para continuar sua compra com segurança." : "Entre para adicionar produtos ao carrinho.", action);
    return;
  }
  try {
    await addCartItem(productId, 1, variantId);
    setStatus(marketStatus, "Produto adicionado ao carrinho.", "success");
    navigate(nextRoute);
  } catch (error) { setStatus(marketStatus, publicMessage(error)); }
}

function privatePanel(title, description) {
  showDetail();
  const panel = node("section", { className: "account-panel" });
  panel.append(button("Voltar ao catálogo", () => navigate("#ofertas"), "back-link"), node("h1", { text: title }), node("p", { text: description }));
  detailPage.replaceChildren(panel);
  return panel;
}

async function renderCart() {
  const panel = privatePanel("Meu carrinho", "Seus itens são vinculados à sua sessão segura.");
  try {
    const { cart } = await request(endpoints.cart);
    if (!cart.items.length) {
      panel.append(node("div", { className: "empty-state" }, [node("h2", { text: "Seu carrinho está vazio" }), node("p", { text: "Explore o catálogo para adicionar produtos." }), node("a", { className: "button button--primary", href: "#ofertas", text: "Explorar catálogo" })]));
      return;
    }
    const list = node("div", { className: "cart-list" });
    cart.items.forEach((item) => {
      const row = node("article", { className: "cart-item" });
      row.append(item.imageUrl ? imageFor(item.imageUrl, item.product.title) : node("div", { className: "product-card__image", text: "Sem imagem" }));
      const info = node("div");
      info.append(node("h2", { text: item.product.title }), node("p", { text: `Quantidade: ${item.quantity}` }), item.variant ? node("p", { text: `Variação: ${Object.values(item.variant.attributes).map(String).join(" · ")}` }) : null);
      const controls = node("div");
      controls.append(node("p", { className: "cart-item__price", text: formatCurrency(item.unitPriceCents * item.quantity) }), button("Remover", async () => { try { await request(`${endpoints.cartItems}/${item.id}`, { method: "DELETE" }); await renderCart(); } catch (error) { setStatus(marketStatus, publicMessage(error)); } }, "text-button"));
      row.append(info, controls);
      list.append(row);
    });
    const summary = node("div", { className: "cart-summary" });
    summary.append(node("div", {}, [node("span", { text: "Subtotal" }), node("strong", { text: formatCurrency(cart.subtotalCents) })]), button("Continuar compra", () => navigate("#checkout"), "button button--primary"));
    panel.append(list, summary);
  } catch (error) { panel.append(node("div", { className: "empty-state", text: publicMessage(error) })); }
}

function addressLabel(address) {
  return `${address.street}, ${address.number}${address.complement ? ` - ${address.complement}` : ""}, ${address.neighborhood}, ${address.city}/${address.state}`;
}

function createAddressForm(onCreated) {
  const form = node("form", { className: "form-stack" });
  const fields = [["label", "Identificação", "Casa"], ["recipientName", "Destinatário", "Nome completo"], ["postalCode", "CEP", "Somente números"], ["street", "Rua", ""], ["number", "Número", ""], ["complement", "Complemento", "Opcional"], ["neighborhood", "Bairro", ""], ["city", "Cidade", ""], ["state", "UF", "SP"]];
  fields.forEach(([name, label, placeholder]) => {
    const input = node("input", { attrs: { name, required: name !== "complement", placeholder, maxlength: name === "state" ? 2 : undefined } });
    form.append(node("label", { className: "field-group", text: label }, [input]));
  });
  const submit = button("Salvar endereço", null, "button button--secondary");
  submit.type = "submit";
  form.append(submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const payload = { ...values, postalCode: String(values.postalCode).replace(/\D/g, ""), state: String(values.state).toUpperCase() };
    setSubmitState(submit, true, "Salvando");
    try { await request(endpoints.addresses, { method: "POST", body: JSON.stringify(payload) }); await onCreated(); } catch (error) { setStatus(marketStatus, publicMessage(error)); } finally { setSubmitState(submit, false); }
  });
  return form;
}

async function renderCheckout() {
  const panel = privatePanel("Finalizar compra", "Confirme o endereço e escolha o meio de pagamento disponível.");
  try {
    const [{ cart }, addresses] = await Promise.all([request(endpoints.cart), request(endpoints.addresses)]);
    if (!cart.items.length) {
      panel.append(node("div", { className: "empty-state" }, [node("h2", { text: "Seu carrinho está vazio" }), button("Ver catálogo", () => navigate("#ofertas"))]));
      return;
    }
    const layout = node("div", { className: "checkout-grid" });
    const main = node("div", { className: "cart-panel" });
    main.append(node("h2", { text: "Endereço de entrega" }));
    let selectedAddressId = addresses.items[0]?.id || null;
    const addressList = node("div", { className: "address-list" });
    if (addresses.items.length) addresses.items.forEach((address, index) => {
      const radio = node("input", { attrs: { type: "radio", name: "checkout-address", value: address.id, checked: index === 0 } });
      radio.checked = index === 0;
      radio.addEventListener("change", () => { selectedAddressId = address.id; });
      const copy = node("span");
      copy.append(node("strong", { text: address.label }), document.createTextNode(addressLabel(address)));
      addressList.append(node("label", { className: "address-choice" }, [radio, copy]));
    });
    main.append(addressList);
    if (!addresses.items.length) {
      main.append(node("p", { text: "Cadastre um endereço para continuar." }), createAddressForm(renderCheckout));
      layout.append(main);
      panel.append(layout);
      return;
    }
    const payment = node("div", { className: "cart-panel" });
    payment.append(node("h2", { text: "Pagamento" }), node("p", { text: "A confirmação é feita pelo provedor configurado no servidor." }));
    let paymentMethod = "PIX";
    const options = node("div", { className: "payment-options" });
    [["PIX", "Pix"], ["CREDIT_CARD", "Cartão"], ["BOLETO", "Boleto"]].forEach(([value, label]) => {
      const radio = node("input", { attrs: { type: "radio", name: "payment-method", value, checked: value === "PIX" } });
      radio.checked = value === "PIX";
      radio.addEventListener("change", () => { paymentMethod = value; });
      options.append(node("label", {}, [radio, node("span", { text: label })]));
    });
    const total = node("strong", { text: formatCurrency(cart.subtotalCents) });
    const submit = button("Criar pedido", null, "button button--primary");
    submit.addEventListener("click", async () => {
      if (!selectedAddressId) return setStatus(marketStatus, "Selecione um endereço para continuar.");
      setSubmitState(submit, true, "Criando pedido");
      try {
        const idempotencyKey = crypto.randomUUID();
        await request(endpoints.checkout, { method: "POST", headers: { "idempotency-key": idempotencyKey }, body: JSON.stringify({ addressId: selectedAddressId, paymentMethod }) });
        setStatus(marketStatus, "Pedido criado. Siga as instruções do provedor de pagamento.", "success");
        navigate("#pedidos");
      } catch (error) { setStatus(marketStatus, publicMessage(error)); } finally { setSubmitState(submit, false); }
    });
    payment.append(options, node("div", { className: "cart-summary" }, [node("div", {}, [node("span", { text: "Subtotal" }), total]), submit]));
    layout.append(main, payment);
    panel.append(layout);
  } catch (error) { panel.append(node("div", { className: "empty-state", text: publicMessage(error) })); }
}

async function renderFavorites() {
  const panel = privatePanel("Favoritos", "Produtos salvos para consultar depois.");
  try {
    const result = await request(endpoints.favorites);
    if (!result.items.length) {
      panel.append(node("div", { className: "empty-state" }, [node("h2", { text: "Você ainda não salvou produtos" }), node("p", { text: "Use o ícone de coração em qualquer produto do catálogo." })]));
      return;
    }
    panel.append(node("div", { className: "product-grid" }, result.items.map((item) => {
      const card = node("article", { className: "product-card" });
      const open = node("button", { className: "product-card__link", type: "button", onClick: () => navigate(`#produto/${item.id}`) });
      const image = node("div", { className: "product-card__image", text: item.imageUrl ? "" : "Imagem indisponível" });
      if (item.imageUrl) image.append(imageFor(item.imageUrl, item.title));
      open.append(image, node("div", { className: "product-card__content" }, [node("h2", { className: "product-card__title", text: item.title }), node("p", { className: "product-card__price", text: formatCurrency(item.priceCents) })]));
      card.append(open);
      return card;
    })));
  } catch (error) { panel.append(node("div", { className: "empty-state", text: publicMessage(error) })); }
}

async function renderNotifications() {
  const panel = privatePanel("Notificações", "Atualizações relacionadas à sua conta e aos seus pedidos.");
  try {
    const result = await request(endpoints.notifications);
    if (!result.items.length) { panel.append(node("div", { className: "empty-state" }, [node("h2", { text: "Você não tem notificações" }), node("p", { text: "Quando houver uma atualização relevante, ela aparecerá aqui." })])); return; }
    const list = node("div", { className: "notification-list" });
    result.items.forEach((item) => {
      const row = node("article", { className: `notification-item ${item.readAt ? "" : "notification-item--unread"}` });
      const copy = node("div", {}, [node("h2", { text: item.title }), node("p", { text: item.body })]);
      const date = node("time", { text: formatDate(item.createdAt), attrs: { datetime: item.createdAt } });
      row.append(copy, date);
      row.addEventListener("click", async () => { if (!item.readAt) await request(`${endpoints.notifications}/${item.id}/read`, { method: "PATCH" }); if (item.linkPath) navigate(item.linkPath); else void renderNotifications(); });
      list.append(row);
    });
    panel.append(list);
  } catch (error) { panel.append(node("div", { className: "empty-state", text: publicMessage(error) })); }
}

async function renderOrders() {
  const panel = privatePanel("Meus pedidos", "Acompanhe seus pedidos e os respectivos status.");
  try {
    const result = await request(endpoints.orders);
    if (!result.items.length) { panel.append(node("div", { className: "empty-state" }, [node("h2", { text: "Você ainda não tem pedidos" }), node("p", { text: "Quando concluir uma compra, ela aparecerá nesta área." })])); return; }
    const list = node("div", { className: "notification-list" });
    result.items.forEach((item) => list.append(node("article", { className: "notification-item" }, [node("div", {}, [node("h2", { text: `Pedido ${item.number}` }), node("p", { text: `${formatCurrency(item.totalCents)} · ${item.status}` })]), node("time", { text: formatDate(item.createdAt), attrs: { datetime: item.createdAt } })])));
    panel.append(list);
  } catch (error) { panel.append(node("div", { className: "empty-state", text: publicMessage(error) })); }
}

function renderAccount() {
  const panel = privatePanel("Minha conta", "Informações da sessão atualmente ativa.");
  panel.append(node("div", { className: "info-panel" }, [node("h2", { text: state.user.fullName }), node("p", { text: state.user.email }), node("p", { className: state.user.emailVerified ? "stock stock--available" : "stock stock--unavailable", text: state.user.emailVerified ? "E-mail confirmado" : "E-mail ainda não confirmado" }), node("div", { className: "product-actions" }, [button("Meus pedidos", () => navigate("#pedidos")), button("Favoritos", () => navigate("#favoritos"))]) ]));
}

async function renderSeller(sellerId) {
  showDetail();
  detailPage.textContent = "Carregando loja…";
  try {
    const { seller } = await request(`/api/v1/sellers/${sellerId}`);
    document.title = `${seller.storeName} | EliteHub Connect`;
    const page = node("div");
    page.append(button("Voltar ao catálogo", () => navigate("#ofertas"), "back-link"));
    const header = node("section", { className: "store-header" }, [node("p", { className: "eyebrow", text: "Loja verificada" }), node("h1", { text: seller.storeName }), node("p", { text: seller.description || "Esta loja não informou uma descrição pública." })]);
    page.append(header, node("section", { className: "category-section" }, [node("p", { className: "eyebrow", text: `${seller.productCount} produtos ativos` }), node("h2", { text: "Produtos desta loja" })]));
    const products = await request(`${endpoints.products}?seller=${seller.id}&limit=12`);
    page.append(node("div", { className: "product-grid" }, products.items.map(renderProductCard)));
    detailPage.replaceChildren(page);
  } catch (error) { detailPage.replaceChildren(node("div", { className: "empty-state" }, [node("h2", { text: "Loja indisponível" }), node("p", { text: publicMessage(error) }), button("Voltar ao catálogo", () => navigate("#ofertas"))])); }
}

async function renderRoute() {
  const route = currentRoute();
  closeAccountMenu();
  document.querySelector("#market-nav").classList.remove("is-open");
  if (route.startsWith("#produto/")) return renderProduct(route.slice("#produto/".length));
  if (route.startsWith("#loja/")) return renderSeller(route.slice("#loja/".length));
  const privateRoutes = { "#carrinho": [renderCart, "Entre para acessar seu carrinho."], "#checkout": [renderCheckout, "Entre para continuar sua compra com segurança."], "#favoritos": [renderFavorites, "Entre para acessar seus favoritos."], "#notificacoes": [renderNotifications, "Entre para acessar suas notificações."], "#pedidos": [renderOrders, "Entre para acessar seus pedidos."], "#conta": [renderAccount, "Entre para acessar sua conta."] };
  if (privateRoutes[route]) {
    if (!state.user) return showAuth(privateRoutes[route][1], { kind: "route", route });
    return privateRoutes[route][0]();
  }
  showCatalog();
  await Promise.all([loadCategories(), loadProducts()]);
  if (route === "#categorias" || route === "#ofertas") requestAnimationFrame(() => document.querySelector(route)?.scrollIntoView({ block: "start" }));
}

async function logout() {
  try { await request(endpoints.logout, { method: "POST" }); } catch { }
  state.user = null;
  state.favoriteIds = new Set();
  renderAccountMenu();
  closeAccountMenu();
  setStatus(marketStatus, "Você saiu da sua conta.", "success");
  navigate("#inicio");
}

document.querySelectorAll("[data-theme-toggle]").forEach((element) => element.addEventListener("click", () => {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("elitehub-theme", document.documentElement.dataset.theme); } catch { }
  syncThemeButtonLabels();
}));

document.querySelectorAll("[data-password-toggle]").forEach((element) => element.addEventListener("click", () => {
  const input = document.querySelector(`#${element.dataset.passwordToggle}`);
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  element.textContent = visible ? "Mostrar" : "Ocultar";
  element.setAttribute("aria-label", visible ? "Mostrar senha" : "Ocultar senha");
}));

document.querySelector("#auth-switch").addEventListener("click", (event) => switchAuthMode(event.currentTarget.dataset.authMode));
document.querySelectorAll("[data-auth-mode]").forEach((element) => element.addEventListener("click", () => switchAuthMode(element.dataset.authMode)));
document.querySelector("#close-auth-dialog").addEventListener("click", () => authDialog.close());
document.querySelector("#google-login").addEventListener("click", () => { try { sessionStorage.setItem("elitehub-pending-action", JSON.stringify(state.pendingAction)); } catch { } window.location.assign("/api/v1/auth/google"); });

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector("button[type=submit]"); clearErrors(form); setStatus(authStatus, "");
  const email = form.email.value.trim(); const password = form.password.value;
  if (!email) return showInputError("login-email-error", "Informe seu e-mail.");
  if (!/^\S+@\S+\.\S+$/.test(email)) return showInputError("login-email-error", "Digite um e-mail válido.");
  if (!password) return showInputError("login-password-error", "Informe sua senha.");
  setSubmitState(submit, true, "Entrando");
  try { await request(endpoints.login, { method: "POST", body: JSON.stringify({ email, password, rememberMe: form.rememberMe.checked }) }); authDialog.close(); await initializeSession(true); } catch (error) { setStatus(authStatus, publicMessage(error)); } finally { setSubmitState(submit, false); }
});

document.querySelector("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector("button[type=submit]"); clearErrors(form); setStatus(authStatus, "");
  const firstName = form.firstName.value.trim(); const lastName = form.lastName.value.trim(); const email = form.email.value.trim(); const password = form.password.value; const passwordConfirmation = form.passwordConfirmation.value;
  if (!firstName) return showInputError("register-first-name-error", "Informe seu nome."); if (!lastName) return showInputError("register-last-name-error", "Informe seu sobrenome."); if (!/^\S+@\S+\.\S+$/.test(email)) return showInputError("register-email-error", "Digite um e-mail válido."); if (!passwordIsStrong(password)) return showInputError("register-password-error", "Sua senha precisa atender aos requisitos de segurança."); if (password !== passwordConfirmation) return showInputError("register-password-confirmation-error", "As senhas não coincidem.");
  setSubmitState(submit, true, "Criando conta");
  try { const result = await request(endpoints.register, { method: "POST", body: JSON.stringify({ fullName: `${firstName} ${lastName}`, email, password, passwordConfirmation }) }); form.reset(); switchAuthMode("login", true); setStatus(authStatus, result.message, "success"); } catch (error) { setStatus(authStatus, publicMessage(error)); } finally { setSubmitState(submit, false); }
});

document.querySelector("#recovery-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector("button[type=submit]"); const email = form.email.value.trim(); clearErrors(form);
  if (!/^\S+@\S+\.\S+$/.test(email)) return showInputError("recovery-email-error", "Digite um e-mail válido."); setSubmitState(submit, true, "Enviando");
  try { const result = await request(endpoints.recovery, { method: "POST", body: JSON.stringify({ email }) }); setStatus(authStatus, result.message, "success"); } catch (error) { setStatus(authStatus, publicMessage(error)); } finally { setSubmitState(submit, false); }
});

document.querySelector("#reset-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector("button[type=submit]"); const password = form.password.value; const passwordConfirmation = form.passwordConfirmation.value; clearErrors(form);
  if (!state.resetToken) return setStatus(authStatus, "Não foi possível validar a solicitação de redefinição."); if (!passwordIsStrong(password)) return showInputError("reset-password-error", "Sua senha precisa atender aos requisitos de segurança."); if (password !== passwordConfirmation) return showInputError("reset-password-confirmation-error", "As senhas não coincidem."); setSubmitState(submit, true, "Salvando");
  try { const result = await request(endpoints.reset, { method: "POST", body: JSON.stringify({ token: state.resetToken, password, passwordConfirmation }) }); state.resetToken = null; switchAuthMode("login", true); setStatus(authStatus, result.message, "success"); } catch (error) { setStatus(authStatus, publicMessage(error)); } finally { setSubmitState(submit, false); }
});

document.querySelector("#search-form").addEventListener("submit", (event) => { event.preventDefault(); state.searchTerm = searchInput.value.trim(); state.page.offset = 0; state.filters.sort = state.searchTerm ? "relevance" : "newest"; document.querySelector("#sort-select").value = state.filters.sort; hideSuggestions(); navigate("#ofertas"); });
searchInput.addEventListener("input", () => { void loadSuggestions(); });
searchInput.addEventListener("keydown", (event) => { if (event.key === "Escape") hideSuggestions(); if (event.key === "ArrowDown" && !searchSuggestions.hidden) { event.preventDefault(); suggestionPosition = 0; searchSuggestions.querySelector("button")?.focus(); } });
searchSuggestions.addEventListener("keydown", (event) => {
  const options = [...searchSuggestions.querySelectorAll("button")];
  const current = options.indexOf(document.activeElement);
  if (event.key === "ArrowDown" && current < options.length - 1) { event.preventDefault(); options[current + 1]?.focus(); }
  if (event.key === "ArrowUp") { event.preventDefault(); if (current > 0) options[current - 1]?.focus(); else searchInput.focus(); }
  if (event.key === "Escape") { hideSuggestions(); searchInput.focus(); }
});
document.querySelector("#refresh-products").addEventListener("click", () => void loadProducts());
document.querySelector("#apply-filters").addEventListener("click", () => { const min = Number(document.querySelector("#min-price").value); const max = Number(document.querySelector("#max-price").value); state.filters.minPriceCents = Number.isFinite(min) && min > 0 ? Math.round(min * 100) : null; state.filters.maxPriceCents = Number.isFinite(max) && max > 0 ? Math.round(max * 100) : null; state.filters.sort = document.querySelector("#sort-select").value; state.page.offset = 0; void loadProducts(); });
document.querySelector("#clear-filters").addEventListener("click", () => { state.filters = { maxPriceCents: null, minPriceCents: null, sort: "newest" }; state.activeCategory = null; state.page.offset = 0; document.querySelector("#min-price").value = ""; document.querySelector("#max-price").value = ""; document.querySelector("#sort-select").value = "newest"; void loadCategories(); void loadProducts(); });
document.querySelector("#cart-button").addEventListener("click", () => requireProtectedRoute("#carrinho", "Entre para acessar seu carrinho."));
document.querySelectorAll("[data-protected-route]").forEach((element) => element.addEventListener("click", () => requireProtectedRoute(element.dataset.protectedRoute, `Entre para acessar ${element.getAttribute("aria-label")?.toLowerCase() || "esta área"}.`)));
accountButton.addEventListener("click", () => { const open = accountMenu.hidden; accountMenu.hidden = !open; accountButton.setAttribute("aria-expanded", String(open)); });
document.querySelector("#mobile-menu-button").addEventListener("click", (event) => { const menu = document.querySelector("#market-nav"); const open = menu.classList.toggle("is-open"); event.currentTarget.setAttribute("aria-expanded", String(open)); });
document.addEventListener("click", (event) => { if (!event.target.closest(".account-menu-wrap")) closeAccountMenu(); if (!event.target.closest(".search")) hideSuggestions(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeAccountMenu(); hideSuggestions(); } });
window.addEventListener("hashchange", () => { void renderRoute(); });

const query = new URLSearchParams(window.location.search);
const resetToken = query.get("reset_token");
const oauthError = query.get("auth_error");
if (resetToken) { state.resetToken = resetToken; history.replaceState({}, "", `${window.location.pathname}#inicio`); }
restorePendingAction();
syncThemeButtonLabels();
(async () => {
  try { await request(endpoints.csrf); } catch (error) { setStatus(marketStatus, publicMessage(error)); }
  await Promise.all([loadProviders(), request(endpoints.health).catch((error) => setStatus(marketStatus, publicMessage(error)))]);
  await initializeSession(Boolean(state.pendingAction));
  if (resetToken) showAuth("Defina uma nova senha para recuperar sua conta.", null, "reset");
  if (oauthError) showAuth("Não foi possível concluir o login com Google. Tente novamente ou entre com e-mail.");
  await renderRoute();
})();
