import { type ReactNode, useCallback, useEffect, useState } from "react";

import { useMercado } from "../app/mercado-context";
import { mensagemPublica, requisicao } from "../api";
import { AreaProtegida, PainelPrivado } from "../shared/privado";
import { Carregando, EstadoVazio } from "../shared/estado";

type VendedorPendente = { approvalStatus: string; description: string | null; email: string; fullName: string; id: string; storeName: string };
type AvaliacaoPendente = { buyerName: string; id: string; productTitle: string; rating: number; text: string; title: string };

export function AdministracaoPage(): ReactNode {
  const { publicarAviso, user } = useMercado();
  const [sellers, setSellers] = useState<VendedorPendente[]>([]);
  const [reviews, setReviews] = useState<AvaliacaoPendente[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!user?.roles.includes("ADMIN")) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [sellerResult, reviewResult] = await Promise.all([
        requisicao<{ items: VendedorPendente[] }>("/api/v1/admin/sellers?approvalStatus=PENDING"),
        requisicao<{ items: AvaliacaoPendente[] }>("/api/v1/admin/reviews?status=PENDING"),
      ]);
      setSellers(sellerResult.items);
      setReviews(reviewResult.items);
    } catch (failure) {
      publicarAviso(mensagemPublica(failure));
    } finally {
      setLoading(false);
    }
  }, [publicarAviso, user]);
  useEffect(() => { void load(); }, [load]);
  const atualizarVendedor = async (id: string, status: "APPROVED" | "REJECTED") => {
    try {
      await requisicao(`/api/v1/admin/sellers/${id}/approval`, { body: JSON.stringify({ status }), method: "POST" });
      publicarAviso(status === "APPROVED" ? "Vendedor aprovado." : "Vendedor recusado.", "success");
      await load();
    } catch (failure) {
      publicarAviso(mensagemPublica(failure));
    }
  };
  const moderarAvaliacao = async (id: string, status: "PUBLISHED" | "HIDDEN" | "REJECTED") => {
    try {
      await requisicao(`/api/v1/admin/reviews/${id}`, { body: JSON.stringify({ status }), method: "PATCH" });
      publicarAviso(status === "PUBLISHED" ? "Avaliação publicada." : "Avaliação moderada.", "success");
      await load();
    } catch (failure) {
      publicarAviso(mensagemPublica(failure));
    }
  };

  return <AreaProtegida message="Entre para acessar a administração."><PainelPrivado title="Administração" description="Filas reais de aprovação de vendedores e moderação de avaliações.">{!user?.roles.includes("ADMIN") ? <EstadoVazio title="Acesso restrito" description="Esta área exige a função administrativa." /> : loading ? <Carregando /> : <div className="admin-grid-react"><section className="info-panel"><p className="eyebrow">{sellers.length} pendentes</p><h2>Vendedores para análise</h2>{sellers.length ? <div className="admin-list-react">{sellers.map((seller) => <article key={seller.id}><h3>{seller.storeName}</h3><p>{seller.fullName} · {seller.email}</p><p>{seller.description ?? "Sem descrição pública."}</p><div className="admin-actions-react"><button className="button button--primary" type="button" onClick={() => void atualizarVendedor(seller.id, "APPROVED")}>Aprovar</button><button className="button button--secondary danger-button-react" type="button" onClick={() => void atualizarVendedor(seller.id, "REJECTED")}>Recusar</button></div></article>)}</div> : <p>Nenhum vendedor pendente.</p>}</section><section className="info-panel"><p className="eyebrow">{reviews.length} pendentes</p><h2>Avaliações para moderação</h2>{reviews.length ? <div className="admin-list-react">{reviews.map((review) => <article key={review.id}><p className="review-card__rating">★ {review.rating}/5</p><h3>{review.title}</h3><p>{review.text}</p><p>{review.buyerName} · {review.productTitle}</p><div className="admin-actions-react"><button className="button button--primary" type="button" onClick={() => void moderarAvaliacao(review.id, "PUBLISHED")}>Publicar</button><button className="button button--secondary" type="button" onClick={() => void moderarAvaliacao(review.id, "HIDDEN")}>Ocultar</button><button className="text-button" type="button" onClick={() => void moderarAvaliacao(review.id, "REJECTED")}>Recusar</button></div></article>)}</div> : <p>Nenhuma avaliação pendente.</p>}</section></div>}</PainelPrivado></AreaProtegida>;
}
