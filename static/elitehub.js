const endpoints = {
  categories: "/api/v1/categories",
  csrf: "/api/v1/security/csrf",
  health: "/api/v1/health",
  login: "/api/v1/auth/login",
  logout: "/api/v1/auth/logout",
  products: "/api/v1/products",
  recovery: "/api/v1/auth/password-recovery",
  register: "/api/v1/auth/register",
  reset: "/api/v1/auth/password-reset",
  session: "/api/v1/auth/session",
};

const state = { activeCategory: null, resetToken: null, searchTerm: "", user: null };
const authView = document.querySelector("#auth-view");
const marketView = document.querySelector("#marketplace-view");
const authStatus = document.querySelector("#auth-status");
const marketStatus = document.querySelector("#market-status");
const productList = document.querySelector("#product-list");
const categoryList = document.querySelector("#category-list");
const productDialog = document.querySelector("#product-dialog");
const productDetail = document.querySelector("#product-detail");
const authSwitch = document.querySelector("#auth-switch");
const authSwitchPrompt = document.querySelector("#auth-switch-prompt");
const googleSection = document.querySelector("#google-section");

function publicMessage(error) {
  if (error?.code === "BACKEND_UNAVAILABLE") return "Não foi possível conectar ao serviço. Tente novamente em instantes.";
  if (error?.code === "SESSION_EXPIRED") return "Sua sessão expirou. Entre novamente para continuar.";
  if (error?.code === "RATE_LIMITED") return "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.";
  if (error && typeof error === "object" && typeof error.message === "string") return error.message;
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

async function ensureCsrf() {
  try {
    await request(endpoints.csrf);
  } catch (error) {
    setStatus(authStatus, publicMessage(error));
  }
}

async function checkBackendAvailability() {
  try {
    await request(endpoints.health);
  } catch (error) {
    setStatus(authStatus, publicMessage(error));
  }
}

function clearErrors(form) {
  form.querySelectorAll(".field-error").forEach((element) => { element.textContent = ""; });
}

function showInputError(id, message) {
  const fieldError = document.querySelector(`#${id}`);
  if (fieldError) fieldError.textContent = message;
}

function setSubmitState(button, loading, label) {
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent.trim();
  button.disabled = loading;
  button.classList.toggle("is-loading", loading);
  button.textContent = loading ? label : button.dataset.defaultLabel;
}

function passwordIsStrong(password) {
  return password.length >= 12 && password.length <= 256 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
}

const modes = {
  login: {
    cardSubtitle: "Use seu e-mail e senha para continuar.",
    cardTitle: "Entre na sua conta",
    form: "#login-form",
    panelSubtitle: "Acesse sua conta para continuar.",
    panelTitle: "Entre na EliteHub",
    showGoogle: true,
    switchLabel: "Criar conta",
    switchMode: "register",
    switchPrompt: "Ainda não tenho uma conta",
  },
  register: {
    cardSubtitle: "Crie seu acesso para comprar, vender e se conectar.",
    cardTitle: "Crie sua conta",
    form: "#register-form",
    panelSubtitle: "Compre, venda e conecte-se com profissionais.",
    panelTitle: "Crie sua conta",
    showGoogle: true,
    switchLabel: "Entrar",
    switchMode: "login",
    switchPrompt: "Já tenho uma conta",
  },
  recovery: {
    cardSubtitle: "Informe seu e-mail para solicitar a recuperação.",
    cardTitle: "Recuperar senha",
    form: "#recovery-form",
    panelSubtitle: "Recupere o acesso à sua conta com segurança.",
    panelTitle: "Recuperar acesso",
    showGoogle: false,
    switchLabel: "Voltar para entrar",
    switchMode: "login",
    switchPrompt: "Lembrou sua senha?",
  },
  reset: {
    cardSubtitle: "Escolha uma nova senha forte para sua conta.",
    cardTitle: "Defina uma nova senha",
    form: "#reset-form",
    panelSubtitle: "Sua nova senha será aplicada somente após validação segura.",
    panelTitle: "Nova senha",
    showGoogle: false,
    switchLabel: "Voltar para entrar",
    switchMode: "login",
    switchPrompt: "Já definiu sua senha?",
  },
};

function switchAuthMode(mode, { preserveStatus = false } = {}) {
  const current = modes[mode] || modes.login;
  document.querySelectorAll(".form-stack").forEach((form) => { form.hidden = `#${form.id}` !== current.form; });
  document.querySelector("#auth-title").textContent = current.cardTitle;
  document.querySelector("#auth-subtitle").textContent = current.cardSubtitle;
  document.querySelector("#auth-page-title").textContent = current.panelTitle;
  document.querySelector("#auth-panel-subtitle").textContent = current.panelSubtitle;
  googleSection.hidden = !current.showGoogle;
  authSwitchPrompt.textContent = current.switchPrompt;
  authSwitch.textContent = current.switchLabel;
  authSwitch.dataset.authMode = current.switchMode;
  if (!preserveStatus) setStatus(authStatus, "");
  document.querySelector(current.form)?.querySelector("input")?.focus({ preventScroll: true });
}

function syncThemeButtonLabels() {
  const dark = document.documentElement.dataset.theme === "dark";
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.setAttribute("aria-label", dark ? "Ativar tema claro" : "Ativar tema escuro");
    button.setAttribute("title", dark ? "Ativar tema claro" : "Ativar tema escuro");
  });
}

function formatCurrency(cents) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function fallbackImage(image) {
  const fallback = document.createElement("div");
  fallback.className = "product-card__image";
  fallback.textContent = "Imagem indisponível";
  image.replaceWith(fallback);
}

function renderSkeletons() {
  const template = document.querySelector("#product-skeleton-template");
  productList.replaceChildren(...Array.from({ length: 8 }, () => template.content.cloneNode(true)));
  productList.setAttribute("aria-busy", "true");
}

function renderProducts(items) {
  productList.setAttribute("aria-busy", "false");
  if (!items.length) {
    productList.innerHTML = '<div class="empty-state"><h2>Nenhum produto encontrado</h2><p>Tente remover filtros ou pesquisar outro termo.</p></div>';
    return;
  }
  const cards = items.map((product) => {
    const card = document.createElement("article");
    card.className = "product-card";
    const button = document.createElement("button");
    button.className = "product-card__button";
    button.type = "button";
    button.setAttribute("aria-label", `Ver detalhes de ${product.title}`);
    button.addEventListener("click", () => openProduct(product.id));
    const imageWrap = document.createElement("div");
    imageWrap.className = "product-card__image";
    if (product.imageUrl) {
      const image = new Image();
      image.alt = "";
      image.loading = "lazy";
      image.src = product.imageUrl;
      image.addEventListener("error", () => fallbackImage(image), { once: true });
      imageWrap.append(image);
    } else imageWrap.textContent = "Imagem indisponível";
    const content = document.createElement("div");
    content.className = "product-card__content";
    content.innerHTML = "<h2 class=product-card__title></h2><p class=product-card__meta></p><p class=product-card__price></p><p class=stock></p>";
    content.querySelector("h2").textContent = product.title;
    content.querySelector(".product-card__meta").textContent = `${product.category?.name || "Sem categoria"} · ${product.seller.name}`;
    content.querySelector(".product-card__price").textContent = formatCurrency(product.priceCents);
    const stock = content.querySelector(".stock");
    const available = product.stockQuantity > 0;
    stock.className = `stock ${available ? "stock--available" : "stock--unavailable"}`;
    stock.textContent = available ? "Em estoque" : "Indisponível";
    button.append(imageWrap, content);
    card.append(button);
    return card;
  });
  productList.replaceChildren(...cards);
}

async function loadProducts() {
  renderSkeletons();
  setStatus(marketStatus, "");
  const parameters = new URLSearchParams();
  if (state.searchTerm) parameters.set("q", state.searchTerm);
  if (state.activeCategory) parameters.set("category", state.activeCategory);
  try {
    const result = await request(`${endpoints.products}?${parameters}`);
    renderProducts(result.items);
  } catch (error) {
    productList.setAttribute("aria-busy", "false");
    productList.replaceChildren();
    setStatus(marketStatus, publicMessage(error));
  }
}

async function loadCategories() {
  try {
    const result = await request(endpoints.categories);
    categoryList.replaceChildren();
    const all = document.createElement("button");
    all.className = "category-chip";
    all.type = "button";
    all.textContent = "Todas";
    all.setAttribute("aria-pressed", String(!state.activeCategory));
    all.addEventListener("click", () => { state.activeCategory = null; loadCategories(); loadProducts(); });
    categoryList.append(all);
    result.items.forEach((category) => {
      const button = document.createElement("button");
      button.className = "category-chip";
      button.type = "button";
      button.textContent = category.name;
      button.setAttribute("aria-pressed", String(state.activeCategory === category.id));
      button.addEventListener("click", () => { state.activeCategory = category.id; loadCategories(); loadProducts(); });
      categoryList.append(button);
    });
  } catch {
    categoryList.replaceChildren();
  }
}

async function openProduct(id) {
  productDetail.textContent = "Carregando detalhes do produto…";
  productDialog.showModal();
  try {
    const { product } = await request(`${endpoints.products}/${id}`);
    productDetail.replaceChildren();
    const layout = document.createElement("div");
    layout.className = "product-detail";
    const image = new Image();
    image.className = "product-detail__image";
    image.alt = "";
    image.src = product.imageUrl || "";
    image.addEventListener("error", () => { image.remove(); }, { once: true });
    const content = document.createElement("div");
    content.innerHTML = "<p class=eyebrow></p><h2 id=product-dialog-title></h2><p class=product-detail__price></p><p class=product-detail__seller></p><p class=product-detail__description></p><p class=stock></p>";
    content.querySelector(".eyebrow").textContent = product.category?.name || "Sem categoria";
    content.querySelector("h2").textContent = product.title;
    content.querySelector(".product-detail__price").textContent = formatCurrency(product.priceCents);
    content.querySelector(".product-detail__seller").textContent = `Vendido por ${product.seller.name}`;
    content.querySelector(".product-detail__description").textContent = product.description;
    content.querySelector(".stock").textContent = product.stockQuantity > 0 ? "Em estoque" : "Indisponível";
    layout.append(image, content);
    productDetail.append(layout);
  } catch (error) {
    productDetail.textContent = publicMessage(error);
  }
}

function openMarketplace(user) {
  state.user = user;
  authView.hidden = true;
  marketView.hidden = false;
  document.querySelector("#account-button").textContent = user.fullName.split(" ")[0] || "Conta";
  document.querySelector("#seller-area-button").hidden = !user.roles.includes("SELLER");
  document.querySelector("#professional-area-button").hidden = !user.roles.includes("PROFESSIONAL");
  loadCategories();
  loadProducts();
}

async function initializeSession() {
  try {
    const result = await request(endpoints.session);
    openMarketplace(result.user);
  } catch (error) {
    if (error?.code !== "SESSION_EXPIRED") setStatus(authStatus, publicMessage(error));
  }
}

document.querySelectorAll("[data-theme-toggle]").forEach((button) => button.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("elitehub-theme", next); } catch { /* Theme storage is optional. */ }
  syncThemeButtonLabels();
}));

document.querySelectorAll("[data-password-toggle]").forEach((button) => button.addEventListener("click", () => {
  const input = document.querySelector(`#${button.dataset.passwordToggle}`);
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  button.textContent = visible ? "Mostrar" : "Ocultar";
  button.setAttribute("aria-label", visible ? "Mostrar senha" : "Ocultar senha");
  button.setAttribute("title", visible ? "Mostrar senha" : "Ocultar senha");
}));

document.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => switchAuthMode(button.dataset.authMode)));

document.querySelector("#google-login").addEventListener("click", (event) => {
  const button = event.currentTarget;
  setSubmitState(button, true, "Redirecionando");
  window.location.assign("/api/v1/auth/google");
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  clearErrors(form);
  setStatus(authStatus, "");
  const email = form.email.value.trim();
  const password = form.password.value;
  if (!email) return showInputError("login-email-error", "Informe seu e-mail.");
  if (!/^\S+@\S+\.\S+$/.test(email)) return showInputError("login-email-error", "Digite um e-mail válido.");
  if (!password) return showInputError("login-password-error", "Informe sua senha.");
  setSubmitState(button, true, "Entrando");
  try {
    await request(endpoints.login, { method: "POST", body: JSON.stringify({ email, password, rememberMe: form.rememberMe.checked }) });
    await initializeSession();
  } catch (error) {
    setStatus(authStatus, publicMessage(error));
  } finally {
    setSubmitState(button, false);
  }
});

document.querySelector("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  clearErrors(form);
  setStatus(authStatus, "");
  const firstName = form.firstName.value.trim();
  const lastName = form.lastName.value.trim();
  const email = form.email.value.trim();
  const password = form.password.value;
  const passwordConfirmation = form.passwordConfirmation.value;
  if (!firstName) return showInputError("register-first-name-error", "Informe seu nome.");
  if (!lastName) return showInputError("register-last-name-error", "Informe seu sobrenome.");
  if (!email) return showInputError("register-email-error", "Informe seu e-mail.");
  if (!/^\S+@\S+\.\S+$/.test(email)) return showInputError("register-email-error", "Digite um e-mail válido.");
  if (!passwordIsStrong(password)) return showInputError("register-password-error", "Sua senha precisa atender aos requisitos de segurança.");
  if (password !== passwordConfirmation) return showInputError("register-password-confirmation-error", "As senhas não coincidem.");
  setSubmitState(button, true, "Criando conta");
  try {
    const result = await request(endpoints.register, { method: "POST", body: JSON.stringify({ fullName: `${firstName} ${lastName}`, email, password, passwordConfirmation }) });
    setStatus(authStatus, result.message, "success");
    form.reset();
    switchAuthMode("login", { preserveStatus: true });
  } catch (error) {
    setStatus(authStatus, publicMessage(error));
  } finally {
    setSubmitState(button, false);
  }
});

document.querySelector("#recovery-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  clearErrors(form);
  setStatus(authStatus, "");
  const email = form.email.value.trim();
  if (!email) return showInputError("recovery-email-error", "Informe seu e-mail.");
  if (!/^\S+@\S+\.\S+$/.test(email)) return showInputError("recovery-email-error", "Digite um e-mail válido.");
  setSubmitState(button, true, "Enviando");
  try {
    const result = await request(endpoints.recovery, { method: "POST", body: JSON.stringify({ email }) });
    setStatus(authStatus, result.message, "success");
  } catch (error) {
    setStatus(authStatus, publicMessage(error));
  } finally {
    setSubmitState(button, false);
  }
});

document.querySelector("#reset-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  clearErrors(form);
  setStatus(authStatus, "");
  const password = form.password.value;
  const passwordConfirmation = form.passwordConfirmation.value;
  if (!state.resetToken) return setStatus(authStatus, "Não foi possível concluir esta ação. Tente novamente.");
  if (!passwordIsStrong(password)) return showInputError("reset-password-error", "Sua senha precisa atender aos requisitos de segurança.");
  if (password !== passwordConfirmation) return showInputError("reset-password-confirmation-error", "As senhas não coincidem.");
  setSubmitState(button, true, "Salvando");
  try {
    const result = await request(endpoints.reset, { method: "POST", body: JSON.stringify({ token: state.resetToken, password, passwordConfirmation }) });
    state.resetToken = null;
    setStatus(authStatus, result.message, "success");
    switchAuthMode("login", { preserveStatus: true });
  } catch (error) {
    setStatus(authStatus, publicMessage(error));
  } finally {
    setSubmitState(button, false);
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try { await request(endpoints.logout, { method: "POST" }); } catch { /* A server-side expired session is already unusable. */ }
  state.user = null;
  marketView.hidden = true;
  authView.hidden = false;
  switchAuthMode("login");
  setStatus(authStatus, "Você saiu da sua conta.", "success");
});

document.querySelector("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  state.searchTerm = document.querySelector("#product-search").value.trim();
  loadProducts();
});
document.querySelector("#refresh-products").addEventListener("click", loadProducts);
document.querySelector("#close-product-dialog").addEventListener("click", () => productDialog.close());
document.querySelector("#mobile-menu-button").addEventListener("click", (event) => {
  const nav = document.querySelector("#market-nav");
  const open = nav.classList.toggle("is-open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
  event.currentTarget.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") document.querySelector("#market-nav").classList.remove("is-open");
});

const query = new URLSearchParams(window.location.search);
const oauthError = query.get("auth_error");
const resetToken = query.get("reset_token");
if (resetToken) {
  state.resetToken = resetToken;
  switchAuthMode("reset");
  history.replaceState({}, "", "/static/elitehub.html?mode=reset");
} else if (oauthError) {
  switchAuthMode("login", { preserveStatus: true });
  setStatus(authStatus, "Não foi possível concluir o login com Google. Tente novamente ou entre com e-mail.");
  history.replaceState({}, "", "/static/elitehub.html");
}

syncThemeButtonLabels();
(async () => {
  await ensureCsrf();
  await checkBackendAvailability();
  await initializeSession();
})();
