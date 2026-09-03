import { type ReactNode, useCallback, useEffect, useState } from "react";

import { mensagemPublica, requisicao } from "../api";
import { useMercado } from "../app/mercado-context";
import { Carregando } from "../shared/estado";
import { date } from "../shared/formatacao";

type ProdutoModeracao = { id: string; sellerName: string; status: "ACTIVE" | "ARCHIVED" | "DRAFT" | "PAUSED"; title: string; updatedAt: string };
type PosVenda = { id: string; orderNumber: string; reason: string; requestType: "CANCELLATION" | "RETURN"; sellerName: string; status: "APPROVED" | "PENDING" | "RECEIVED" | "REFUND_PENDING" | "REJECTED" };
type EventoAuditoria = { action: string; createdAt: string; targetId: string | null; targetType: string };

function rotulo(value: string): string {
  return ({ ACTIVE: "Publicado", APPROVED: "Aprovada", ARCHIVED: "Arquivado", CANCELLATION: "Cancelamento", DRAFT: "Rascunho", PAUSED: "Pausado", PENDING: "Pendente", RECEIVED: "Devolução recebida", REFUND_PENDING: "Aguardando financeiro", REJECTED: "Recusada", RETURN: "Devolução" } as Record<string, string>)[value] ?? value;
}

export function PainelOperacionalAdmin(): ReactNode {
  const { publicarAviso } = useMercado();
  const [products, setProducts] = useState<ProdutoModeracao[] | null>(null);
  const [afterSales, setAfterSales] = useState<PosVenda[] | null>(null);
  const [audit, setAudit] = useState<EventoAuditoria[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [productResult, afterSalesResult, auditResult] = await Promise.all([
        requisicao<{ items: ProdutoModeracao[] }>("/api/v1/admin/products?limit=20"),
        requisicao<{ items: PosVenda[] }>("/api/v1/after-sales?scope=queue&limit=20"),
        requisicao<{ items: EventoAuditoria[] }>("/api/v1/admin/audit-events?limit=20"),
      ]);
      setProducts(productResult.items); setAfterSales(afterSalesResult.items); setAudit(auditResult.items);
    } catch (error) { publicarAviso(mensagemPublica(error)); setProducts([]); setAfterSales([]); setAudit([]); }
  }, [publicarAviso]);

  useEffect(() => { void load(); }, [load]);

  const moderateProduct = async (id: string, status: "ACTIVE" | "ARCHIVED" | "PAUSED") => {
    try {
      await requisicao(`/api/v1/admin/products/${id}/status`, { body: JSON.stringify({ status }), method: "PATCH" });
      publicarAviso(status === "PAUSED" ? "Produto pausado e removido da vitrine pública." : "Situação do produto atualizada.", "success");
      await load();
    } catch (error) { publicarAviso(mensagemPublica(error)); }
  };

  const transitionAfterSales = async (id: string, status: "APPROVED" | "REJECTED" | "REFUND_PENDING") => {
    try {
      await requisicao(`/api/v1/after-sales/${id}`, { body: JSON.stringify({ note: status === "APPROVED" ? "Solicitação aprovada pela operação." : status === "REJECTED" ? "Solicitação recusada pela operação." : "Encaminhado para confirmação financeira autorizada.", status }), method: "PATCH" });
      publicarAviso(status === "REFUND_PENDING" ? "Solicitação encaminhada ao financeiro." : "Solicitação de pós-venda atualizada.", "success");
      await load();
    } catch (error) { publicarAviso(mensagemPublica(error)); }
  };

  if (!products || !afterSales || !audit) return <Carregando label="Carregando operação administrativa" />;
  return <div className="admin-operations-react">
    <section className="info-panel"><p className="eyebrow">{afterSales.length} solicitações abertas</p><h2>Pós-venda</h2>{afterSales.length ? <div className="admin-list-react">{afterSales.map((request) => <article key={request.id}><p className="eyebrow">{rotulo(request.requestType)} · pedido {request.orderNumber} · {request.sellerName}</p><h3>{rotulo(request.status)}</h3><p>{request.reason}</p><div className="admin-actions-react">{request.status === "PENDING" ? <><button className="button button--primary" type="button" onClick={() => void transitionAfterSales(request.id, "APPROVED")}>Aprovar</button><button className="button button--secondary danger-button-react" type="button" onClick={() => void transitionAfterSales(request.id, "REJECTED")}>Recusar</button></> : null}{(request.requestType === "CANCELLATION" && request.status === "APPROVED") || (request.requestType === "RETURN" && request.status === "RECEIVED") ? <button className="button button--secondary" type="button" onClick={() => void transitionAfterSales(request.id, "REFUND_PENDING")}>Encaminhar ao financeiro</button> : null}{request.status === "REFUND_PENDING" ? <span className="stock stock--available">Aguardando confirmação financeira.</span> : null}</div></article>)}</div> : <p>Nenhuma solicitação pendente.</p>}</section>
    <section className="info-panel"><p className="eyebrow">{products.length} produtos recentes</p><h2>Moderação de produtos</h2>{products.length ? <div className="admin-list-react">{products.map((product) => <article key={product.id}><p className="eyebrow">{product.sellerName} · atualizado em {date(product.updatedAt)}</p><h3>{product.title}</h3><p>{rotulo(product.status)}</p><div className="admin-actions-react">{product.status === "ACTIVE" ? <button className="button button--secondary danger-button-react" type="button" onClick={() => void moderateProduct(product.id, "PAUSED")}>Pausar vitrine</button> : <button className="button button--secondary" type="button" onClick={() => void moderateProduct(product.id, "ACTIVE")}>Publicar</button>}<button className="text-button" type="button" onClick={() => void moderateProduct(product.id, "ARCHIVED")}>Arquivar</button></div></article>)}</div> : <p>Nenhum produto encontrado.</p>}</section>
    <section className="info-panel admin-audit-react"><p className="eyebrow">Últimos {audit.length} eventos</p><h2>Auditoria crítica</h2>{audit.length ? <ol>{audit.map((event, index) => <li key={`${event.createdAt}-${index}`}><strong>{event.action}</strong><span>{event.targetType}{event.targetId ? ` · ${event.targetId.slice(0, 8)}` : ""} · {date(event.createdAt)}</span></li>)}</ol> : <p>Nenhum evento registrado.</p>}</section>
  </div>;
}
