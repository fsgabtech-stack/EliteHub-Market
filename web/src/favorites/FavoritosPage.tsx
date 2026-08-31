import { motion } from "framer-motion";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { mensagemPublica, requisicao } from "../api";
import { AreaProtegida, PainelPrivado } from "../shared/privado";
import { Carregando, EstadoVazio } from "../shared/estado";
import { currency } from "../shared/formatacao";

type Favorito = { id: string; imageUrl: string | null; priceCents: number; title: string };

export function FavoritosPage(): ReactNode {
  const [items, setItems] = useState<Favorito[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void requisicao<{ items: Favorito[] }>("/api/v1/favorites").then((result) => setItems(result.items)).catch((failure) => setError(mensagemPublica(failure))); }, []);
  return <AreaProtegida message="Entre para acessar seus favoritos."><PainelPrivado title="Favoritos" description="Produtos salvos para consultar depois.">{error ? <EstadoVazio title="Não foi possível carregar os favoritos" description={error} /> : !items ? <Carregando /> : !items.length ? <EstadoVazio title="Você ainda não salvou produtos" description="Use o ícone de coração em qualquer produto do catálogo." /> : <div className="product-grid">{items.map((item) => <motion.article className="product-card" key={item.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><Link className="product-card__link" to={`/produto/${item.id}`}><div className="product-card__image">{item.imageUrl ? <img src={item.imageUrl} alt={item.title} /> : "Imagem indisponível"}</div><div className="product-card__content"><h2 className="product-card__title">{item.title}</h2><p className="product-card__price">{currency(item.priceCents)}</p></div></Link></motion.article>)}</div>}</PainelPrivado></AreaProtegida>;
}
