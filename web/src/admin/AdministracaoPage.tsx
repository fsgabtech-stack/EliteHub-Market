import { type ReactNode, useCallback, useEffect, useState } from "react";

import { useMercado } from "../app/mercado-context";
import { mensagemPublica, requisicao } from "../api";
import { AreaProtegida, PainelPrivado } from "../shared/privado";
import { Carregando, EstadoVazio } from "../shared/estado";

type VendedorPendente = { approvalStatus: string; description: string | null; email: string; fullName: string; id: string; storeName: string };
type AvaliacaoPendente = { buyerName: string; id: string; productTitle: string; rating: number; text: string; title: string };
type ResumoOperacional = {
  inventory: { lowStockProducts: number; zeroStockProducts: number };
  orders: Array<{ count: number; status: string }>;
  outbox: { deadLettered: number; pending: number; retrying: number };
};

function rotuloStatus(status: string): string {
  return ({ CANCELLED: "Cancelado", CREATED: "Criado", DELIVERED: "Entregue", FAILED: "Falhou", PAID: "Pago", PENDING_PAYMENT: "Aguardando pagamento", PROCESSING: "Em separação", REFUNDED: "Reembolsado", SHIPPED: "Enviado" } as Record<string, string>)[status] ?? status;
}

export function AdministracaoPage(): ReactNode {
  const { publicarAviso, user } = useMercado();
  const [sellers, setSellers] = useState<VendedorPendente[]>([]);
  const [reviews, setReviews] = useState<AvaliacaoPendente[]>([]);
  const [summary, setSummary] = useState<ResumoOperacional | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!user?.roles.includes("ADMIN")) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [sellerResult, reviewResult, summaryResult] = await Promise.all([
        requisicao<{ items: VendedorPendente[] }>("/api/v1/admin/sellers?approvalStatus=PENDING"),
        requisicao<{ items: AvaliacaoPendente[] }>("/api/v1/admin/reviews?status=PENDING"),
        requisicao<ResumoOperacional>("/api/v1/admin/operations/summary"),
      ]);
      setSellers(sellerResult.items);
      setReviews(reviewResult.items);
      setSummary(summaryResult);
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

  return <AreaProtegida message="Entre para acessar a administração."><PainelPrivado title="Administração" description="Filas operacionais reais, moderação e saúde da operação.">{!user?.roles.includes("ADMIN") ? <EstadoVazio title="Acesso restrito" description="Esta área exige a função administrativa." /> : loading ? <Carregando /> : <><section className="operations-summary-react" aria-label="Resumo operacional"><article><span>Fila de eventos</span><strong>{summary?.outbox.pending ?? 0}</strong><small>{summary?.outbox.retrying ?? 0} em nova tentativa · {summary?.outbox.deadLettered ?? 0} em fila morta</small></article><article><span>Estoque crítico</span><strong>{summary?.inventory.lowStockProducts ?? 0}</strong><small>{summary?.inventory.zeroStockProducts ?? 0} produtos sem saldo</small></article><article><span>Pedidos por situação</span><strong>{summary?.orders.reduce((total, item) => total + item.count, 0) ?? 0}</strong><small>{summary?.orders.map((item) => `${rotuloStatus(item.status)}: ${item.count}`).join(" · ") || "Sem pedidos"}</small></article></section><div className="admin-grid-react"><section className="info-panel"><p className="eyebrow">{sellers.length} pendentes</p><h2>Vendedores para análise</h2>{sellers.length ? <div className="admin-list-react">{sellers.map((seller) => <article key={seller.id}><h3>{seller.storeName}</h3><p>{seller.fullName} · {seller.email}</p><p>{seller.description ?? "Sem descrição pública."}</p><div className="admin-actions-react"><button className="button button--primary" type="button" onClick={() => void atualizarVendedor(seller.id, "APPROVED")}>Aprovar</button><button className="button button--secondary danger-button-react" type="button" onClick={() => void atualizarVendedor(seller.id, "REJECTED")}>Recusar</button></div></article>)}</div> : <p>Nenhum vendedor pendente.</p>}</section><section className="info-panel"><p className="eyebrow">{reviews.length} pendentes</p><h2>Avaliações para moderação</h2>{reviews.length ? <div className="admin-list-react">{reviews.map((review) => <article key={review.id}><p className="review-card__rating">★ {review.rating}/5</p><h3>{review.title}</h3><p>{review.text}</p><p>{review.buyerName} · {review.productTitle}</p><div className="admin-actions-react"><button className="button button--primary" type="button" onClick={() => void moderarAvaliacao(review.id, "PUBLISHED")}>Publicar</button><button className="button button--secondary" type="button" onClick={() => void moderarAvaliacao(review.id, "HIDDEN")}>Ocultar</button><button className="text-button" type="button" onClick={() => void moderarAvaliacao(review.id, "REJECTED")}>Recusar</button></div></article>)}</div> : <p>Nenhuma avaliação pendente.</p>}</section></div></>}</PainelPrivado></AreaProtegida>;
}
