import { createHmac, timingSafeEqual } from "node:crypto";

import { config } from "../../config.js";
import { AppError } from "../../http/errors.js";

export type PaymentMethod = "BOLETO" | "CREDIT_CARD" | "PIX";
export type PaymentProvider = "MERCADO_PAGO" | "STRIPE";
export type VerifiedPaymentStatus = "APPROVED" | "FAILED" | "PENDING" | "REFUNDED";

export type PaymentIntentRequest = {
  amountCents: number;
  idempotencyKey: string;
  orderNumber: string;
  payerEmail: string;
  paymentMethod: PaymentMethod;
};

export type ProviderPayment = {
  providerReference: string;
  providerStatus: string;
  publicData: Readonly<Record<string, string>>;
};

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function configuredPaymentProvider(): PaymentProvider {
  if (config.payments.provider === "mercado_pago") {
    return "MERCADO_PAGO";
  }
  if (config.payments.provider === "stripe") {
    return "STRIPE";
  }
  throw new AppError(503, "PAYMENT_CONFIGURATION_UNAVAILABLE");
}

async function requireOk(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new AppError(503, "PAYMENT_CONFIGURATION_UNAVAILABLE");
  }
  return response.json();
}

async function createMercadoPagoPix(input: PaymentIntentRequest): Promise<ProviderPayment> {
  if (!config.payments.mercadoPagoAccessToken || input.paymentMethod !== "PIX") {
    throw new AppError(503, "PAYMENT_CONFIGURATION_UNAVAILABLE");
  }
  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    body: JSON.stringify({
      description: `Pedido EliteHub ${input.orderNumber}`,
      external_reference: input.orderNumber,
      payer: { email: input.payerEmail },
      payment_method_id: "pix",
      transaction_amount: input.amountCents / 100,
    }),
    headers: {
      Authorization: `Bearer ${config.payments.mercadoPagoAccessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": input.idempotencyKey,
    },
    method: "POST",
  });
  const payload = await requireOk(response) as {
    id?: unknown;
    point_of_interaction?: { transaction_data?: { qr_code?: unknown; ticket_url?: unknown } };
    status?: unknown;
  };
  if (typeof payload.id !== "number" && typeof payload.id !== "string") {
    throw new AppError(503, "PAYMENT_CONFIGURATION_UNAVAILABLE");
  }
  const transactionData = payload.point_of_interaction?.transaction_data;
  return {
    providerReference: String(payload.id),
    providerStatus: typeof payload.status === "string" ? payload.status : "pending",
    publicData: {
      ...(typeof transactionData?.qr_code === "string" ? { pixQrCode: transactionData.qr_code } : {}),
      ...(typeof transactionData?.ticket_url === "string" ? { ticketUrl: transactionData.ticket_url } : {}),
    },
  };
}

async function createStripePix(input: PaymentIntentRequest): Promise<ProviderPayment> {
  if (!config.payments.stripeSecretKey || input.paymentMethod !== "PIX") {
    throw new AppError(503, "PAYMENT_CONFIGURATION_UNAVAILABLE");
  }
  const body = new URLSearchParams({
    amount: String(input.amountCents),
    currency: "brl",
    description: `Pedido EliteHub ${input.orderNumber}`,
    "metadata[order_number]": input.orderNumber,
    receipt_email: input.payerEmail,
    "payment_method_types[0]": "pix",
  });
  const response = await fetch("https://api.stripe.com/v1/payment_intents", {
    body,
    headers: {
      Authorization: `Bearer ${config.payments.stripeSecretKey}`,
      "Idempotency-Key": input.idempotencyKey,
    },
    method: "POST",
  });
  const payload = await requireOk(response) as { id?: unknown; status?: unknown };
  if (typeof payload.id !== "string") {
    throw new AppError(503, "PAYMENT_CONFIGURATION_UNAVAILABLE");
  }
  return { providerReference: payload.id, providerStatus: typeof payload.status === "string" ? payload.status : "processing", publicData: {} };
}

export async function createProviderPayment(
  input: PaymentIntentRequest,
  provider: PaymentProvider = configuredPaymentProvider(),
): Promise<{ payment: ProviderPayment; provider: PaymentProvider }> {
  if (provider !== configuredPaymentProvider()) {
    throw new AppError(503, "PAYMENT_CONFIGURATION_UNAVAILABLE");
  }
  const payment = provider === "MERCADO_PAGO"
    ? await createMercadoPagoPix(input)
    : await createStripePix(input);
  return { payment, provider };
}

function signatureParts(value: string): Map<string, string> {
  return new Map(value.split(",").map((part) => part.trim().split("=", 2)).filter((part): part is [string, string] => part.length === 2));
}

function signatureValues(value: string, name: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().split("=", 2))
    .filter((part): part is [string, string] => part.length === 2 && part[0] === name)
    .map((part) => part[1]);
}

export function verifyStripeWebhookSignature(input: {
  header: string | undefined;
  nowMilliseconds?: number;
  rawBody: Buffer;
  secret: string | undefined;
}): boolean {
  if (!input.secret || !input.header) {
    return false;
  }
  const parts = signatureParts(input.header);
  const timestamp = parts.get("t");
  const signatures = signatureValues(input.header, "v1");
  if (!timestamp || signatures.length === 0 || !/^\d+$/.test(timestamp)) {
    return false;
  }
  const ageSeconds = Math.abs(Math.floor((input.nowMilliseconds ?? Date.now()) / 1_000) - Number(timestamp));
  if (ageSeconds > 300) {
    return false;
  }
  const expected = createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.rawBody.toString("utf8")}`)
    .digest("hex");
  return signatures.some((signature) => constantTimeEquals(expected, signature));
}

export function verifyMercadoPagoWebhookSignature(input: {
  dataId: string | undefined;
  headers: Readonly<Record<string, string | undefined>>;
  secret: string | undefined;
}): boolean {
  if (!input.secret || !input.headers["x-signature"] || !input.headers["x-request-id"] || !input.dataId) {
    return false;
  }
  const parts = signatureParts(input.headers["x-signature"]);
  const timestamp = parts.get("ts");
  const signature = parts.get("v1");
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) {
    return false;
  }
  const manifest = `id:${input.dataId};request-id:${input.headers["x-request-id"]};ts:${timestamp};`;
  const expected = createHmac("sha256", input.secret).update(manifest).digest("hex");
  return constantTimeEquals(expected, signature);
}

export function verifyWebhookSignature(input: {
  dataId?: string | undefined;
  headers: Readonly<Record<string, string | undefined>>;
  provider: PaymentProvider;
  rawBody: Buffer;
}): boolean {
  return input.provider === "STRIPE"
    ? verifyStripeWebhookSignature({
      header: input.headers["stripe-signature"],
      rawBody: input.rawBody,
      secret: config.payments.stripeWebhookSecret,
    })
    : verifyMercadoPagoWebhookSignature({
      dataId: input.dataId,
      headers: input.headers,
      secret: config.payments.mercadoPagoWebhookSecret,
    });
}

export async function verifyProviderPayment(provider: PaymentProvider, providerReference: string): Promise<VerifiedPaymentStatus> {
  if (provider === "MERCADO_PAGO") {
    if (!config.payments.mercadoPagoAccessToken) {
      throw new AppError(503, "PAYMENT_CONFIGURATION_UNAVAILABLE");
    }
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(providerReference)}`, {
      headers: { Authorization: `Bearer ${config.payments.mercadoPagoAccessToken}` },
    });
    const payload = await requireOk(response) as { status?: unknown };
    if (payload.status === "approved") return "APPROVED";
    if (payload.status === "refunded") return "REFUNDED";
    if (["rejected", "cancelled", "charged_back"].includes(String(payload.status))) return "FAILED";
    return "PENDING";
  }
  if (!config.payments.stripeSecretKey) {
    throw new AppError(503, "PAYMENT_CONFIGURATION_UNAVAILABLE");
  }
  const response = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(providerReference)}`, {
    headers: { Authorization: `Bearer ${config.payments.stripeSecretKey}` },
  });
  const payload = await requireOk(response) as { status?: unknown };
  if (payload.status === "succeeded") return "APPROVED";
  if (["canceled", "requires_payment_method"].includes(String(payload.status))) return "FAILED";
  return "PENDING";
}
