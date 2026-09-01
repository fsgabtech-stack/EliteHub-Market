import { config } from "../../config.js";

export type PaymentMethodCode = "BOLETO" | "CREDIT_CARD" | "PIX";

export type PaymentAvailability = {
  message: string;
  methods: Array<{ available: boolean; code: PaymentMethodCode; label: string; reason: string | null }>;
  mode: "DEVELOPMENT_RESERVATION" | "PROVIDER_SANDBOX" | "UNAVAILABLE";
};

export function sandboxProviderConfigurationComplete(input: {
  mercadoPagoAccessToken?: string | undefined;
  mercadoPagoWebhookSecret?: string | undefined;
  provider: string;
  sandbox: boolean;
  stripeSecretKey?: string | undefined;
  stripeWebhookSecret?: string | undefined;
}): boolean {
  if (!input.sandbox) {
    return false;
  }
  if (input.provider === "mercado_pago") {
    return Boolean(input.mercadoPagoAccessToken && input.mercadoPagoWebhookSecret);
  }
  if (input.provider === "stripe") {
    return Boolean(input.stripeSecretKey && input.stripeWebhookSecret);
  }
  return false;
}

export function paymentProviderReady(): boolean {
  return sandboxProviderConfigurationComplete(config.payments);
}

export function paymentAvailability(): PaymentAvailability {
  const providerConfigured = paymentProviderReady();
  const pixAvailable = providerConfigured || config.nodeEnv === "development";
  const mode = providerConfigured
    ? "PROVIDER_SANDBOX"
    : config.nodeEnv === "development"
      ? "DEVELOPMENT_RESERVATION"
      : "UNAVAILABLE";
  const pixReason = pixAvailable
    ? null
    : "O pagamento sandbox ainda não está configurado neste ambiente.";
  const unsupportedReason = "Cartão e boleto aguardam adaptadores PCI aprovados para o provedor selecionado.";
  return {
    message: mode === "DEVELOPMENT_RESERVATION"
      ? "Ambiente de desenvolvimento: o pedido será reservado sem cobrança."
      : mode === "PROVIDER_SANDBOX"
        ? "O Pix será confirmado pelo provedor sandbox configurado."
        : "Nenhum meio de pagamento está disponível neste ambiente.",
    methods: [
      { available: pixAvailable, code: "PIX", label: "Pix", reason: pixReason },
      { available: false, code: "CREDIT_CARD", label: "Cartão", reason: unsupportedReason },
      { available: false, code: "BOLETO", label: "Boleto", reason: unsupportedReason },
    ],
    mode,
  };
}

export function paymentMethodAvailable(method: PaymentMethodCode): boolean {
  return paymentAvailability().methods.some((item) => item.code === method && item.available);
}
