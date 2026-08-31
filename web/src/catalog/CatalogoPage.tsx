import { LayoutGroup, motion } from "framer-motion";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { mensagemPublica, requisicao } from "../api";
import { EstadoVazio } from "../shared/estado";
import { Icone } from "../shared/icone";
import type { ProdutoResumo } from "../types";
import { CartaoProduto, GradeEsqueleto } from "./CartaoProduto";

type Paginacao = { hasNext: boolean; limit: number; offset: number; total: number };

export function CatalogoPage(): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<ProdutoResumo[]>([]);
  const [page, setPage] = useState<Paginacao | null>(null);
  const [category, setCategory] = useState<string | undefined>();
  const [sort, setSort] = useState("newest");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const term = new URLSearchParams(location.search).get("busca")?.trim() ?? "";

  useEffect(() => { document.title = "EliteHub Connect | Marketplace"; }, []);
  useEffect(() => { void requisicao<{ items: Array<{ id: string; name: string }> }>("/api/v1/catalog/categories").then((result) => setCategories(result.items)).catch(() => setCategories([])); }, []);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const params = new URLSearchParams({ limit: "12", offset: String(offset), sort });
    if (term) params.set("q", term);
    if (category) params.set("category", category);
    if (minimum) params.set("minPriceCents", String(Math.round(Number(minimum) * 100)));
    if (maximum) params.set("maxPriceCents", String(Math.round(Number(maximum) * 100)));
    try {
      const result = await requisicao<{ items: ProdutoResumo[]; page: Paginacao }>(`/api/v1/catalog/products?${params}`);
      setItems(result.items); setPage(result.page);
    } catch (failure) { setError(mensagemPublica(failure)); } finally { setLoading(false); }
  }, [category, maximum, minimum, offset, sort, term]);
  useEffect(() => { void load(); }, [load]);
  const chooseCategory = (value: string | undefined) => { setCategory(value); setOffset(0); };
  const apply = () => { setOffset(0); void load(); };
  const clear = () => { setCategory(undefined); setSort("newest"); setMinimum(""); setMaximum(""); setOffset(0); navigate("/catalogo"); };

  return <motion.div className="catalog-page-react" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
    <section className="hero" aria-labelledby="hero-title"><div className="hero__copy"><p className="eyebrow eyebrow--accent">Marketplace EliteHub</p><h1 id="hero-title">Descubra produtos de lojas que você pode conhecer.</h1><p>Pesquise, compare e visite lojas livremente. O acesso é solicitado apenas no momento da compra.</p><Link className="button button--primary" to="/catalogo">Explorar produtos <Icone nome="arrow" /></Link></div><div className="hero__trust" aria-label="Princípios de compra"><div><span>✓</span>Catálogo aberto</div><div><span>✓</span>Compra com sessão protegida</div><div><span>✓</span>Pagamento validado no servidor</div></div></section>
    <section className="category-section" aria-labelledby="categories-title"><div className="section-heading"><div><p className="eyebrow">Navegue por interesse</p><h2 id="categories-title">Categorias</h2></div></div><LayoutGroup><div className="category-list" aria-label="Categorias do catálogo"><button className="category-chip" type="button" aria-pressed={!category} onClick={() => chooseCategory(undefined)}>Todas</button>{categories.map((item) => <button className="category-chip" type="button" key={item.id} aria-pressed={category === item.id} onClick={() => chooseCategory(item.id)}>{item.name}</button>)}</div></LayoutGroup></section>
    <section className="catalog-layout" aria-labelledby="catalog-title"><aside className="catalog-filters" aria-labelledby="filters-title"><div className="filter-heading"><h2 id="filters-title">Filtrar</h2><button className="text-button" type="button" onClick={clear}>Limpar</button></div><label className="field-group"><span>Ordenar por</span><select value={sort} onChange={(event) => { setSort(event.target.value); setOffset(0); }}><option value="newest">Mais recentes</option><option value="relevance">Mais relevantes</option><option value="price_asc">Menor preço</option><option value="price_desc">Maior preço</option></select></label><fieldset className="price-filter"><legend>Faixa de preço</legend><label>Mínimo<input inputMode="numeric" type="number" min="0" step="1" value={minimum} onChange={(event) => setMinimum(event.target.value)} placeholder="R$ 0" /></label><label>Máximo<input inputMode="numeric" type="number" min="0" step="1" value={maximum} onChange={(event) => setMaximum(event.target.value)} placeholder="Sem limite" /></label><button className="button button--secondary" type="button" onClick={apply}>Aplicar filtros</button></fieldset></aside><div className="catalog-content"><div className="catalog-toolbar"><div><p className="eyebrow">Catálogo público</p><h2 id="catalog-title">{term ? `Resultados para “${term}”` : "Produtos para explorar"}</h2><p className="catalog-summary">{page ? `${page.total} ${page.total === 1 ? "produto encontrado" : "produtos encontrados"}` : "Carregando catálogo…"}</p></div><button className="icon-text-button" type="button" onClick={() => void load()}>Atualizar</button></div>{loading ? <GradeEsqueleto /> : error ? <EstadoVazio title="Não foi possível carregar o catálogo" description={error} action={<button className="button button--primary" type="button" onClick={() => void load()}>Tentar novamente</button>} /> : items.length ? <motion.section className="product-grid" aria-live="polite" aria-busy={loading} layout>{items.map((product) => <CartaoProduto key={product.id} product={product} />)}</motion.section> : <EstadoVazio title="Nenhum produto encontrado" description="Tente remover filtros ou pesquisar outro termo." />}{page && page.total > page.limit ? <nav className="pagination" aria-label="Paginação"><button type="button" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - page.limit))}>Anterior</button><span>Página {Math.floor(offset / page.limit) + 1}</span><button type="button" disabled={!page.hasNext} onClick={() => setOffset((value) => value + page.limit)}>Próxima</button></nav> : null}</div></section>
  </motion.div>;
}
