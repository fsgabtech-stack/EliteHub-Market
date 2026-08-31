import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";

import { useMercado } from "../app/mercado-context";
import { mensagemPublica, requisicao } from "../api";
import { AreaProtegida, PainelPrivado } from "../shared/privado";

export function ContaPage(): ReactNode {
  const { publicarAviso, sair, user } = useMercado();
  const [deleting, setDeleting] = useState(false);
  if (!user) return <AreaProtegida message="Entre para acessar sua conta."><span /></AreaProtegida>;
  const remove = async () => {
    if (!window.confirm("Esta ação anonimiza sua conta e não pode ser desfeita. Deseja continuar?")) return;
    setDeleting(true);
    try {
      await requisicao("/api/v1/account/deletion", { body: JSON.stringify({ confirm: true }), method: "POST" });
      publicarAviso("Sua conta foi anonimizada.", "success");
      await sair();
    } catch (failure) {
      publicarAviso(mensagemPublica(failure));
    } finally {
      setDeleting(false);
    }
  };
  return <AreaProtegida message="Entre para acessar sua conta."><PainelPrivado title="Minha conta" description="Informações da sessão atualmente ativa."><section className="info-panel"><h2>{user.fullName}</h2><p>{user.email}</p><p className={`stock ${user.emailVerified ? "stock--available" : "stock--unavailable"}`}>{user.emailVerified ? "E-mail confirmado" : "E-mail ainda não confirmado"}</p><div className="product-actions"><Link className="button button--secondary" to="/pedidos">Meus pedidos</Link><Link className="button button--secondary" to="/favoritos">Favoritos</Link>{user.roles.includes("SELLER") ? <Link className="button button--secondary" to="/vendedor">Área do vendedor</Link> : null}</div></section><section className="info-panel account-privacy-react"><h2>Privacidade e dados</h2><p>Você pode exportar seus dados pessoais ou solicitar anonimização quando não houver pedidos ativos.</p><div className="product-actions"><a className="button button--secondary" href="/api/v1/account/data-export">Exportar meus dados</a><button className="button button--secondary danger-button-react" type="button" disabled={deleting} onClick={() => void remove()}>{deleting ? "Anonimizando" : "Excluir e anonimizar conta"}</button></div></section></PainelPrivado></AreaProtegida>;
}
