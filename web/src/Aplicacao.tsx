import {
  lazy,
  Suspense,
  type FormEvent,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";

import { type Aviso, type ContextoMercado, MercadoContext, type ModoAutenticacao, type Provedores, useMercado } from "./app/mercado-context";
import { FalhaDaApi, mensagemPublica, requisicao } from "./api";
import { obterAcaoPendente, retomarAcaoPendente, salvarAcaoPendente, type AcaoPendente } from "./auth/pending-action";
import { ConteudoProtegido } from "./routes/ConteudoProtegido";
import type { Produto, ProdutoResumo, UsuarioDaSessao } from "./types";

type Paginacao = { hasNext: boolean; limit: number; offset: number; total: number };
type EstadoAutenticacao = { mensagem: string; modo: ModoAutenticacao; resetToken?: string };

const CarrinhoPage = lazy(async () => import("./cart/CarrinhoPage").then((module) => ({ default: module.CarrinhoPage })));
const CheckoutPage = lazy(async () => import("./checkout/CheckoutPage").then((module) => ({ default: module.CheckoutPage })));
const ContaPage = lazy(async () => import("./account/ContaPage").then((module) => ({ default: module.ContaPage })));
const VendedorPage = lazy(async () => import("./seller/VendedorPage").then((module) => ({ default: module.VendedorPage })));
const AdministracaoPage = lazy(async () => import("./admin/AdministracaoPage").then((module) => ({ default: module.AdministracaoPage })));

function currency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" }).format(value / 100);
}

function date(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "Conta";
}

function rating(value: { average: number; count: number } | null): string | null {
  if (!value?.count) return null;
  const average = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value.average);
  return `★ ${average} (${value.count} ${value.count === 1 ? "avaliação" : "avaliações"})`;
}

function availability(value: ProdutoResumo["availability"]): string {
  if (value === "OUT_OF_STOCK") return "Indisponível";
  if (value === "LOW_STOCK") return "Últimas unidades";
  return "Disponível";
}

function strongPassword(value: string): boolean {
  return value.length >= 12 && value.length <= 256 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
}

function Icon({ name }: { name: "arrow" | "bell" | "cart" | "close" | "heart" | "location" | "menu" | "search" | "share" | "user" }): ReactNode {
  const paths = {
    arrow: <path d="m9 18 6-6-6-6" />,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    cart: <><path d="M3 4h2l2.1 10.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 1.9-1.4L20 8H6" /><circle cx="9" cy="20" r="1" /><circle cx="17" cy="20" r="1" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    heart: <path d="M20.8 4.8a5.4 5.4 0 0 0-7.6 0L12 6l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.6a5.4 5.4 0 0 0 0-7.6Z" />,
    location: <><path d="M20 10c0 5.25-8 10-8 10S4 15.25 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function GoogleMark(): ReactNode {
  return <svg className="provider-mark provider-mark--google" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3.2-4.4 3.2-7.3Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.5L15.4 17a6 6 0 0 1-8.9-3.2H3.2a10 10 0 0 0 0 8.8l3.3-2.6Z"/><path fill="#FBBC05" d="M6.5 13.8a6 6 0 0 1 0-3.6V7.6H3.2a10 10 0 0 0 0 8.8l3.3-2.6Z"/><path fill="#EA4335" d="M12 6a5.4 5.4 0 0 1 3.8 1.5l2.9-2.9A10 10 0 0 0 3.2 7.6l3.3 2.6A6 6 0 0 1 12 6Z"/></svg>;
}

function MicrosoftMark(): ReactNode {
  return <svg className="provider-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="#F25022" d="M2 2h9.5v9.5H2z"/><path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z"/><path fill="#00A4EF" d="M2 12.5h9.5V22H2z"/><path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z"/></svg>;
}

function ProvedorDoMercado({ children }: PropsWithChildren): ReactNode {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<UsuarioDaSessao | null>(null);
  const [sessaoVerificada, setSessaoVerificada] = useState(false);
  const [providers, setProviders] = useState<Provedores>({ google: false, microsoft: false });
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [auth, setAuth] = useState<EstadoAutenticacao | null>(null);
  const [pending, setPending] = useState<AcaoPendente | null>(obterAcaoPendente);
  const [notice, setNotice] = useState<Aviso | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  const publicarAviso = useCallback((message: string, kind: Aviso["kind"] = "error") => {
    setNotice({ kind, message });
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 6000);
  }, []);

  const refreshSession = useCallback(async (): Promise<UsuarioDaSessao | null> => {
    try {
      const result = await requisicao<{ user: UsuarioDaSessao }>("/api/v1/auth/session");
      setUser(result.user);
      return result.user;
    } catch (error) {
      setUser(null);
      if (!(error instanceof FalhaDaApi) || error.code !== "SESSION_EXPIRED") publicarAviso(mensagemPublica(error));
      return null;
    }
  }, [publicarAviso]);

  const atualizarFavoritos = useCallback(async () => {
    try {
      const result = await requisicao<{ items: Array<{ id: string }> }>("/api/v1/favorites");
      setFavorites(new Set(result.items.map((item) => item.id)));
    } catch {
      setFavorites(new Set());
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await requisicao("/api/v1/security/csrf");
        const available = await requisicao<Provedores>("/api/v1/auth/providers");
        if (active) setProviders(available);
      } catch (error) {
        if (active) publicarAviso(mensagemPublica(error));
      }
      const session = await refreshSession();
      if (active && session) await atualizarFavoritos();
      if (active) setSessaoVerificada(true);
    })();
    return () => { active = false; };
  }, [atualizarFavoritos, publicarAviso, refreshSession]);

  useEffect(() => {
    if (!user) setFavorites(new Set());
    else void atualizarFavoritos();
  }, [atualizarFavoritos, user]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const resetToken = params.get("reset_token");
    const oauthError = params.get("auth_error");
    if (resetToken) {
      setAuth({ mensagem: "Escolha uma nova senha forte para sua conta.", modo: "reset", resetToken });
      navigate(location.pathname, { replace: true });
    } else if (oauthError) {
      setAuth({ mensagem: "Não foi possível concluir o login com Google. Tente novamente ou entre com e-mail.", modo: "login" });
      navigate(location.pathname, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  const abrirAutenticacao = useCallback((message: string, action?: AcaoPendente, mode: ModoAutenticacao = "welcome") => {
    if (action) {
      setPending(action);
      salvarAcaoPendente(action);
    }
    setAuth({ mensagem: message, modo: mode });
  }, []);

  const abrirRotaProtegida = useCallback((path: string, message: string) => {
    if (user) navigate(path);
    else abrirAutenticacao(message, { kind: "route", path });
  }, [abrirAutenticacao, navigate, user]);

  const retomarAcao = useCallback(async () => {
    const action = pending;
    setPending(null);
    salvarAcaoPendente(null);
    if (!action) return;
    try {
      await retomarAcaoPendente({
        action,
        adicionarFavorito: (productId) => setFavorites((current) => new Set(current).add(productId)),
        navegar: navigate,
        publicarAviso,
        requisicao,
      });
    } catch (error) {
      publicarAviso(mensagemPublica(error));
    }
  }, [navigate, pending, publicarAviso]);

  const finalizarAutenticacao = useCallback(async () => {
    const session = await refreshSession();
    if (!session) return;
    setAuth(null);
    await retomarAcao();
  }, [refreshSession, retomarAcao]);

  const adicionarAoCarrinho = useCallback(async (productId: string, variantId: string | undefined, destination: string) => {
    if (!user) {
      abrirAutenticacao(destination === "/checkout" ? "Entre para continuar sua compra com segurança." : "Entre para adicionar produtos ao carrinho.", { destination, kind: "cart", productId, ...(variantId ? { variantId } : {}) });
      return;
    }
    try {
      await requisicao("/api/v1/cart/items", { body: JSON.stringify({ productId, quantity: 1, ...(variantId ? { variantId } : {}) }), method: "PUT" });
      publicarAviso("Produto adicionado ao carrinho.", "success");
      navigate(destination);
    } catch (error) {
      publicarAviso(mensagemPublica(error));
    }
  }, [abrirAutenticacao, navigate, publicarAviso, user]);

  const toggleFavorito = useCallback(async (productId: string) => {
    if (!user) {
      abrirAutenticacao("Entre para salvar produtos nos favoritos.", { kind: "favorite", productId });
      return;
    }
    try {
      const enabled = favorites.has(productId);
      await requisicao(`/api/v1/favorites/${productId}`, { method: enabled ? "DELETE" : "POST" });
      setFavorites((current) => {
        const next = new Set(current);
        if (enabled) next.delete(productId);
        else next.add(productId);
        return next;
      });
      publicarAviso(enabled ? "Produto removido dos favoritos." : "Produto salvo nos favoritos.", "success");
    } catch (error) {
      publicarAviso(mensagemPublica(error));
    }
  }, [abrirAutenticacao, favorites, publicarAviso, user]);

  const sair = useCallback(async () => {
    try {
      await requisicao("/api/v1/auth/logout", { method: "POST" });
    } catch {
      return;
    } finally {
      setUser(null);
      setFavorites(new Set());
      publicarAviso("Você saiu da sua conta.", "success");
      navigate("/");
    }
  }, [navigate, publicarAviso]);

  const value = useMemo<ContextoMercado>(() => ({ abrirAutenticacao, abrirRotaProtegida, adicionarAoCarrinho, favoritos: favorites, providers, publicarAviso, sair, sessaoVerificada, toggleFavorito, user }), [abrirAutenticacao, abrirRotaProtegida, adicionarAoCarrinho, favorites, providers, publicarAviso, sair, sessaoVerificada, toggleFavorito, user]);

  return <MercadoContext.Provider value={value}>
    <Cabecalho />
    <main id="conteudo-principal" className="market-main" tabIndex={-1}>
      <AnimatePresence initial={false}>{notice ? <motion.div className="status" data-kind={notice.kind} role="status" aria-live="polite" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>{notice.message}</motion.div> : null}</AnimatePresence>
      {children}
    </main>
    <Rodape />
    <AnimatePresence>{auth ? <ModalAutenticacao state={auth} close={() => setAuth(null)} onAuthenticated={finalizarAutenticacao} /> : null}</AnimatePresence>
  </MercadoContext.Provider>;
}

function Cabecalho(): ReactNode {
  const { abrirAutenticacao, abrirRotaProtegida, sair, user } = useMercado();
  const navigate = useNavigate();
  const location = useLocation();
  const reduced = useReducedMotion();
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim());
  const [suggestions, setSuggestions] = useState<Array<{ id: string; label: string }>>([]);
  const [theme, setTheme] = useState<"dark" | "light">("light");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("elitehub-theme");
      const selected = stored === "dark" || stored === "light" ? stored : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      setTheme(selected);
      document.documentElement.dataset.theme = selected;
    } catch {
      document.documentElement.dataset.theme = "light";
    }
  }, []);

  useEffect(() => {
    if (deferred.length < 2) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void requisicao<{ items: Array<{ id: string; label: string }> }>(`/api/v1/catalog/search-suggestions?q=${encodeURIComponent(deferred)}`)
        .then((result) => { if (active) setSuggestions(result.items); })
        .catch(() => { if (active) setSuggestions([]); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [deferred]);

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim();
    setSuggestions([]);
    navigate(value ? `/catalogo?busca=${encodeURIComponent(value)}` : "/catalogo");
  };
  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("elitehub-theme", next); } catch { return; }
  };

  const home = location.pathname === "/";
  const catalogue = location.pathname === "/catalogo";
  return <header className="site-header">
    <div className="site-header__main">
      <Link className="brand" to="/" aria-label="EliteHub Connect, início">EliteHub <span>Connect</span></Link>
      <form className="search" role="search" onSubmit={search}>
        <label className="sr-only" htmlFor="product-search-react">Buscar produtos</label>
        <Icon name="search" />
        <input id="product-search-react" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busque produtos, marcas e categorias" autoComplete="off" aria-autocomplete="list" aria-controls="search-suggestions-react" aria-expanded={suggestions.length > 0} />
        <button className="search__submit" type="submit">Buscar</button>
        <AnimatePresence>{suggestions.length > 0 ? <motion.ul id="search-suggestions-react" className="search-suggestions" role="listbox" initial={reduced ? false : { opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.16 }}>
          {suggestions.map((item) => <li key={item.id}><Link to={`/produto/${item.id}`} role="option" onClick={() => setSuggestions([])}>{item.label}</Link></li>)}
        </motion.ul> : null}</AnimatePresence>
      </form>
      <div className="header-actions" aria-label="Ações da conta">
        <Link className="header-location desktop-only" to="/ajuda#entregas" title="Informações de entrega"><Icon name="location" /><span>Entrega segura<br /><strong>consulte no checkout</strong></span></Link>
        <button className="icon-button" type="button" onClick={() => abrirRotaProtegida("/favoritos", "Entre para acessar seus favoritos.")} aria-label="Favoritos" title="Favoritos"><Icon name="heart" /></button>
        <button className="icon-button desktop-only" type="button" onClick={() => abrirRotaProtegida("/notificacoes", "Entre para acessar suas notificações.")} aria-label="Notificações" title="Notificações"><Icon name="bell" /></button>
        <button className="icon-button" type="button" onClick={() => abrirRotaProtegida("/carrinho", "Entre para acessar seu carrinho.")} aria-label="Carrinho" title="Carrinho"><Icon name="cart" /></button>
        <div className="account-menu-wrap">
          <button className="account-button" type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((current) => !current)}>
            <span className="account-avatar">{user ? firstName(user.fullName).slice(0, 2).toUpperCase() : <Icon name="user" />}</span><span className="desktop-only">{user ? firstName(user.fullName) : "Conta"}</span>
          </button>
          <AnimatePresence>{menu ? <motion.div className="account-menu" role="menu" initial={reduced ? false : { opacity: 0, y: -7, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.96 }} transition={{ type: "spring", stiffness: 410, damping: 31 }}>
            {user ? <>
              <div className="account-menu__head"><strong>{user.fullName}</strong><span>{user.email}</span></div>
              <Link to="/conta" role="menuitem" onClick={() => setMenu(false)}>Minha conta</Link>
              <Link to="/pedidos" role="menuitem" onClick={() => setMenu(false)}>Meus pedidos</Link>
              <Link to="/favoritos" role="menuitem" onClick={() => setMenu(false)}>Favoritos</Link>
              {user.roles.includes("SELLER") ? <Link to="/vendedor" role="menuitem" onClick={() => setMenu(false)}>Área do vendedor</Link> : null}
              {user.roles.includes("ADMIN") ? <Link to="/admin" role="menuitem" onClick={() => setMenu(false)}>Administração</Link> : null}
              <button className="menu-danger" type="button" role="menuitem" onClick={() => void sair()}>Sair</button>
            </> : <>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); abrirAutenticacao("Entre para acessar sua conta.", undefined, "login"); }}>Entrar</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); abrirAutenticacao("Crie sua conta para comprar com segurança.", undefined, "register"); }}>Criar conta</button>
            </>}
          </motion.div> : null}</AnimatePresence>
        </div>
        <button className="icon-button mobile-only" type="button" aria-controls="market-nav-react" aria-expanded={mobile} aria-label="Abrir menu" onClick={() => setMobile((current) => !current)}><Icon name="menu" /></button>
      </div>
    </div>
    <nav id="market-nav-react" className={`market-nav ${mobile ? "is-open" : ""}`} aria-label="Navegação do marketplace">
      <Link to="/" data-active={home}>Início</Link><Link to="/catalogo" data-active={catalogue}>Explorar catálogo</Link><Link to="/ajuda">Ajuda</Link>
      <button className="nav-utility" type="button" onClick={toggleTheme}>{theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}</button>
    </nav>
  </header>;
}

function Rodape(): ReactNode {
  return <footer className="site-footer"><Link className="brand" to="/">EliteHub <span>Connect</span></Link><p>Explore livremente. Entre apenas quando quiser salvar, comprar ou acompanhar um pedido.</p><nav aria-label="Links institucionais"><Link to="/ajuda">Ajuda</Link><a href="/static/legal.html#termos">Termos</a><a href="/static/legal.html#privacidade">Privacidade</a></nav></footer>;
}

function ModalAutenticacao({ close, onAuthenticated, state }: { close: () => void; onAuthenticated: () => Promise<void>; state: EstadoAutenticacao }): ReactNode {
  const { providers } = useMercado();
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<ModoAutenticacao>(state.modo);
  const [status, setStatus] = useState(state.mensagem);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setMode(state.modo); setStatus(state.mensagem); }, [state]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.body.classList.add("auth-modal-open");
    ref.current?.focus({ preventScroll: true });
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.classList.remove("auth-modal-open"); window.removeEventListener("keydown", onKeyDown); };
  }, [close]);

  const descriptor: Record<ModoAutenticacao, { prompt: string; switchMode: ModoAutenticacao; switchText: string; subtitle: string; title: string }> = {
    welcome: { prompt: "Já possui uma conta?", switchMode: "login", switchText: "Entrar", subtitle: "Explore uma experiência de compra criada para ser simples e segura.", title: "Bem-vindo à EliteHub" },
    login: { prompt: "Ainda não possui uma conta?", switchMode: "register", switchText: "Criar conta", subtitle: "Entre para acessar sua conta e continuar com segurança.", title: "Entrar" },
    register: { prompt: "Já possui uma conta?", switchMode: "login", switchText: "Entrar", subtitle: "Crie sua conta para começar a usar a EliteHub.", title: "Criar conta" },
    recovery: { prompt: "Lembrou sua senha?", switchMode: "login", switchText: "Voltar para entrar", subtitle: "Informe seu e-mail para recuperar o acesso à EliteHub.", title: "Recuperar senha" },
    reset: { prompt: "Já definiu sua senha?", switchMode: "login", switchText: "Voltar para entrar", subtitle: "Escolha uma nova senha forte para sua conta.", title: "Defina uma nova senha" },
  };
  const current = descriptor[mode];
  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setLoading(true); setStatus("");
    try {
      await requisicao("/api/v1/auth/login", { body: JSON.stringify({ email: String(data.get("email") ?? ""), password: String(data.get("password") ?? ""), rememberMe: data.get("rememberMe") === "on" }), method: "POST" });
      await onAuthenticated();
    } catch (error) { setStatus(mensagemPublica(error)); } finally { setLoading(false); }
  };
  const submitRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (!strongPassword(password)) { setStatus("Sua senha precisa ter ao menos 12 caracteres, maiúscula, minúscula e número."); return; }
    setLoading(true); setStatus("");
    try {
      const result = await requisicao<{ message: string }>("/api/v1/auth/register", { body: JSON.stringify({ email: String(data.get("email") ?? ""), fullName: String(data.get("fullName") ?? ""), password, passwordConfirmation: password }), method: "POST" });
      setMode("login"); setStatus(result.message);
    } catch (error) { setStatus(mensagemPublica(error)); } finally { setLoading(false); }
  };
  const submitRecovery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); setLoading(true); setStatus("");
    try { const result = await requisicao<{ message: string }>("/api/v1/auth/password-recovery", { body: JSON.stringify({ email: String(data.get("email") ?? "") }), method: "POST" }); setStatus(result.message); } catch (error) { setStatus(mensagemPublica(error)); } finally { setLoading(false); }
  };
  const submitReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const password = String(data.get("password") ?? "");
    if (!state.resetToken) { setStatus("Não foi possível validar a solicitação de redefinição."); return; }
    if (!strongPassword(password)) { setStatus("Sua senha precisa ter ao menos 12 caracteres, maiúscula, minúscula e número."); return; }
    setLoading(true); setStatus("");
    try { const result = await requisicao<{ message: string }>("/api/v1/auth/password-reset", { body: JSON.stringify({ password, passwordConfirmation: String(data.get("passwordConfirmation") ?? ""), token: state.resetToken }), method: "POST" }); setMode("login"); setStatus(result.message); } catch (error) { setStatus(mensagemPublica(error)); } finally { setLoading(false); }
  };

  return <motion.div className="auth-overlay" role="presentation" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <motion.div ref={ref} className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title-react" tabIndex={-1} initial={reduced ? false : { opacity: 0, scale: 0.92, y: 22 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }} transition={{ type: "spring", stiffness: 330, damping: 28 }}>
      <button className="dialog-close" type="button" aria-label="Fechar autenticação" onClick={close}><Icon name="close" /></button>
      <div className="auth-card" data-auth-mode={mode}>
        <div className="auth-illustration" aria-hidden="true"><img className="auth-illustration__person" src="/static/assets/avatar-login-elitehub.png" alt="" /><span className="auth-illustration__badge">+</span></div>
        {status ? <motion.div className="status auth-status-react" data-kind="info" role="status" aria-live="polite" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>{status}</motion.div> : null}
        <div className="auth-card__heading"><h2 id="auth-title-react">{current.title}</h2><p>{current.subtitle}</p></div>
        <AnimatePresence mode="wait">
          {mode === "welcome" ? <motion.section key="welcome" className="auth-welcome" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}><button className="button button--primary" type="button" onClick={() => setMode("register")}>Começar</button></motion.section> : null}
          {mode === "login" ? <motion.form key="login" className="form-stack" noValidate onSubmit={submitLogin} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}><label className="field-group"><span>E-mail</span><input name="email" type="email" placeholder="Digite seu e-mail" autoComplete="email" required /></label><label className="field-group"><span>Senha</span><span className="password-input"><input name="password" type={showPassword ? "text" : "password"} placeholder="Digite sua senha" autoComplete="current-password" required /><button className="input-action" type="button" onClick={() => setShowPassword((current) => !current)}>{showPassword ? "Ocultar" : "Mostrar"}</button></span></label><div className="form-row form-row--between"><label className="checkbox-row"><input name="rememberMe" type="checkbox" /><span>Lembrar de mim</span></label><button className="text-button" type="button" onClick={() => setMode("recovery")}>Esqueci minha senha</button></div><button className="button button--primary" type="submit" disabled={loading}>{loading ? "Entrando" : "Entrar"}</button></motion.form> : null}
          {mode === "register" ? <motion.form key="register" className="form-stack" noValidate onSubmit={submitRegister} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}><label className="field-group"><span>Nome completo</span><input name="fullName" type="text" placeholder="Digite seu nome" autoComplete="name" required /></label><label className="field-group"><span>E-mail</span><input name="email" type="email" placeholder="Digite seu e-mail" autoComplete="email" required /></label><label className="field-group"><span>Senha</span><span className="password-input"><input name="password" type={showPassword ? "text" : "password"} placeholder="Crie uma senha" autoComplete="new-password" required /><button className="input-action" type="button" onClick={() => setShowPassword((current) => !current)}>{showPassword ? "Ocultar" : "Mostrar"}</button></span><span className="hint">Ao menos 12 caracteres, com maiúscula, minúscula e número.</span></label><button className="button button--primary" type="submit" disabled={loading}>{loading ? "Criando" : "Criar conta"}</button><p className="legal-copy">Ao criar a conta, você aceita os <a href="/static/legal.html#termos">Termos de Uso</a> e a <a href="/static/legal.html#privacidade">Política de Privacidade</a>.</p></motion.form> : null}
          {mode === "recovery" ? <motion.form key="recovery" className="form-stack" noValidate onSubmit={submitRecovery} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}><label className="field-group"><span>E-mail</span><input name="email" type="email" placeholder="Digite seu e-mail" autoComplete="email" required /></label><button className="button button--primary" type="submit" disabled={loading}>{loading ? "Enviando" : "Enviar instruções"}</button></motion.form> : null}
          {mode === "reset" ? <motion.form key="reset" className="form-stack" noValidate onSubmit={submitReset} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}><label className="field-group"><span>Nova senha</span><span className="password-input"><input name="password" type={showPassword ? "text" : "password"} placeholder="Crie uma nova senha" autoComplete="new-password" required /><button className="input-action" type="button" onClick={() => setShowPassword((current) => !current)}>{showPassword ? "Ocultar" : "Mostrar"}</button></span></label><label className="field-group"><span>Confirme a nova senha</span><input name="passwordConfirmation" type={showPassword ? "text" : "password"} placeholder="Digite novamente" autoComplete="new-password" required /></label><button className="button button--primary" type="submit" disabled={loading}>{loading ? "Salvando" : "Salvar nova senha"}</button></motion.form> : null}
        </AnimatePresence>
        {["welcome", "login", "register"].includes(mode) ? <div className="google-section"><div className="auth-divider" aria-hidden="true"><span>ou</span></div><div className="auth-provider-list"><button className="button button--provider" type="button" disabled={!providers.google} title={providers.google ? "" : "O login com Google ainda não está configurado."} onClick={() => { if (providers.google) window.location.assign("/api/v1/auth/google"); }}><GoogleMark /><span>Continuar com Google</span></button><button className="button button--provider" type="button" disabled={!providers.microsoft} title="O login com Microsoft ainda não está configurado."><MicrosoftMark /><span>Continuar com Microsoft</span></button></div></div> : null}
        <div className="auth-switch"><span>{current.prompt}</span><button className="text-button" type="button" onClick={() => { setStatus(""); setMode(current.switchMode); }}>{current.switchText}</button></div>
      </div>
    </motion.div>
  </motion.div>;
}

function Carregando({ label = "Carregando" }: { label?: string }): ReactNode {
  return <div className="route-loading" role="status" aria-live="polite"><span className="route-loading__dot" />{label}…</div>;
}

function EstadoVazio({ action, description, title }: { action?: ReactNode; description: string; title: string }): ReactNode {
  return <section className="empty-state"><h2>{title}</h2><p>{description}</p>{action}</section>;
}

function CartaoProduto({ product }: { product: ProdutoResumo }): ReactNode {
  const { favoritos, toggleFavorito } = useMercado();
  const favorite = favoritos.has(product.id);
  return <motion.article layout="position" className="product-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 360, damping: 30 }}>
    <motion.button className="icon-button card-favorite" type="button" aria-label={favorite ? "Remover dos favoritos" : "Salvar nos favoritos"} aria-pressed={favorite} title={favorite ? "Remover dos favoritos" : "Salvar nos favoritos"} onClick={() => void toggleFavorito(product.id)} whileTap={{ scale: 0.92 }}><Icon name="heart" /></motion.button>
    <Link className="product-card__link" to={`/produto/${product.id}`} aria-label={`Ver detalhes de ${product.title}`}><div className="product-card__image">{product.imageUrl ? <img src={product.imageUrl} alt={product.title} loading="lazy" /> : "Imagem indisponível"}</div><div className="product-card__content"><h3 className="product-card__title">{product.title}</h3><p className="product-card__price">{currency(product.priceCents)}</p><p className="product-card__meta">{product.category?.name ?? "Sem categoria"}</p>{rating(product.rating) ? <p className="product-card__rating" aria-label={`Avaliação média: ${rating(product.rating)}`}>{rating(product.rating)}</p> : null}</div></Link>
    <Link className="product-card__seller" to={`/loja/${product.seller.id}`}>{product.seller.name}</Link><p className={`stock ${product.availability === "OUT_OF_STOCK" ? "stock--unavailable" : "stock--available"}`}>{availability(product.availability)}</p>
  </motion.article>;
}

function Catalogo(): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<ProdutoResumo[]>([]);
  const [page, setPage] = useState<Paginacao | null>(null);
  const [category, setCategory] = useState<string | undefined>();
  const [sort, setSort] = useState("newest");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const term = new URLSearchParams(location.search).get("busca")?.trim() ?? "";

  useEffect(() => { document.title = "EliteHub Connect | Marketplace"; }, []);
  useEffect(() => { void requisicao<{ items: Array<{ id: string; name: string }> }>("/api/v1/catalog/categories").then((result) => setCategories(result.items)).catch(() => setCategories([])); }, []);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const params = new URLSearchParams({ limit: "12", offset: String(offset), sort });
    if (term) params.set("q", term);
    if (category) params.set("category", category);
    if (minimum) params.set("minPriceCents", String(Math.round(Number(minimum) * 100)));
    if (maximum) params.set("maxPriceCents", String(Math.round(Number(maximum) * 100)));
    try {
      const result = await requisicao<{ items: ProdutoResumo[]; page: Paginacao }>(`/api/v1/catalog/products?${params}`);
      setItems(result.items); setPage(result.page);
    } catch (failure) { setError(mensagemPublica(failure)); } finally { setLoading(false); }
  }, [category, maximum, minimum, offset, sort, term]);
  useEffect(() => { void load(); }, [load]);
  const chooseCategory = (value: string | undefined) => { setCategory(value); setOffset(0); };
  const apply = () => { setOffset(0); void load(); };
  const clear = () => { setCategory(undefined); setSort("newest"); setMinimum(""); setMaximum(""); setOffset(0); navigate("/catalogo"); };

  return <motion.div className="catalog-page-react" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
    <section className="hero" aria-labelledby="hero-title"><div className="hero__copy"><p className="eyebrow eyebrow--accent">Marketplace EliteHub</p><h1 id="hero-title">Descubra produtos de lojas que você pode conhecer.</h1><p>Pesquise, compare e visite lojas livremente. O acesso é solicitado apenas no momento da compra.</p><Link className="button button--primary" to="/catalogo">Explorar produtos <Icon name="arrow" /></Link></div><div className="hero__trust" aria-label="Princípios de compra"><div><span>✓</span>Catálogo aberto</div><div><span>✓</span>Compra com sessão protegida</div><div><span>✓</span>Pagamento validado no servidor</div></div></section>
    <section className="category-section" aria-labelledby="categories-title"><div className="section-heading"><div><p className="eyebrow">Navegue por interesse</p><h2 id="categories-title">Categorias</h2></div></div><LayoutGroup><div className="category-list" aria-label="Categorias do catálogo"><button className="category-chip" type="button" aria-pressed={!category} onClick={() => chooseCategory(undefined)}>Todas</button>{categories.map((item) => <button className="category-chip" type="button" key={item.id} aria-pressed={category === item.id} onClick={() => chooseCategory(item.id)}>{item.name}</button>)}</div></LayoutGroup></section>
    <section className="catalog-layout" aria-labelledby="catalog-title"><aside className="catalog-filters" aria-labelledby="filters-title"><div className="filter-heading"><h2 id="filters-title">Filtrar</h2><button className="text-button" type="button" onClick={clear}>Limpar</button></div><label className="field-group"><span>Ordenar por</span><select value={sort} onChange={(event) => { setSort(event.target.value); setOffset(0); }}><option value="newest">Mais recentes</option><option value="relevance">Mais relevantes</option><option value="price_asc">Menor preço</option><option value="price_desc">Maior preço</option></select></label><fieldset className="price-filter"><legend>Faixa de preço</legend><label>Mínimo<input inputMode="numeric" type="number" min="0" step="1" value={minimum} onChange={(event) => setMinimum(event.target.value)} placeholder="R$ 0" /></label><label>Máximo<input inputMode="numeric" type="number" min="0" step="1" value={maximum} onChange={(event) => setMaximum(event.target.value)} placeholder="Sem limite" /></label><button className="button button--secondary" type="button" onClick={apply}>Aplicar filtros</button></fieldset></aside><div className="catalog-content"><div className="catalog-toolbar"><div><p className="eyebrow">Catálogo público</p><h2 id="catalog-title">{term ? `Resultados para “${term}”` : "Produtos para explorar"}</h2><p className="catalog-summary">{page ? `${page.total} ${page.total === 1 ? "produto encontrado" : "produtos encontrados"}` : "Carregando catálogo…"}</p></div><button className="icon-text-button" type="button" onClick={() => void load()}>Atualizar</button></div>{loading ? <GradeEsqueleto /> : error ? <EstadoVazio title="Não foi possível carregar o catálogo" description={error} action={<button className="button button--primary" type="button" onClick={() => void load()}>Tentar novamente</button>} /> : items.length ? <motion.section className="product-grid" aria-live="polite" aria-busy={loading} layout>{items.map((product) => <CartaoProduto key={product.id} product={product} />)}</motion.section> : <EstadoVazio title="Nenhum produto encontrado" description="Tente remover filtros ou pesquisar outro termo." />}{page && page.total > page.limit ? <nav className="pagination" aria-label="Paginação"><button type="button" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - page.limit))}>Anterior</button><span>Página {Math.floor(offset / page.limit) + 1}</span><button type="button" disabled={!page.hasNext} onClick={() => setOffset((value) => value + page.limit)}>Próxima</button></nav> : null}</div></section>
  </motion.div>;
}

function GradeEsqueleto(): ReactNode {
  return <section className="product-grid" aria-label="Carregando produtos" aria-busy="true">{Array.from({ length: 8 }, (_, index) => <article className="product-card product-card--skeleton" key={index}><div className="skeleton-image" /><div className="skeleton-line" /><div className="skeleton-line skeleton-line--short" /></article>)}</section>;
}

function ProdutoDetalhe(): ReactNode {
  const { id } = useParams();
  const { adicionarAoCarrinho, favoritos, publicarAviso, toggleFavorito } = useMercado();
  const [product, setProduct] = useState<Produto | null>(null);
  const [reviews, setReviews] = useState<Array<{ authorName: string; createdAt: string; id: string; rating: number; text: string; title: string }>>([]);
  const [related, setRelated] = useState<ProdutoResumo[]>([]);
  const [selectedImage, setSelectedImage] = useState(0);
  const [variantId, setVariantId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    void (async () => {
      setProduct(null); setReviews([]); setRelated([]); setError(null); setSelectedImage(0); setVariantId(undefined);
      try {
        const response = await requisicao<{ product: Produto }>(`/api/v1/catalog/products/${id}`);
        if (!active) return;
        setProduct(response.product);
        document.title = `${response.product.title} | EliteHub Connect`;
        const [reviewResponse, relatedResponse] = await Promise.all([
          requisicao<{ items: Array<{ authorName: string; createdAt: string; id: string; rating: number; text: string; title: string }> }>(`/api/v1/products/${id}/reviews?limit=5`).catch(() => ({ items: [] })),
          response.product.category?.id ? requisicao<{ items: ProdutoResumo[] }>(`/api/v1/catalog/products?category=${response.product.category.id}&limit=4`).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        ]);
        if (active) { setReviews(reviewResponse.items); setRelated(relatedResponse.items.filter((item) => item.id !== response.product.id)); }
      } catch (failure) { if (active) setError(mensagemPublica(failure)); }
    })();
    return () => { active = false; };
  }, [id]);
  if (!id) return <Navigate to="/catalogo" replace />;
  if (error) return <EstadoVazio title="Produto indisponível" description={error} action={<Link className="button button--primary" to="/catalogo">Voltar ao catálogo</Link>} />;
  if (!product) return <Carregando label="Carregando produto" />;
  const images = [...new Set([product.imageUrl, ...product.images.map((image) => image.url)].filter((image): image is string => Boolean(image)))];
  const variant = product.variants.find((item) => item.id === variantId);
  const selectedAvailability = variant?.availability ?? product.availability;
  const selectedPrice = variant?.priceCents ?? product.priceCents;
  const unavailable = selectedAvailability === "OUT_OF_STOCK";
  const sharing = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ text: `Confira ${product.title} na EliteHub Connect.`, title: product.title, url });
      else if (navigator.clipboard) { await navigator.clipboard.writeText(url); publicarAviso("Link do produto copiado.", "success"); }
      else publicarAviso("Não foi possível compartilhar neste navegador.");
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError") return;
      publicarAviso("Não foi possível compartilhar o produto.");
    }
  };
  return <motion.div className="detail-page-react" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 310, damping: 31 }}>
    <Link className="back-link" to="/catalogo">Voltar ao catálogo</Link>
    <section className="detail-layout"><div className="product-gallery"><div className="product-gallery__main"><AnimatePresence mode="wait">{images[selectedImage] ? <motion.img key={images[selectedImage]} src={images[selectedImage]} alt={product.title} initial={{ opacity: 0, scale: 1.025 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.985 }} transition={{ duration: 0.2 }} /> : <span className="product-gallery__fallback">Imagem indisponível</span>}</AnimatePresence></div>{images.length > 1 ? <div className="gallery-thumbs">{images.map((image, index) => <button key={image} type="button" aria-label={`Ver imagem ${index + 1}`} aria-pressed={index === selectedImage} onClick={() => setSelectedImage(index)}><img src={image} alt={`${product.title} - imagem ${index + 1}`} /></button>)}</div> : null}</div>
      <div className="product-info"><p className="eyebrow">{product.category?.name ?? "Produto"}</p><h1>{product.title}</h1><p className="product-info__price">{currency(selectedPrice)}</p>{rating(product.rating) ? <p className="rating-summary">{rating(product.rating)}</p> : null}<p className={`stock ${unavailable ? "stock--unavailable" : "stock--available"}`}>{availability(selectedAvailability)}</p><Link className="product-info__seller" to={`/loja/${product.seller.id}`}>Vendido por {product.seller.name}</Link><p className="product-info__description">{product.description}</p>{product.variants.length ? <div><p className="eyebrow">Variações</p><div className="variant-list">{product.variants.map((item) => <button key={item.id} type="button" aria-pressed={variantId === item.id} onClick={() => setVariantId(item.id)}>{Object.values(item.attributes).map(String).join(" · ") || "Variação"}</button>)}</div></div> : null}<div className="product-actions"><button className="button button--secondary" type="button" disabled={unavailable} onClick={() => void adicionarAoCarrinho(product.id, variantId, "/carrinho")}>Adicionar ao carrinho</button><button className="button button--primary" type="button" disabled={unavailable} onClick={() => void adicionarAoCarrinho(product.id, variantId, "/checkout")}>Comprar agora</button></div><div className="product-utility"><button className="button button--secondary" type="button" onClick={() => void toggleFavorito(product.id)}>{favoritos.has(product.id) ? "Remover dos favoritos" : "Salvar nos favoritos"}</button><button className="button button--secondary" type="button" onClick={() => void sharing()}><Icon name="share" />Compartilhar</button></div>{Object.keys(product.attributes).length ? <section className="info-panel"><h2>Detalhes do produto</h2><dl>{Object.entries(product.attributes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd></div>)}</dl></section> : null}</div>
    </section>
    {reviews.length ? <section className="review-section" aria-labelledby="reviews-title-react"><p className="eyebrow">{rating(product.rating)}</p><h2 id="reviews-title-react">Avaliações de compradores</h2><div className="review-list">{reviews.map((review) => <motion.article className="review-card" key={review.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><p className="review-card__rating">★ {review.rating}/5</p><h3>{review.title}</h3><p>{review.text}</p><p className="review-card__meta">{review.authorName} · {date(review.createdAt)} · Compra verificada</p></motion.article>)}</div></section> : null}
    {related.length ? <section className="category-section"><p className="eyebrow">Mais desta categoria</p><h2>Produtos relacionados</h2><div className="product-grid">{related.map((item) => <CartaoProduto product={item} key={item.id} />)}</div></section> : null}
  </motion.div>;
}

function LojaPublica(): ReactNode {
  const { id } = useParams();
  const [seller, setSeller] = useState<{ description: string | null; id: string; productCount: number; rating: ProdutoResumo["rating"]; storeName: string } | null>(null);
  const [products, setProducts] = useState<ProdutoResumo[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    void (async () => {
      setSeller(null); setError(null);
      try {
        const result = await requisicao<{ seller: { description: string | null; id: string; productCount: number; rating: ProdutoResumo["rating"]; storeName: string } }>(`/api/v1/sellers/${id}`);
        const catalog = await requisicao<{ items: ProdutoResumo[] }>(`/api/v1/catalog/products?seller=${result.seller.id}&limit=12`);
        if (active) { setSeller(result.seller); setProducts(catalog.items); document.title = `${result.seller.storeName} | EliteHub Connect`; }
      } catch (failure) { if (active) setError(mensagemPublica(failure)); }
    })();
    return () => { active = false; };
  }, [id]);
  if (!id) return <Navigate to="/catalogo" replace />;
  if (error) return <EstadoVazio title="Loja indisponível" description={error} action={<Link className="button button--primary" to="/catalogo">Voltar ao catálogo</Link>} />;
  if (!seller) return <Carregando label="Carregando loja" />;
  return <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><Link className="back-link" to="/catalogo">Voltar ao catálogo</Link><section className="store-header"><p className="eyebrow">Loja verificada</p><h1>{seller.storeName}</h1>{rating(seller.rating) ? <p className="store-header__rating">{rating(seller.rating)}</p> : null}<p>{seller.description ?? "Esta loja não informou uma descrição pública."}</p></section><section className="category-section"><p className="eyebrow">{seller.productCount} produtos ativos</p><h2>Produtos desta loja</h2>{products.length ? <div className="product-grid">{products.map((product) => <CartaoProduto product={product} key={product.id} />)}</div> : <EstadoVazio title="Sem produtos ativos" description="Esta loja não possui produtos disponíveis no momento." />}</section></motion.div>;
}

function AreaProtegida({ children, message }: PropsWithChildren<{ message: string }>): ReactNode {
  const { abrirRotaProtegida, sessaoVerificada, user } = useMercado();
  const location = useLocation();
  if (!sessaoVerificada) return <Carregando label="Verificando sessão" />;
  return <ConteudoProtegido authenticated={Boolean(user)} destination={`${location.pathname}${location.search}`} fallback={<Carregando label="Aguardando autenticação" />} message={message} onRequireAuthentication={abrirRotaProtegida}>{children}</ConteudoProtegido>;
}

function PainelPrivado({ children, description, title }: PropsWithChildren<{ description: string; title: string }>): ReactNode {
  return <motion.section className="account-panel" initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 320, damping: 30 }}><Link className="back-link" to="/catalogo">Voltar ao catálogo</Link><h1>{title}</h1><p>{description}</p>{children}</motion.section>;
}

/* Implementações migradas para os módulos de carrinho e checkout.
function CarrinhoPageLegado(): ReactNode {
  const [cart, setCart] = useState<Carrinho | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setError(null); const result = await requisicao<{ cart: Carrinho }>("/api/v1/cart"); setCart(result.cart); } catch (failure) { setError(mensagemPublica(failure)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const remove = async (id: string) => { try { setCart(await removerItem(requisicao, id)); } catch (failure) { setError(mensagemPublica(failure)); } };
  const setQuantity = async (item: Carrinho["items"][number], quantity: number) => {
    if (quantity < 1) { await remove(item.id); return; }
    try {
      setCart(await definirQuantidade(requisicao, item, quantity));
    } catch (failure) { setError(mensagemPublica(failure)); }
  };
  return <AreaProtegida message="Entre para acessar seu carrinho."><PainelPrivado title="Meu carrinho" description="Seus itens são vinculados à sua sessão segura.">{error ? <EstadoVazio title="Não foi possível carregar o carrinho" description={error} /> : !cart ? <Carregando /> : !cart.items.length ? <EstadoVazio title="Seu carrinho está vazio" description="Explore o catálogo para adicionar produtos." action={<Link className="button button--primary" to="/catalogo">Explorar catálogo</Link>} /> : <><div className="cart-list">{cart.items.map((item) => <motion.article className="cart-item" key={item.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -16 }}><>{item.imageUrl ? <img src={item.imageUrl} alt={item.product.title} /> : <div className="product-card__image">Sem imagem</div>}</><div><h2>{item.product.title}</h2><div className="quantity-control-react" aria-label={`Quantidade de ${item.product.title}`}><button type="button" onClick={() => void setQuantity(item, item.quantity - 1)} aria-label="Diminuir quantidade">−</button><output>{item.quantity}</output><button type="button" disabled={item.quantity >= item.stockQuantity} onClick={() => void setQuantity(item, item.quantity + 1)} aria-label="Aumentar quantidade">+</button></div>{item.variant ? <p>Variação: {Object.values(item.variant.attributes).map(String).join(" · ")}</p> : null}</div><div><p className="cart-item__price">{currency(item.unitPriceCents * item.quantity)}</p><button className="text-button" type="button" onClick={() => void remove(item.id)}>Remover</button></div></motion.article>)}</div><div className="cart-summary"><div><span>Subtotal</span><strong>{currency(cart.subtotalCents)}</strong></div><Link className="button button--primary" to="/checkout">Continuar compra</Link></div></>}</PainelPrivado></AreaProtegida>;
}

function addressText(item: Endereco): string {
  return `${item.street}, ${item.number}${item.complement ? ` - ${item.complement}` : ""}, ${item.neighborhood}, ${item.city}/${item.state}`;
}

function FormEndereco({ saved }: { saved: () => Promise<void> }): ReactNode {
  const { publicarAviso } = useMercado();
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); setLoading(true);
    try {
      await requisicao("/api/v1/addresses", { body: JSON.stringify({ city: String(data.get("city") ?? ""), complement: String(data.get("complement") ?? "") || undefined, label: String(data.get("label") ?? ""), neighborhood: String(data.get("neighborhood") ?? ""), number: String(data.get("number") ?? ""), postalCode: String(data.get("postalCode") ?? "").replace(/\D/g, ""), recipientName: String(data.get("recipientName") ?? ""), state: String(data.get("state") ?? "").toUpperCase(), street: String(data.get("street") ?? "") }), method: "POST" });
      publicarAviso("Endereço salvo.", "success"); await saved();
    } catch (failure) { publicarAviso(mensagemPublica(failure)); } finally { setLoading(false); }
  };
  return <form className="form-stack address-form-react" onSubmit={submit}><label className="field-group"><span>Identificação</span><input name="label" placeholder="Casa" required /></label><label className="field-group"><span>Destinatário</span><input name="recipientName" placeholder="Nome completo" required /></label><label className="field-group"><span>CEP</span><input name="postalCode" inputMode="numeric" placeholder="Somente números" required /></label><label className="field-group"><span>Rua</span><input name="street" required /></label><label className="field-group"><span>Número</span><input name="number" required /></label><label className="field-group"><span>Complemento</span><input name="complement" /></label><label className="field-group"><span>Bairro</span><input name="neighborhood" required /></label><label className="field-group"><span>Cidade</span><input name="city" required /></label><label className="field-group"><span>UF</span><input name="state" maxLength={2} placeholder="SP" required /></label><button className="button button--secondary" type="submit" disabled={loading}>{loading ? "Salvando" : "Salvar endereço"}</button></form>;
}

function CheckoutPageLegado(): ReactNode {
  const { publicarAviso } = useMercado();
  const navigate = useNavigate();
  const [cart, setCart] = useState<Carrinho | null>(null);
  const [addresses, setAddresses] = useState<Endereco[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string | undefined>();
  const [payment, setPayment] = useState<"BOLETO" | "CREDIT_CARD" | "PIX">("PIX");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { const [cartResult, addressResult] = await Promise.all([requisicao<{ cart: Carrinho }>("/api/v1/cart"), requisicao<{ items: Endereco[] }>("/api/v1/addresses")]); setCart(cartResult.cart); setAddresses(addressResult.items); setSelectedAddress(addressResult.items[0]?.id); } catch (failure) { publicarAviso(mensagemPublica(failure)); } finally { setLoading(false); } }, [publicarAviso]);
  useEffect(() => { void load(); }, [load]);
  const createOrder = async () => {
    if (!selectedAddress || !checkoutDisponivel(cart, selectedAddress)) { publicarAviso("Selecione um endereço e mantenha itens no carrinho para continuar."); return; }
    try {
      const result = await enviarCheckout(requisicao, { addressId: selectedAddress, paymentMethod: payment }, crypto.randomUUID());
      publicarAviso(result.payment.integrationPending ? "Pedido criado e estoque reservado. Nenhuma cobrança foi realizada: o pagamento local ainda não está integrado." : "Pedido criado. Siga as instruções do provedor de pagamento.", "success");
      navigate("/pedidos");
    } catch (failure) { publicarAviso(mensagemPublica(failure)); }
  };
  return <AreaProtegida message="Entre para continuar sua compra com segurança."><PainelPrivado title="Finalizar compra" description="Confirme o endereço e escolha o meio de pagamento disponível.">{loading ? <Carregando /> : !cart?.items.length ? <EstadoVazio title="Seu carrinho está vazio" description="Adicione produtos antes de finalizar a compra." action={<Link className="button button--primary" to="/catalogo">Ver catálogo</Link>} /> : <div className="checkout-grid"><section className="cart-panel"><h2>Endereço de entrega</h2>{addresses.length ? <div className="address-list">{addresses.map((address) => <label className="address-choice" key={address.id}><input type="radio" name="address" checked={selectedAddress === address.id} onChange={() => setSelectedAddress(address.id)} /><span><strong>{address.label}</strong>{addressText(address)}</span></label>)}</div> : <><p>Cadastre um endereço para continuar.</p><FormEndereco saved={load} /></>}</section>{addresses.length ? <section className="cart-panel"><h2>Pagamento</h2><p>A confirmação é feita pelo provedor configurado no servidor.</p><div className="payment-options">{(["PIX", "CREDIT_CARD", "BOLETO"] as const).map((method) => <label key={method}><input type="radio" name="payment" checked={payment === method} onChange={() => setPayment(method)} /><span>{method === "PIX" ? "Pix" : method === "CREDIT_CARD" ? "Cartão" : "Boleto"}</span></label>)}</div><div className="cart-summary"><div><span>Subtotal</span><strong>{currency(cart.subtotalCents)}</strong></div><button className="button button--primary" type="button" onClick={() => void createOrder()}>Criar pedido</button></div></section> : null}</div>}</PainelPrivado></AreaProtegida>;
}

*/

function FavoritosPage(): ReactNode {
  const [items, setItems] = useState<Array<{ id: string; imageUrl: string | null; priceCents: number; title: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void requisicao<{ items: Array<{ id: string; imageUrl: string | null; priceCents: number; title: string }> }>("/api/v1/favorites").then((result) => setItems(result.items)).catch((failure) => setError(mensagemPublica(failure))); }, []);
  return <AreaProtegida message="Entre para acessar seus favoritos."><PainelPrivado title="Favoritos" description="Produtos salvos para consultar depois.">{error ? <EstadoVazio title="Não foi possível carregar os favoritos" description={error} /> : !items ? <Carregando /> : !items.length ? <EstadoVazio title="Você ainda não salvou produtos" description="Use o ícone de coração em qualquer produto do catálogo." /> : <div className="product-grid">{items.map((item) => <motion.article className="product-card" key={item.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><Link className="product-card__link" to={`/produto/${item.id}`}><div className="product-card__image">{item.imageUrl ? <img src={item.imageUrl} alt={item.title} /> : "Imagem indisponível"}</div><div className="product-card__content"><h2 className="product-card__title">{item.title}</h2><p className="product-card__price">{currency(item.priceCents)}</p></div></Link></motion.article>)}</div>}</PainelPrivado></AreaProtegida>;
}

function NotificacoesPage(): ReactNode {
  const navigate = useNavigate();
  const [items, setItems] = useState<Array<{ body: string; createdAt: string; id: string; linkPath: string | null; readAt: string | null; title: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { const result = await requisicao<{ items: Array<{ body: string; createdAt: string; id: string; linkPath: string | null; readAt: string | null; title: string }> }>("/api/v1/notifications"); setItems(result.items); } catch (failure) { setError(mensagemPublica(failure)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const open = async (item: NonNullable<typeof items>[number]) => { try { if (!item.readAt) await requisicao(`/api/v1/notifications/${item.id}/read`, { method: "PATCH" }); if (item.linkPath) navigate(item.linkPath); else await load(); } catch (failure) { setError(mensagemPublica(failure)); } };
  return <AreaProtegida message="Entre para acessar suas notificações."><PainelPrivado title="Notificações" description="Atualizações relacionadas à sua conta e aos seus pedidos.">{error ? <EstadoVazio title="Não foi possível carregar as notificações" description={error} /> : !items ? <Carregando /> : !items.length ? <EstadoVazio title="Você não tem notificações" description="Quando houver uma atualização relevante, ela aparecerá aqui." /> : <div className="notification-list">{items.map((item) => <motion.button className={`notification-item notification-button-react ${item.readAt ? "" : "notification-item--unread"}`} type="button" key={item.id} onClick={() => void open(item)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><div><h2>{item.title}</h2><p>{item.body}</p></div><time dateTime={item.createdAt}>{date(item.createdAt)}</time></motion.button>)}</div>}</PainelPrivado></AreaProtegida>;
}

function PedidosPage(): ReactNode {
  const { user } = useMercado();
  const [scope, setScope] = useState<"mine" | "received">("mine");
  const [items, setItems] = useState<Array<{ createdAt: string; id: string; number: string; paymentStatus: string; status: string; totalCents: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void requisicao<{ items: Array<{ createdAt: string; id: string; number: string; paymentStatus: string; status: string; totalCents: number }> }>(`/api/v1/orders?scope=${scope}`).then((result) => { setItems(result.items); setError(null); }).catch((failure) => setError(mensagemPublica(failure))); }, [scope]);
  return <AreaProtegida message="Entre para acessar seus pedidos."><PainelPrivado title="Meus pedidos" description="Acompanhe seus pedidos e os respectivos status.">{user?.roles.includes("SELLER") ? <div className="page-tabs" role="tablist"><button type="button" role="tab" aria-selected={scope === "mine"} onClick={() => setScope("mine")}>Minhas compras</button><button type="button" role="tab" aria-selected={scope === "received"} onClick={() => setScope("received")}>Vendas recebidas</button></div> : null}{error ? <EstadoVazio title="Não foi possível carregar os pedidos" description={error} /> : !items ? <Carregando /> : !items.length ? <EstadoVazio title="Você ainda não tem pedidos" description="Quando concluir uma compra, ela aparecerá nesta área." /> : <div className="notification-list">{items.map((item) => <motion.article className="notification-item" key={item.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><div><h2>Pedido {item.number}</h2><p>{currency(item.totalCents)} · {item.status} · pagamento {item.paymentStatus}</p></div><time dateTime={item.createdAt}>{date(item.createdAt)}</time></motion.article>)}</div>}</PainelPrivado></AreaProtegida>;
}

/* Implementações migradas para os módulos de conta, vendedor e administração.
function ContaPageLegado(): ReactNode {
  const { publicarAviso, sair, user } = useMercado();
  const [deleting, setDeleting] = useState(false);
  if (!user) return null;
  const remove = async () => {
    if (!window.confirm("Esta ação anonimiza sua conta e não pode ser desfeita. Deseja continuar?")) return;
    setDeleting(true);
    try { await requisicao("/api/v1/account/deletion", { body: JSON.stringify({ confirm: true }), method: "POST" }); publicarAviso("Sua conta foi anonimizada.", "success"); await sair(); } catch (failure) { publicarAviso(mensagemPublica(failure)); } finally { setDeleting(false); }
  };
  return <AreaProtegida message="Entre para acessar sua conta."><PainelPrivado title="Minha conta" description="Informações da sessão atualmente ativa."><section className="info-panel"><h2>{user.fullName}</h2><p>{user.email}</p><p className={`stock ${user.emailVerified ? "stock--available" : "stock--unavailable"}`}>{user.emailVerified ? "E-mail confirmado" : "E-mail ainda não confirmado"}</p><div className="product-actions"><Link className="button button--secondary" to="/pedidos">Meus pedidos</Link><Link className="button button--secondary" to="/favoritos">Favoritos</Link>{user.roles.includes("SELLER") ? <Link className="button button--secondary" to="/vendedor">Área do vendedor</Link> : null}</div></section><section className="info-panel account-privacy-react"><h2>Privacidade e dados</h2><p>Você pode exportar seus dados pessoais ou solicitar anonimização quando não houver pedidos ativos.</p><div className="product-actions"><a className="button button--secondary" href="/api/v1/account/data-export">Exportar meus dados</a><button className="button button--secondary danger-button-react" type="button" disabled={deleting} onClick={() => void remove()}>{deleting ? "Anonimizando" : "Excluir e anonimizar conta"}</button></div></section></PainelPrivado></AreaProtegida>;
}

function VendedorPageLegado(): ReactNode {
  const { publicarAviso, user } = useMercado();
  const [profile, setProfile] = useState<{ approvalStatus: string; description: string | null; legalName: string | null; storeName: string; supportEmail: string | null } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => { try { const result = await requisicao<{ profile: { approvalStatus: string; description: string | null; legalName: string | null; storeName: string; supportEmail: string | null } }>("/api/v1/seller/profile"); setProfile(result.profile); } catch { setProfile(null); } finally { setLoaded(true); } }, []);
  useEffect(() => { if (user?.roles.includes("SELLER")) void load(); else setLoaded(true); }, [load, user]);
  const onboarding = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); try { const result = await requisicao<{ message: string }>("/api/v1/seller/onboarding", { body: JSON.stringify({ description: String(data.get("description") ?? "") || undefined, legalName: String(data.get("legalName") ?? "") || undefined, storeName: String(data.get("storeName") ?? ""), supportEmail: String(data.get("supportEmail") ?? "") || undefined }), method: "POST" }); publicarAviso(result.message, "success"); await load(); } catch (failure) { publicarAviso(mensagemPublica(failure)); } };
  return <AreaProtegida message="Entre para acessar a área do vendedor."><PainelPrivado title="Área do vendedor" description="Onboarding e situação da sua loja na EliteHub.">{!loaded ? <Carregando /> : profile ? <section className="info-panel"><p className="eyebrow">Situação: {profile.approvalStatus}</p><h2>{profile.storeName}</h2><p>{profile.description ?? "Sem descrição pública cadastrada."}</p><p>{profile.supportEmail ?? "Sem e-mail de suporte cadastrado."}</p>{profile.approvalStatus !== "APPROVED" ? <p className="stock stock--unavailable">A publicação de produtos depende da aprovação administrativa.</p> : <p className="stock stock--available">Sua loja está aprovada. As APIs de produtos e estoque estão disponíveis sob sua sessão.</p>}</section> : <section className="info-panel"><h2>Solicitar conta de vendedor</h2><p>Envie os dados da loja. A aprovação é realizada por um administrador.</p><form className="form-stack" onSubmit={onboarding}><label className="field-group"><span>Nome da loja</span><input name="storeName" minLength={3} required /></label><label className="field-group"><span>Razão social</span><input name="legalName" minLength={3} /></label><label className="field-group"><span>Descrição pública</span><textarea name="description" minLength={20} /></label><label className="field-group"><span>E-mail de suporte</span><input name="supportEmail" type="email" /></label><button className="button button--primary" type="submit">Enviar para aprovação</button></form></section>}</PainelPrivado></AreaProtegida>;
}

function AdministracaoPageLegado(): ReactNode {
  const { publicarAviso, user } = useMercado();
  const [sellers, setSellers] = useState<Array<{ approvalStatus: string; description: string | null; email: string; fullName: string; id: string; storeName: string }>>([]);
  const [reviews, setReviews] = useState<Array<{ buyerName: string; id: string; productTitle: string; rating: number; text: string; title: string }>>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!user?.roles.includes("ADMIN")) { setLoading(false); return; }
    setLoading(true);
    try {
      const [sellerResult, reviewResult] = await Promise.all([
        requisicao<{ items: Array<{ approvalStatus: string; description: string | null; email: string; fullName: string; id: string; storeName: string }> }>("/api/v1/admin/sellers?approvalStatus=PENDING"),
        requisicao<{ items: Array<{ buyerName: string; id: string; productTitle: string; rating: number; text: string; title: string }> }>("/api/v1/admin/reviews?status=PENDING"),
      ]);
      setSellers(sellerResult.items); setReviews(reviewResult.items);
    } catch (failure) { publicarAviso(mensagemPublica(failure)); }
    finally { setLoading(false); }
  }, [publicarAviso, user]);
  useEffect(() => { void load(); }, [load]);
  const atualizarVendedor = async (id: string, status: "APPROVED" | "REJECTED") => {
    try { await requisicao(`/api/v1/admin/sellers/${id}/approval`, { body: JSON.stringify({ status }), method: "POST" }); publicarAviso(status === "APPROVED" ? "Vendedor aprovado." : "Vendedor recusado.", "success"); await load(); } catch (failure) { publicarAviso(mensagemPublica(failure)); }
  };
  const moderarAvaliacao = async (id: string, status: "PUBLISHED" | "HIDDEN" | "REJECTED") => {
    try { await requisicao(`/api/v1/admin/reviews/${id}`, { body: JSON.stringify({ status }), method: "PATCH" }); publicarAviso(status === "PUBLISHED" ? "Avaliação publicada." : "Avaliação moderada.", "success"); await load(); } catch (failure) { publicarAviso(mensagemPublica(failure)); }
  };
  return <AreaProtegida message="Entre para acessar a administração."><PainelPrivado title="Administração" description="Filas reais de aprovação de vendedores e moderação de avaliações.">{!user?.roles.includes("ADMIN") ? <EstadoVazio title="Acesso restrito" description="Esta área exige a função administrativa." /> : loading ? <Carregando /> : <div className="admin-grid-react"><section className="info-panel"><p className="eyebrow">{sellers.length} pendentes</p><h2>Vendedores para análise</h2>{sellers.length ? <div className="admin-list-react">{sellers.map((seller) => <article key={seller.id}><h3>{seller.storeName}</h3><p>{seller.fullName} · {seller.email}</p><p>{seller.description ?? "Sem descrição pública."}</p><div className="admin-actions-react"><button className="button button--primary" type="button" onClick={() => void atualizarVendedor(seller.id, "APPROVED")}>Aprovar</button><button className="button button--secondary danger-button-react" type="button" onClick={() => void atualizarVendedor(seller.id, "REJECTED")}>Recusar</button></div></article>)}</div> : <p>Nenhum vendedor pendente.</p>}</section><section className="info-panel"><p className="eyebrow">{reviews.length} pendentes</p><h2>Avaliações para moderação</h2>{reviews.length ? <div className="admin-list-react">{reviews.map((review) => <article key={review.id}><p className="review-card__rating">★ {review.rating}/5</p><h3>{review.title}</h3><p>{review.text}</p><p>{review.buyerName} · {review.productTitle}</p><div className="admin-actions-react"><button className="button button--primary" type="button" onClick={() => void moderarAvaliacao(review.id, "PUBLISHED")}>Publicar</button><button className="button button--secondary" type="button" onClick={() => void moderarAvaliacao(review.id, "HIDDEN")}>Ocultar</button><button className="text-button" type="button" onClick={() => void moderarAvaliacao(review.id, "REJECTED")}>Recusar</button></div></article>)}</div> : <p>Nenhuma avaliação pendente.</p>}</section></div>}</PainelPrivado></AreaProtegida>;
}

*/

function Ajuda(): ReactNode {
  useEffect(() => { document.title = "Ajuda | EliteHub Connect"; }, []);
  return <section className="legal-page"><h1>Ajuda</h1><section id="entregas"><h2>Entrega e compra</h2><p>Consulte os dados de entrega no checkout. A EliteHub calcula preço, estoque e pagamento no servidor antes de criar um pedido.</p></section><section><h2>Segurança da conta</h2><p>Use uma senha forte, confirme seu e-mail e nunca compartilhe códigos, cookies ou credenciais de pagamento.</p></section><section><h2>Atendimento</h2><p>As integrações de suporte dependem da operação habilitada pela plataforma.</p></section></section>;
}

function PaginaNaoEncontrada(): ReactNode {
  return <EstadoVazio title="Página não encontrada" description="O endereço solicitado não existe ou não está mais disponível." action={<Link className="button button--primary" to="/">Voltar ao início</Link>} />;
}

function Rotas(): ReactNode {
  const location = useLocation();
  const reduced = useReducedMotion();
  const fallback = <Carregando label="Carregando área" />;
  return <AnimatePresence mode="wait"><motion.div className="route-page-react" key={location.pathname} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ type: "spring", stiffness: 330, damping: 32 }}><Routes location={location}><Route path="/" element={<Catalogo />} /><Route path="/catalogo" element={<Catalogo />} /><Route path="/produto/:id" element={<ProdutoDetalhe />} /><Route path="/loja/:id" element={<LojaPublica />} /><Route path="/carrinho" element={<Suspense fallback={fallback}><CarrinhoPage /></Suspense>} /><Route path="/checkout" element={<Suspense fallback={fallback}><CheckoutPage /></Suspense>} /><Route path="/favoritos" element={<FavoritosPage />} /><Route path="/notificacoes" element={<NotificacoesPage />} /><Route path="/pedidos" element={<PedidosPage />} /><Route path="/conta" element={<Suspense fallback={fallback}><ContaPage /></Suspense>} /><Route path="/vendedor" element={<Suspense fallback={fallback}><VendedorPage /></Suspense>} /><Route path="/admin" element={<Suspense fallback={fallback}><AdministracaoPage /></Suspense>} /><Route path="/ajuda" element={<Ajuda />} /><Route path="*" element={<PaginaNaoEncontrada />} /></Routes></motion.div></AnimatePresence>;
}

function AplicacaoInterna(): ReactNode {
  return <ProvedorDoMercado><Rotas /></ProvedorDoMercado>;
}

export function Aplicacao(): ReactNode {
  return <BrowserRouter><AplicacaoInterna /></BrowserRouter>;
}
