import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function Rodape(): ReactNode {
  return <footer className="site-footer"><Link className="brand" to="/">EliteHub <span>Connect</span></Link><p>Explore livremente. Entre apenas quando quiser salvar, comprar ou acompanhar um pedido.</p><nav aria-label="Links institucionais"><Link to="/ajuda">Ajuda</Link><a href="/static/legal.html#termos">Termos</a><a href="/static/legal.html#privacidade">Privacidade</a></nav></footer>;
}
