import { AnimatePresence, motion } from "framer-motion";
import { type PropsWithChildren, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { FalhaDaApi, mensagemPublica, requisicao } from "../api";
import { ModalAutenticacao, type EstadoAutenticacao } from "../auth/ModalAutenticacao";
import { obterAcaoPendente, retomarAcaoPendente, salvarAcaoPendente, type AcaoPendente } from "../auth/pending-action";
import { Cabecalho } from "../layout/Cabecalho";
import { Rodape } from "../layout/Rodape";
import type { UsuarioDaSessao } from "../types";
import { type Aviso, type ContextoMercado, MercadoContext, type ModoAutenticacao, type Provedores } from "./mercado-context";

export function ProvedorMercado({ children }: PropsWithChildren): ReactNode {
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
    if (action) { setPending(action); salvarAcaoPendente(action); }
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
      await retomarAcaoPendente({ action, adicionarFavorito: (productId) => setFavorites((current) => new Set(current).add(productId)), navegar: navigate, publicarAviso, requisicao });
    } catch (error) { publicarAviso(mensagemPublica(error)); }
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
    } catch (error) { publicarAviso(mensagemPublica(error)); }
  }, [abrirAutenticacao, navigate, publicarAviso, user]);
  const toggleFavorito = useCallback(async (productId: string) => {
    if (!user) { abrirAutenticacao("Entre para salvar produtos nos favoritos.", { kind: "favorite", productId }); return; }
    try {
      const enabled = favorites.has(productId);
      await requisicao(`/api/v1/favorites/${productId}`, { method: enabled ? "DELETE" : "POST" });
      setFavorites((current) => { const next = new Set(current); if (enabled) next.delete(productId); else next.add(productId); return next; });
      publicarAviso(enabled ? "Produto removido dos favoritos." : "Produto salvo nos favoritos.", "success");
    } catch (error) { publicarAviso(mensagemPublica(error)); }
  }, [abrirAutenticacao, favorites, publicarAviso, user]);
  const sair = useCallback(async () => {
    try { await requisicao("/api/v1/auth/logout", { method: "POST" }); } catch { return; } finally {
      setUser(null); setFavorites(new Set()); publicarAviso("Você saiu da sua conta.", "success"); navigate("/");
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
