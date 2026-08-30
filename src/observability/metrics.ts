import { Counter, Registry, collectDefaultMetrics } from "prom-client";

export const metricRegistry = new Registry();

collectDefaultMetrics({ register: metricRegistry });

export const httpRequestsTotal = new Counter({
  help: "Total de requisições HTTP atendidas.",
  labelNames: ["metodo", "rota", "status"] as const,
  name: "elitehub_http_requisicoes_total",
  registers: [metricRegistry],
});
