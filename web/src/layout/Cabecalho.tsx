import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { type FormEvent, type ReactNode, useDeferredValue, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { requisicao } from "../api";
import { useMercado } from "../app/mercado-context";
import { Icone } from "../shared/icone";
import { primeiroNome } from "../shared/texto";

export function Cabecalho(): ReactNode {
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
        <Icone nome="search" />
        <input id="product-search-react" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busque produtos, marcas e categorias" autoComplete="off" aria-autocomplete="list" aria-controls="search-suggestions-react" aria-expanded={suggestions.length > 0} />
        <button className="search__submit" type="submit">Buscar</button>
        <AnimatePresence>{suggestions.length > 0 ? <motion.ul id="search-suggestions-react" className="search-suggestions" role="listbox" initial={reduced ? false : { opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.16 }}>
          {suggestions.map((item) => <li key={item.id}><Link to={`/produto/${item.id}`} role="option" onClick={() => setSuggestions([])}>{item.label}</Link></li>)}
        </motion.ul> : null}</AnimatePresence>
      </form>
      <div className="header-actions" aria-label="Ações da conta">
        <Link className="header-location desktop-only" to="/ajuda#entregas" title="Informações de entrega"><Icone nome="location" /><span>Entrega segura<br /><strong>consulte no checkout</strong></span></Link>
        <button className="icon-button" type="button" onClick={() => abrirRotaProtegida("/favoritos", "Entre para acessar seus favoritos.")} aria-label="Favoritos" title="Favoritos"><Icone nome="heart" /></button>
        <button className="icon-button desktop-only" type="button" onClick={() => abrirRotaProtegida("/notificacoes", "Entre para acessar suas notificações.")} aria-label="Notificações" title="Notificações"><Icone nome="bell" /></button>
        <button className="icon-button" type="button" onClick={() => abrirRotaProtegida("/carrinho", "Entre para acessar seu carrinho.")} aria-label="Carrinho" title="Carrinho"><Icone nome="cart" /></button>
        <div className="account-menu-wrap">
          <button className="account-button" type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((current) => !current)}>
            <span className="account-avatar">{user ? primeiroNome(user.fullName).slice(0, 2).toUpperCase() : <Icone nome="user" />}</span><span className="desktop-only">{user ? primeiroNome(user.fullName) : "Conta"}</span>
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
        <button className="icon-button mobile-only" type="button" aria-controls="market-nav-react" aria-expanded={mobile} aria-label="Abrir menu" onClick={() => setMobile((current) => !current)}><Icone nome="menu" /></button>
      </div>
    </div>
    <nav id="market-nav-react" className={`market-nav ${mobile ? "is-open" : ""}`} aria-label="Navegação do marketplace">
      <Link to="/" data-active={home}>Início</Link><Link to="/catalogo" data-active={catalogue}>Explorar catálogo</Link><Link to="/ajuda">Ajuda</Link>
      <button className="nav-utility" type="button" onClick={toggleTheme}>{theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}</button>
    </nav>
  </header>;
}
