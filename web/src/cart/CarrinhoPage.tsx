import { type ReactNode, useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";

import { mensagemPublica, requisicao } from "../api";
import { definirQuantidade, removerItem } from "./operacoes";
import { AreaProtegida, PainelPrivado } from "../shared/privado";
import { Carregando, EstadoVazio } from "../shared/estado";
import { currency } from "../shared/formatacao";
import type { Carrinho } from "../types";

export function CarrinhoPage(): ReactNode {
  const [cart, setCart] = useState<Carrinho | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await requisicao<{ cart: Carrinho }>("/api/v1/cart");
      setCart(result.cart);
    } catch (failure) {
      setError(mensagemPublica(failure));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const remove = async (id: string) => {
    try {
      setCart(await removerItem(requisicao, id));
    } catch (failure) {
      setError(mensagemPublica(failure));
    }
  };
  const setQuantity = async (item: Carrinho["items"][number], quantity: number) => {
    if (quantity < 1) {
      await remove(item.id);
      return;
    }
    try {
      setCart(await definirQuantidade(requisicao, item, quantity));
    } catch (failure) {
      setError(mensagemPublica(failure));
    }
  };

  return <AreaProtegida message="Entre para acessar seu carrinho."><PainelPrivado title="Meu carrinho" description="Seus itens são vinculados à sua sessão segura.">{error ? <EstadoVazio title="Não foi possível carregar o carrinho" description={error} /> : !cart ? <Carregando /> : !cart.items.length ? <EstadoVazio title="Seu carrinho está vazio" description="Explore o catálogo para adicionar produtos." action={<Link className="button button--primary" to="/catalogo">Explorar catálogo</Link>} /> : <><div className="cart-list">{cart.items.map((item) => <motion.article className="cart-item" key={item.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -16 }}><>{item.imageUrl ? <img src={item.imageUrl} alt={item.product.title} /> : <div className="product-card__image">Sem imagem</div>}</><div><h2>{item.product.title}</h2><div className="quantity-control-react" aria-label={`Quantidade de ${item.product.title}`}><button type="button" onClick={() => void setQuantity(item, item.quantity - 1)} aria-label="Diminuir quantidade">−</button><output>{item.quantity}</output><button type="button" disabled={item.quantity >= item.stockQuantity} onClick={() => void setQuantity(item, item.quantity + 1)} aria-label="Aumentar quantidade">+</button></div>{item.variant ? <p>Variação: {Object.values(item.variant.attributes).map(String).join(" · ")}</p> : null}</div><div><p className="cart-item__price">{currency(item.unitPriceCents * item.quantity)}</p><button className="text-button" type="button" onClick={() => void remove(item.id)}>Remover</button></div></motion.article>)}</div><div className="cart-summary"><div><span>Subtotal</span><strong>{currency(cart.subtotalCents)}</strong></div><Link className="button button--primary" to="/checkout">Continuar compra</Link></div></>}</PainelPrivado></AreaProtegida>;
}
