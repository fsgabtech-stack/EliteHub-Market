import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";

import { useMercado } from "../app/mercado-context";
import { mensagemPublica, requisicao } from "../api";
import { AreaProtegida, PainelPrivado } from "../shared/privado";
import { Carregando } from "../shared/estado";
import { GerenciadorProdutosVendedor } from "./GerenciadorProdutosVendedor";

type PerfilVendedor = { approvalStatus: string; description: string | null; legalName: string | null; storeName: string; supportEmail: string | null };

export function VendedorPage(): ReactNode {
  const { publicarAviso, user } = useMercado();
  const [profile, setProfile] = useState<PerfilVendedor | null>(null);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    try {
      const result = await requisicao<{ profile: PerfilVendedor }>("/api/v1/seller/profile");
      setProfile(result.profile);
    } catch {
      setProfile(null);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    if (user?.roles.includes("SELLER")) void load();
    else setLoaded(true);
  }, [load, user]);
  const onboarding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const result = await requisicao<{ message: string }>("/api/v1/seller/onboarding", { body: JSON.stringify({ description: String(data.get("description") ?? "") || undefined, legalName: String(data.get("legalName") ?? "") || undefined, storeName: String(data.get("storeName") ?? ""), supportEmail: String(data.get("supportEmail") ?? "") || undefined }), method: "POST" });
      publicarAviso(result.message, "success");
      await load();
    } catch (failure) {
      publicarAviso(mensagemPublica(failure));
    }
  };

  return <AreaProtegida message="Entre para acessar a área do vendedor."><PainelPrivado title="Área do vendedor" description="Produtos, estoque e operação da sua loja.">{!loaded ? <Carregando /> : profile ? <><section className="info-panel"><p className="eyebrow">Situação: {profile.approvalStatus}</p><h2>{profile.storeName}</h2><p>{profile.description ?? "Sem descrição pública cadastrada."}</p><p>{profile.supportEmail ?? "Sem e-mail de suporte cadastrado."}</p>{profile.approvalStatus !== "APPROVED" ? <p className="stock stock--unavailable">A publicação de produtos depende da aprovação administrativa.</p> : <p className="stock stock--available">Sua loja está aprovada. Cada alteração de produto e estoque é persistida e auditável.</p>}</section>{profile.approvalStatus === "APPROVED" ? <GerenciadorProdutosVendedor /> : null}</> : <section className="info-panel"><h2>Solicitar conta de vendedor</h2><p>Envie os dados da loja. A aprovação é realizada por um administrador.</p><form className="form-stack" onSubmit={onboarding}><label className="field-group"><span>Nome da loja</span><input name="storeName" minLength={3} required /></label><label className="field-group"><span>Razão social</span><input name="legalName" minLength={3} /></label><label className="field-group"><span>Descrição pública</span><textarea name="description" minLength={20} /></label><label className="field-group"><span>E-mail de suporte</span><input name="supportEmail" type="email" /></label><button className="button button--primary" type="submit">Enviar para aprovação</button></form></section>}</PainelPrivado></AreaProtegida>;
}
