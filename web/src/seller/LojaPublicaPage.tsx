import { motion } from "framer-motion";
import { type ReactNode, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { mensagemPublica, requisicao } from "../api";
import { CartaoProduto } from "../catalog/CartaoProduto";
import { Carregando, EstadoVazio } from "../shared/estado";
import { resumoAvaliacao } from "../shared/texto";
import type { ProdutoResumo } from "../types";

type LojaPublica = { description: string | null; id: string; productCount: number; rating: ProdutoResumo["rating"]; storeName: string };

export function LojaPublicaPage(): ReactNode {
  const { id } = useParams();
  const [seller, setSeller] = useState<LojaPublica | null>(null);
  const [products, setProducts] = useState<ProdutoResumo[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let active = true;
    void (async () => {
      setSeller(null); setError(null);
      try {
        const result = await requisicao<{ seller: LojaPublica }>(`/api/v1/sellers/${id}`);
        const catalog = await requisicao<{ items: ProdutoResumo[] }>(`/api/v1/catalog/products?seller=${result.seller.id}&limit=12`);
        if (active) { setSeller(result.seller); setProducts(catalog.items); document.title = `${result.seller.storeName} | EliteHub Connect`; }
      } catch (failure) { if (active) setError(mensagemPublica(failure)); }
    })();
    return () => { active = false; };
  }, [id]);
  if (!id) return <Navigate to="/catalogo" replace />;
  if (error) return <EstadoVazio title="Loja indisponível" description={error} action={<Link className="button button--primary" to="/catalogo">Voltar ao catálogo</Link>} />;
  if (!seller) return <Carregando label="Carregando loja" />;
  const rating = resumoAvaliacao(seller.rating);
  return <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><Link className="back-link" to="/catalogo">Voltar ao catálogo</Link><section className="store-header"><p className="eyebrow">Loja verificada</p><h1>{seller.storeName}</h1>{rating ? <p className="store-header__rating">{rating}</p> : null}<p>{seller.description ?? "Esta loja não informou uma descrição pública."}</p></section><section className="category-section"><p className="eyebrow">{seller.productCount} produtos ativos</p><h2>Produtos desta loja</h2>{products.length ? <div className="product-grid">{products.map((product) => <CartaoProduto product={product} key={product.id} />)}</div> : <EstadoVazio title="Sem produtos ativos" description="Esta loja não possui produtos disponíveis no momento." />}</section></motion.div>;
}
