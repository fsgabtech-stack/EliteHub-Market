import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { mensagemPublica, requisicao } from "../api";
import { type ModoAutenticacao, useMercado } from "../app/mercado-context";
import { Icone, MarcaGoogle, MarcaMicrosoft } from "../shared/icone";
import { senhaForte } from "../shared/texto";

export type EstadoAutenticacao = { mensagem: string; modo: ModoAutenticacao; resetToken?: string };

export function ModalAutenticacao({ close, onAuthenticated, state }: { close: () => void; onAuthenticated: () => Promise<void>; state: EstadoAutenticacao }): ReactNode {
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
    if (!senhaForte(password)) { setStatus("Sua senha precisa ter ao menos 12 caracteres, maiúscula, minúscula e número."); return; }
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
    if (!senhaForte(password)) { setStatus("Sua senha precisa ter ao menos 12 caracteres, maiúscula, minúscula e número."); return; }
    setLoading(true); setStatus("");
    try { const result = await requisicao<{ message: string }>("/api/v1/auth/password-reset", { body: JSON.stringify({ password, passwordConfirmation: String(data.get("passwordConfirmation") ?? ""), token: state.resetToken }), method: "POST" }); setMode("login"); setStatus(result.message); } catch (error) { setStatus(mensagemPublica(error)); } finally { setLoading(false); }
  };

  return <motion.div className="auth-overlay" role="presentation" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <motion.div ref={ref} className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title-react" tabIndex={-1} initial={reduced ? false : { opacity: 0, scale: 0.92, y: 22 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }} transition={{ type: "spring", stiffness: 330, damping: 28 }}>
      <button className="dialog-close" type="button" aria-label="Fechar autenticação" onClick={close}><Icone nome="close" /></button>
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
        {["welcome", "login", "register"].includes(mode) ? <div className="google-section"><div className="auth-divider" aria-hidden="true"><span>ou</span></div><div className="auth-provider-list"><button className="button button--provider" type="button" disabled={!providers.google} title={providers.google ? "" : "O login com Google ainda não está configurado."} onClick={() => { if (providers.google) window.location.assign("/api/v1/auth/google"); }}><MarcaGoogle /><span>Continuar com Google</span></button><button className="button button--provider" type="button" disabled={!providers.microsoft} title="O login com Microsoft ainda não está configurado."><MarcaMicrosoft /><span>Continuar com Microsoft</span></button></div></div> : null}
        <div className="auth-switch"><span>{current.prompt}</span><button className="text-button" type="button" onClick={() => { setStatus(""); setMode(current.switchMode); }}>{current.switchText}</button></div>
      </div>
    </motion.div>
  </motion.div>;
}
