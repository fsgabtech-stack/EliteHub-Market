import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { NodeSDK } from "@opentelemetry/sdk-node";

import { config } from "../config.js";
import { logger } from "./logger.js";

let sdk: NodeSDK | undefined;

function traceEndpoint(endpoint: string): string {
  const normalized = endpoint.replace(/\/+$/, "");
  return normalized.endsWith("/v1/traces") ? normalized : `${normalized}/v1/traces`;
}

export function iniciarTracing(): void {
  if (!config.observability.tracingEndpoint || sdk) {
    return;
  }
  sdk = new NodeSDK({
    instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation(), new PgInstrumentation()],
    serviceName: config.observability.serviceName,
    traceExporter: new OTLPTraceExporter({ url: traceEndpoint(config.observability.tracingEndpoint) }),
  });
  sdk.start();
  logger.info({ endpoint: traceEndpoint(config.observability.tracingEndpoint), servico: config.observability.serviceName }, "tracing OpenTelemetry habilitado");
}

export async function encerrarTracing(): Promise<void> {
  if (!sdk) {
    return;
  }
  const activeSdk = sdk;
  sdk = undefined;
  await activeSdk.shutdown();
}
