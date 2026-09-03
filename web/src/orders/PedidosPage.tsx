import { motion } from "framer-motion";
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";

import { mensagemPublica, requisicao } from "../api";
import { useMercado } from "../app/mercado-context";
import { Carregando, EstadoVazio } from "../shared/estado";
import { currency, date } from "../shared/formatacao";
import { AreaProtegida, PainelPrivado } from "../shared/privado";

type FretePedido = {
  amountCents: number;
  carrier: string | null;
  deliveredAt: string | null;
  estimatedMaxBusinessDays: number | null;
  estimatedMinBusinessDays: number | null;
  service: string;
  shippedAt: string | null;
  trackingCode: string | null;
};

type Pedido = {
  createdAt: string;
  id: string;
  number: string;
  paymentStatus: string;
  shipping: FretePedido;
  status: "CANCELLED" | "CREATED" | "DELIVERED" | "FAILED" | "PAID" | "PENDING_PAYMENT" | "PROCESSING" | "REFUNDED" | "SHIPPED";
  totalCents: number;
};

type DadosEnvio = { carrier: string; trackingCode: string };
type SolicitaçãoPosVenda = { id: string; orderId: string; reason: string; requestType: "CANCELLATION" | "RETURN"; status: string };
type DetalhePedido = { items: Array<{ quantity: number; title: string; unitPriceCents: number }>; statusHistory: Array<{ createdAt: string; fromStatus: string | null; reason: string | null; toStatus: string }> };

function resumoEntrega(frete: FretePedido): string {
  const prazo = frete.estimatedMinBusinessDays === null || frete.estimatedMaxBusinessDays === null
    ? "Prazo será confirmado pela loja."
    : `Previsão de ${frete.estimatedMinBusinessDays} a ${frete.estimatedMaxBusinessDays} dias úteis.`;
  return `${frete.service} · ${currency(frete.amountCents)} · ${prazo}`;
}

export function PedidosPage(): ReactNode {
  const { publicarAviso, user } = useMercado();
  const [scope, setScope] = useState<"mine" | "received">("mine");
  const [items, setItems] = useState<Pedido[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [dadosEnvio, setDadosEnvio] = useState<Record<string, DadosEnvio>>({});
  const [solicitacoes, setSolicitacoes] = useState<Record<string, SolicitaçãoPosVenda>>({});
  const [detalhes, setDetalhes] = useState<Record<string, DetalhePedido>>({});

  const load = useCallback(async () => {
    try {
      const [result, posVenda] = await Promise.all([
        requisicao<{ items: Pedido[] }>(`/api/v1/orders?scope=${scope}`),
        requisicao<{ items: SolicitaçãoPosVenda[] }>(`/api/v1/after-sales?scope=${scope === "mine" ? "mine" : "received"}&limit=100`),
      ]);
      setItems(result.items);
      setSolicitacoes(Object.fromEntries(posVenda.items.map((request) => [request.orderId, request])));
      setError(null);
    } catch (failure) {
      setError(mensagemPublica(failure));
    }
  }, [scope]);

  useEffect(() => { void load(); }, [load]);

  const atualizarStatus = async (pedido: Pedido, status: "DELIVERED" | "PROCESSING" | "SHIPPED", event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const envio = dadosEnvio[pedido.id];
    if (status === "SHIPPED" && (!envio?.carrier.trim() || !envio.trackingCode.trim())) {
      publicarAviso("Informe a transportadora e o código de rastreio antes de registrar o envio.");
      return;
    }
    const envioValidado = status === "SHIPPED" ? envio : undefined;
    setEnviando(pedido.id);
    try {
      await requisicao(`/api/v1/orders/${pedido.id}/status`, {
        body: JSON.stringify(envioValidado ? { shipment: { carrier: envioValidado.carrier.trim(), trackingCode: envioValidado.trackingCode.trim() }, status } : { status }),
        method: "POST",
      });
      publicarAviso(status === "PROCESSING" ? "Pedido movido para separação." : status === "SHIPPED" ? "Envio registrado e cliente notificado." : "Entrega confirmada.", "success");
      await load();
    } catch (failure) {
      publicarAviso(mensagemPublica(failure));
    } finally {
      setEnviando(null);
    }
  };

  const atualizarDadosEnvio = (id: string, campo: keyof DadosEnvio, valor: string) => {
    setDadosEnvio((atual) => ({ ...atual, [id]: { carrier: atual[id]?.carrier ?? "", trackingCode: atual[id]?.trackingCode ?? "", [campo]: valor } }));
  };
  const carregarDetalhe = async (id: string) => {
    if (detalhes[id]) { setDetalhes((current) => { const next = { ...current }; delete next[id]; return next; }); return; }
    try {
      const result = await requisicao<{ order: DetalhePedido }>(`/api/v1/orders/${id}`);
      setDetalhes((current) => ({ ...current, [id]: result.order }));
    } catch (failure) { publicarAviso(mensagemPublica(failure)); }
  };
  const cancelarPedido = async (pedido: Pedido) => {
    setEnviando(pedido.id);
    try {
      await requisicao(`/api/v1/orders/${pedido.id}/status`, { body: JSON.stringify({ reason: "Cancelamento solicitado pelo cliente antes do pagamento.", status: "CANCELLED" }), method: "POST" });
      publicarAviso("Pedido cancelado e reserva de estoque liberada.", "success");
      await load();
    } catch (failure) { publicarAviso(mensagemPublica(failure)); } finally { setEnviando(null); }
  };
  const solicitarPosVenda = async (event: FormEvent<HTMLFormElement>, pedido: Pedido, requestType: SolicitaçãoPosVenda["requestType"]) => {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (reason.length < 20) { publicarAviso("Descreva a solicitação com pelo menos 20 caracteres."); return; }
    setEnviando(pedido.id);
    try {
      await requisicao(`/api/v1/orders/${pedido.id}/after-sales-requests`, { body: JSON.stringify({ reason, requestType }), method: "POST" });
      publicarAviso(requestType === "RETURN" ? "Solicitação de devolução enviada para análise." : "Solicitação de cancelamento enviada para análise.", "success");
      await load();
    } catch (failure) { publicarAviso(mensagemPublica(failure)); } finally { setEnviando(null); }
  };
  const confirmarRecebimentoDevolucao = async (pedido: Pedido, request: SolicitaçãoPosVenda) => {
    setEnviando(pedido.id);
    try {
      await requisicao(`/api/v1/after-sales/${request.id}`, { body: JSON.stringify({ note: "Devolução recebida pela loja.", status: "RECEIVED" }), method: "PATCH" });
      publicarAviso("Recebimento registrado; a operação poderá encaminhar o financeiro.", "success");
      await load();
    } catch (failure) { publicarAviso(mensagemPublica(failure)); } finally { setEnviando(null); }
  };

  return <AreaProtegida message="Entre para acessar seus pedidos."><PainelPrivado title="Meus pedidos" description="Acompanhe compras, entrega, pós-venda e operações de venda.">{user?.roles.includes("SELLER") ? <div className="page-tabs" role="tablist"><button type="button" role="tab" aria-selected={scope === "mine"} onClick={() => setScope("mine")}>Minhas compras</button><button type="button" role="tab" aria-selected={scope === "received"} onClick={() => setScope("received")}>Vendas recebidas</button></div> : null}{error ? <EstadoVazio title="Não foi possível carregar os pedidos" description={error} /> : !items ? <Carregando /> : !items.length ? <EstadoVazio title="Você ainda não tem pedidos" description="Quando concluir uma compra, ela aparecerá nesta área." /> : <div className="notification-list">{items.map((item) => <motion.article className="notification-item order-item-react" key={item.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><div><h2>Pedido {item.number}</h2><p>{currency(item.totalCents)} · {item.status} · pagamento {item.paymentStatus}</p><p className="order-shipping-react">{resumoEntrega(item.shipping)}</p>{item.shipping.trackingCode ? <p className="order-shipping-react">Rastreio: <strong>{item.shipping.carrier}</strong> · {item.shipping.trackingCode}</p> : null}{solicitacoes[item.id] ? <p className="order-shipping-react">Pós-venda: <strong>{solicitacoes[item.id]?.requestType === "RETURN" ? "devolução" : "cancelamento"}</strong> · {solicitacoes[item.id]?.status}</p> : null}</div><time dateTime={item.createdAt}>{date(item.createdAt)}</time><div className="fulfillment-actions-react"><button className="text-button" type="button" onClick={() => void carregarDetalhe(item.id)}>{detalhes[item.id] ? "Ocultar histórico" : "Ver itens e histórico"}</button></div>{detalhes[item.id] ? <section className="order-details-react"><h3>Itens</h3><ul>{detalhes[item.id]?.items.map((product, index) => <li key={`${product.title}-${index}`}>{product.quantity}× {product.title} · {currency(product.unitPriceCents)}</li>)}</ul><h3>Histórico</h3><ol>{detalhes[item.id]?.statusHistory.map((entry, index) => <li key={`${entry.createdAt}-${index}`}>{date(entry.createdAt)} · {entry.fromStatus ?? "Início"} → {entry.toStatus}{entry.reason ? ` · ${entry.reason}` : ""}</li>)}</ol></section> : null}{scope === "mine" && item.status === "PENDING_PAYMENT" ? <div className="fulfillment-actions-react"><button className="button button--secondary" type="button" disabled={enviando === item.id} onClick={() => void cancelarPedido(item)}>{enviando === item.id ? "Cancelando…" : "Cancelar pedido"}</button></div> : null}{scope === "mine" && !solicitacoes[item.id] && (item.status === "PAID" || item.status === "PROCESSING" || item.status === "DELIVERED") ? <details className="fulfillment-actions-react after-sales-form-react"><summary>{item.status === "DELIVERED" ? "Solicitar devolução" : "Solicitar cancelamento"}</summary><form className="form-stack" onSubmit={(event) => void solicitarPosVenda(event, item, item.status === "DELIVERED" ? "RETURN" : "CANCELLATION")}><label className="field-group"><span>Motivo</span><textarea name="reason" minLength={20} maxLength={1000} required /></label><button className="button button--secondary" type="submit" disabled={enviando === item.id}>{enviando === item.id ? "Enviando…" : "Enviar para análise"}</button></form></details> : null}{scope === "received" && solicitacoes[item.id]?.requestType === "RETURN" && solicitacoes[item.id]?.status === "APPROVED" ? <div className="fulfillment-actions-react"><button className="button button--secondary" type="button" disabled={enviando === item.id} onClick={() => void confirmarRecebimentoDevolucao(item, solicitacoes[item.id] as SolicitaçãoPosVenda)}>{enviando === item.id ? "Atualizando…" : "Confirmar recebimento da devolução"}</button></div> : null}{scope === "received" && item.status === "PAID" ? <div className="fulfillment-actions-react"><button className="button button--secondary" type="button" disabled={enviando === item.id} onClick={() => void atualizarStatus(item, "PROCESSING")}>{enviando === item.id ? "Atualizando…" : "Iniciar separação"}</button></div> : null}{scope === "received" && item.status === "PROCESSING" ? <form className="fulfillment-actions-react fulfillment-form-react" onSubmit={(event) => void atualizarStatus(item, "SHIPPED", event)}><label className="field-group"><span>Transportadora</span><input value={dadosEnvio[item.id]?.carrier ?? ""} onChange={(event) => atualizarDadosEnvio(item.id, "carrier", event.target.value)} autoComplete="organization" required /></label><label className="field-group"><span>Código de rastreio</span><input value={dadosEnvio[item.id]?.trackingCode ?? ""} onChange={(event) => atualizarDadosEnvio(item.id, "trackingCode", event.target.value)} autoComplete="off" required /></label><button className="button button--primary" type="submit" disabled={enviando === item.id}>{enviando === item.id ? "Registrando…" : "Marcar como enviado"}</button></form> : null}{scope === "received" && item.status === "SHIPPED" ? <div className="fulfillment-actions-react"><button className="button button--secondary" type="button" disabled={enviando === item.id} onClick={() => void atualizarStatus(item, "DELIVERED")}>{enviando === item.id ? "Atualizando…" : "Marcar como entregue"}</button></div> : null}</motion.article>)}</div>}</PainelPrivado></AreaProtegida>;
}
