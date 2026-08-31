import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useMercado } from "../app/mercado-context";
import { availability, currency } from "../shared/formatacao";
import { Icone } from "../shared/icone";
import { resumoAvaliacao } from "../shared/texto";
import type { ProdutoResumo } from "../types";

export function CartaoProduto({ product }: { product: ProdutoResumo }): ReactNode {
  const { favoritos, toggleFavorito } = useMercado();
  const favorito = favoritos.has(product.id);
  const avaliacao = resumoAvaliacao(product.rating);
  return <motion.article layout="position" className="product-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 360, damping: 30 }}>
    <motion.button className="icon-button card-favorite" type="button" aria-label={favorito ? "Remover dos favoritos" : "Salvar nos favoritos"} aria-pressed={favorito} title={favorito ? "Remover dos favoritos" : "Salvar nos favoritos"} onClick={() => void toggleFavorito(product.id)} whileTap={{ scale: 0.92 }}><Icone nome="heart" ativo={favorito} /></motion.button>
    <Link className="product-card__link" to={`/produto/${product.id}`} aria-label={`Ver detalhes de ${product.title}`}><div className="product-card__image">{product.imageUrl ? <img src={product.imageUrl} alt={product.title} loading="lazy" /> : "Imagem indisponível"}</div><div className="product-card__content"><h3 className="product-card__title">{product.title}</h3><p className="product-card__price">{currency(product.priceCents)}</p><p className="product-card__meta">{product.category?.name ?? "Sem categoria"}</p>{avaliacao ? <p className="product-card__rating" aria-label={`Avaliação média: ${avaliacao}`}>{avaliacao}</p> : null}</div></Link>
    <Link className="product-card__seller" to={`/loja/${product.seller.id}`}>{product.seller.name}</Link><p className={`stock ${product.availability === "OUT_OF_STOCK" ? "stock--unavailable" : "stock--available"}`}>{availability(product.availability)}</p>
  </motion.article>;
}

export function GradeEsqueleto(): ReactNode {
  return <section className="product-grid" aria-label="Carregando produtos" aria-busy="true">{Array.from({ length: 8 }, (_, index) => <article className="product-card product-card--skeleton" key={index}><div className="skeleton-image" /><div className="skeleton-line" /><div className="skeleton-line skeleton-line--short" /></article>)}</section>;
}
