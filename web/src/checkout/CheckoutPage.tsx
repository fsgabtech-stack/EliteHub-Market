import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useMercado } from "../app/mercado-context";
import { mensagemPublica, requisicao } from "../api";
import { checkoutDisponivel, enviarCheckout } from "./submit-checkout";
import { AreaProtegida, PainelPrivado } from "../shared/privado";
import { Carregando, EstadoVazio } from "../shared/estado";
import { currency } from "../shared/formatacao";
import type { Carrinho, Endereco } from "../types";

type CotacaoFrete = {
  amountCents: number;
  estimatedMaxBusinessDays: number;
  estimatedMinBusinessDays: number;
  service: string;
};

type DisponibilidadePagamento = {
  message: string;
  methods: Array<{ available: boolean; code: "BOLETO" | "CREDIT_CARD" | "PIX"; label: string; reason: string | null }>;
  mode: "DEVELOPMENT_RESERVATION" | "PROVIDER_SANDBOX" | "UNAVAILABLE";
};

function addressText(item: Endereco): string {
  return `${item.street}, ${item.number}${item.complement ? ` - ${item.complement}` : ""}, ${item.neighborhood}, ${item.city}/${item.state}`;
}

function FormEndereco({ saved }: { saved: () => Promise<void> }): ReactNode {
  const { publicarAviso } = useMercado();
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setLoading(true);
    try {
      await requisicao("/api/v1/addresses", { body: JSON.stringify({ city: String(data.get("city") ?? ""), complement: String(data.get("complement") ?? "") || undefined, label: String(data.get("label") ?? ""), neighborhood: String(data.get("neighborhood") ?? ""), number: String(data.get("number") ?? ""), postalCode: String(data.get("postalCode") ?? "").replace(/\D/g, ""), recipientName: String(data.get("recipientName") ?? ""), state: String(data.get("state") ?? "").toUpperCase(), street: String(data.get("street") ?? "") }), method: "POST" });
      publicarAviso("Endereço salvo.", "success");
      await saved();
    } catch (failure) {
      publicarAviso(mensagemPublica(failure));
    } finally {
      setLoading(false);
    }
  };
  return <form className="form-stack address-form-react" onSubmit={submit}><label className="field-group"><span>Identificação</span><input name="label" placeholder="Casa" required /></label><label className="field-group"><span>Destinatário</span><input name="recipientName" placeholder="Nome completo" required /></label><label className="field-group"><span>CEP</span><input name="postalCode" inputMode="numeric" placeholder="Somente números" required /></label><label className="field-group"><span>Rua</span><input name="street" required /></label><label className="field-group"><span>Número</span><input name="number" required /></label><label className="field-group"><span>Complemento</span><input name="complement" /></label><label className="field-group"><span>Bairro</span><input name="neighborhood" required /></label><label className="field-group"><span>Cidade</span><input name="city" required /></label><label className="field-group"><span>UF</span><input name="state" maxLength={2} placeholder="SP" required /></label><button className="button button--secondary" type="submit" disabled={loading}>{loading ? "Salvando" : "Salvar endereço"}</button></form>;
}

export function CheckoutPage(): ReactNode {
  const { publicarAviso } = useMercado();
  const navigate = useNavigate();
  const [cart, setCart] = useState<Carrinho | null>(null);
  const [addresses, setAddresses] = useState<Endereco[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string | undefined>();
  const [payment, setPayment] = useState<"BOLETO" | "CREDIT_CARD" | "PIX">("PIX");
  const [paymentAvailability, setPaymentAvailability] = useState<DisponibilidadePagamento | null>(null);
  const [shippingQuote, setShippingQuote] = useState<CotacaoFrete | null>(null);
  const [shippingError, setShippingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cartResult, addressResult, availabilityResult] = await Promise.all([
        requisicao<{ cart: Carrinho }>("/api/v1/cart"),
        requisicao<{ items: Endereco[] }>("/api/v1/addresses"),
        requisicao<DisponibilidadePagamento>("/api/v1/payments/availability"),
      ]);
      setCart(cartResult.cart);
      setAddresses(addressResult.items);
      setSelectedAddress((current) => addressResult.items.some((address) => address.id === current) ? current : addressResult.items[0]?.id);
      setPaymentAvailability(availabilityResult);
      const selectedMethod = availabilityResult.methods.find((method) => method.available)?.code;
      if (selectedMethod) setPayment(selectedMethod);
    } catch (failure) {
      publicarAviso(mensagemPublica(failure));
    } finally {
      setLoading(false);
    }
  }, [publicarAviso]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const address = addresses.find((item) => item.id === selectedAddress);
    if (!address) {
      setShippingQuote(null);
      setShippingError(null);
      return;
    }
    let active = true;
    setShippingError(null);
    void requisicao<{ quote: CotacaoFrete }>(`/api/v1/shipping/quote?postalCode=${address.postalCode}&state=${address.state}`)
      .then((result) => { if (active) setShippingQuote(result.quote); })
      .catch((failure) => { if (active) { setShippingQuote(null); setShippingError(mensagemPublica(failure)); } });
    return () => { active = false; };
  }, [addresses, selectedAddress]);

  const createOrder = async () => {
    if (!selectedAddress || !checkoutDisponivel(cart, selectedAddress) || !paymentAvailability?.methods.some((method) => method.code === payment && method.available)) {
      publicarAviso("Selecione um endereço e mantenha itens no carrinho para continuar.");
      return;
    }
    try {
      const result = await enviarCheckout(requisicao, { addressId: selectedAddress, paymentMethod: payment }, crypto.randomUUID());
      publicarAviso(result.payment.integrationPending ? "Pedido criado e estoque reservado. Nenhuma cobrança foi realizada neste ambiente." : "Pedido criado. Acompanhe a confirmação do pagamento em Meus pedidos.", "success");
      navigate("/pedidos");
    } catch (failure) {
      publicarAviso(mensagemPublica(failure));
    }
  };

  const totalPreview = cart ? cart.subtotalCents + (shippingQuote?.amountCents ?? 0) : 0;
  return <AreaProtegida message="Entre para continuar sua compra com segurança."><PainelPrivado title="Finalizar compra" description="Confirme o endereço e escolha um meio de pagamento realmente disponível.">{loading ? <Carregando /> : !cart?.items.length ? <EstadoVazio title="Seu carrinho está vazio" description="Adicione produtos antes de finalizar a compra." action={<Link className="button button--primary" to="/catalogo">Ver catálogo</Link>} /> : <div className="checkout-grid"><section className="cart-panel"><h2>Endereço de entrega</h2>{addresses.length ? <div className="address-list">{addresses.map((address) => <label className="address-choice" key={address.id}><input type="radio" name="address" checked={selectedAddress === address.id} onChange={() => setSelectedAddress(address.id)} /><span><strong>{address.label}</strong>{addressText(address)}</span></label>)}</div> : <><p>Cadastre um endereço para continuar.</p><FormEndereco saved={load} /></>}</section>{addresses.length ? <section className="cart-panel"><h2>Entrega e pagamento</h2>{shippingQuote ? <div className="shipping-quote"><strong>{shippingQuote.service}</strong><span>{currency(shippingQuote.amountCents)} · estimativa de {shippingQuote.estimatedMinBusinessDays} a {shippingQuote.estimatedMaxBusinessDays} dias úteis</span></div> : shippingError ? <p className="stock stock--unavailable">{shippingError}</p> : <p>Calculando prazo de entrega…</p>}<p className="checkout-payment-message">{paymentAvailability?.message ?? "Consultando meios de pagamento…"}</p><div className="payment-options">{paymentAvailability?.methods.map((method) => <label key={method.code} title={method.reason ?? undefined}><input type="radio" name="payment" disabled={!method.available} checked={payment === method.code} onChange={() => setPayment(method.code)} /><span>{method.label}{!method.available ? " — indisponível" : ""}</span></label>)}</div><div className="cart-summary"><div><span>Produtos</span><strong>{currency(cart.subtotalCents)}</strong></div><div><span>Entrega</span><strong>{shippingQuote ? currency(shippingQuote.amountCents) : "—"}</strong></div><div><span>Total estimado</span><strong>{currency(totalPreview)}</strong></div><button className="button button--primary" type="button" disabled={!shippingQuote || !paymentAvailability?.methods.some((method) => method.code === payment && method.available)} onClick={() => void createOrder()}>Criar pedido</button></div></section> : null}</div>}</PainelPrivado></AreaProtegida>;
}
