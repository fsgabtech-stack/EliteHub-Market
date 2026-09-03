import { Counter, Registry, collectDefaultMetrics } from "prom-client";

export const metricRegistry = new Registry();

collectDefaultMetrics({ register: metricRegistry });

export const httpRequestsTotal = new Counter({
  help: "Total de requisições HTTP atendidas.",
  labelNames: ["metodo", "rota", "status"] as const,
  name: "elitehub_http_requisicoes_total",
  registers: [metricRegistry],
});

export const checkoutOrdersCreatedTotal = new Counter({
  help: "Total de pedidos criados pelo checkout, sem contabilizar repetições idempotentes.",
  labelNames: ["modo_pagamento"] as const,
  name: "elitehub_checkout_pedidos_criados_total",
  registers: [metricRegistry],
});

export const orderStatusTransitionsTotal = new Counter({
  help: "Total de transições de pedido concluídas por categoria de ator e destino.",
  labelNames: ["ator", "destino"] as const,
  name: "elitehub_pedidos_transicoes_total",
  registers: [metricRegistry],
});

export const shippingQuotesTotal = new Counter({
  help: "Total de cotações de frete calculadas pela política local por região de destino.",
  labelNames: ["region"] as const,
  name: "elitehub_frete_cotacoes_total",
  registers: [metricRegistry],
});

export const afterSalesRequestsTotal = new Counter({
  help: "Total de solicitações de pós-venda abertas pelo cliente por tipo.",
  labelNames: ["tipo"] as const,
  name: "elitehub_pos_venda_solicitacoes_total",
  registers: [metricRegistry],
});

export const afterSalesTransitionsTotal = new Counter({
  help: "Total de transições do fluxo de pós-venda por ator e destino.",
  labelNames: ["ator", "destino"] as const,
  name: "elitehub_pos_venda_transicoes_total",
  registers: [metricRegistry],
});
