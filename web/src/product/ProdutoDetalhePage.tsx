import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { mensagemPublica, requisicao } from "../api";
import { useMercado } from "../app/mercado-context";
import { CartaoProduto } from "../catalog/CartaoProduto";
import { Carregando, EstadoVazio } from "../shared/estado";
import { availability, currency, date } from "../shared/formatacao";
import { Icone } from "../shared/icone";
import { resumoAvaliacao } from "../shared/texto";
import type { Produto, ProdutoResumo } from "../types";

type AvaliacaoPublica = { authorName: string; createdAt: string; id: string; rating: number; text: string; title: string };

export function ProdutoDetalhePage(): ReactNode {
  const { id } = useParams();
  const { adicionarAoCarrinho, favoritos, publicarAviso, toggleFavorito } = useMercado();
  const [product, setProduct] = useState<Produto | null>(null);
  const [reviews, setReviews] = useState<AvaliacaoPublica[]>([]);
  const [related, setRelated] = useState<ProdutoResumo[]>([]);
  const [selectedImage, setSelectedImage] = useState(0);
  const [variantId, setVariantId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    void (async () => {
      setProduct(null); setReviews([]); setRelated([]); setError(null); setSelectedImage(0); setVariantId(undefined);
      try {
        const response = await requisicao<{ product: Produto }>(`/api/v1/catalog/products/${id}`);
        if (!active) return;
        setProduct(response.product);
        document.title = `${response.product.title} | EliteHub Connect`;
        const [reviewResponse, relatedResponse] = await Promise.all([
          requisicao<{ items: AvaliacaoPublica[] }>(`/api/v1/products/${id}/reviews?limit=5`).catch(() => ({ items: [] })),
          response.product.category?.id ? requisicao<{ items: ProdutoResumo[] }>(`/api/v1/catalog/products?category=${response.product.category.id}&limit=4`).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        ]);
        if (active) { setReviews(reviewResponse.items); setRelated(relatedResponse.items.filter((item) => item.id !== response.product.id)); }
      } catch (failure) { if (active) setError(mensagemPublica(failure)); }
    })();
    return () => { active = false; };
  }, [id]);
  if (!id) return <Navigate to="/catalogo" replace />;
  if (error) return <EstadoVazio title="Produto indisponível" description={error} action={<Link className="button button--primary" to="/catalogo">Voltar ao catálogo</Link>} />;
  if (!product) return <Carregando label="Carregando produto" />;
  const images = [...new Set([product.imageUrl, ...product.images.map((image) => image.url)].filter((image): image is string => Boolean(image)))];
  const variant = product.variants.find((item) => item.id === variantId);
  const selectedAvailability = variant?.availability ?? product.availability;
  const selectedPrice = variant?.priceCents ?? product.priceCents;
  const unavailable = selectedAvailability === "OUT_OF_STOCK";
  const rating = resumoAvaliacao(product.rating);
  const sharing = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ text: `Confira ${product.title} na EliteHub Connect.`, title: product.title, url });
      else if (navigator.clipboard) { await navigator.clipboard.writeText(url); publicarAviso("Link do produto copiado.", "success"); }
      else publicarAviso("Não foi possível compartilhar neste navegador.");
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError") return;
      publicarAviso("Não foi possível compartilhar o produto.");
    }
  };
  return <motion.div className="detail-page-react" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 310, damping: 31 }}>
    <Link className="back-link" to="/catalogo">Voltar ao catálogo</Link>
    <section className="detail-layout"><div className="product-gallery"><div className="product-gallery__main"><AnimatePresence mode="wait">{images[selectedImage] ? <motion.img key={images[selectedImage]} src={images[selectedImage]} alt={product.title} initial={{ opacity: 0, scale: 1.025 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.985 }} transition={{ duration: 0.2 }} /> : <span className="product-gallery__fallback">Imagem indisponível</span>}</AnimatePresence></div>{images.length > 1 ? <div className="gallery-thumbs">{images.map((image, index) => <button key={image} type="button" aria-label={`Ver imagem ${index + 1}`} aria-pressed={index === selectedImage} onClick={() => setSelectedImage(index)}><img src={image} alt={`${product.title} - imagem ${index + 1}`} /></button>)}</div> : null}</div>
      <div className="product-info"><p className="eyebrow">{product.category?.name ?? "Produto"}</p><h1>{product.title}</h1><p className="product-info__price">{currency(selectedPrice)}</p>{rating ? <p className="rating-summary">{rating}</p> : null}<p className={`stock ${unavailable ? "stock--unavailable" : "stock--available"}`}>{availability(selectedAvailability)}</p><Link className="product-info__seller" to={`/loja/${product.seller.id}`}>Vendido por {product.seller.name}</Link><p className="product-info__description">{product.description}</p>{product.variants.length ? <div><p className="eyebrow">Variações</p><div className="variant-list">{product.variants.map((item) => <button key={item.id} type="button" aria-pressed={variantId === item.id} onClick={() => setVariantId(item.id)}>{Object.values(item.attributes).map(String).join(" · ") || "Variação"}</button>)}</div></div> : null}<div className="product-actions"><button className="button button--secondary" type="button" disabled={unavailable} onClick={() => void adicionarAoCarrinho(product.id, variantId, "/carrinho")}>Adicionar ao carrinho</button><button className="button button--primary" type="button" disabled={unavailable} onClick={() => void adicionarAoCarrinho(product.id, variantId, "/checkout")}>Comprar agora</button></div><div className="product-utility"><button className="button button--secondary" type="button" onClick={() => void toggleFavorito(product.id)}><Icone nome="heart" ativo={favoritos.has(product.id)} />{favoritos.has(product.id) ? "Remover dos favoritos" : "Salvar nos favoritos"}</button><button className="button button--secondary" type="button" onClick={() => void sharing()}><Icone nome="share" />Compartilhar</button></div>{Object.keys(product.attributes).length ? <section className="info-panel"><h2>Detalhes do produto</h2><dl>{Object.entries(product.attributes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd></div>)}</dl></section> : null}</div>
    </section>
    {reviews.length ? <section className="review-section" aria-labelledby="reviews-title-react"><p className="eyebrow">{rating}</p><h2 id="reviews-title-react">Avaliações de compradores</h2><div className="review-list">{reviews.map((review) => <motion.article className="review-card" key={review.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><p className="review-card__rating">★ {review.rating}/5</p><h3>{review.title}</h3><p>{review.text}</p><p className="review-card__meta">{review.authorName} · {date(review.createdAt)} · Compra verificada</p></motion.article>)}</div></section> : null}
    {related.length ? <section className="category-section"><p className="eyebrow">Mais desta categoria</p><h2>Produtos relacionados</h2><div className="product-grid">{related.map((item) => <CartaoProduto product={item} key={item.id} />)}</div></section> : null}
  </motion.div>;
}
