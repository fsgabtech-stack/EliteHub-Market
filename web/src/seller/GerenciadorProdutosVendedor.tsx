import { type ChangeEvent, type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";

import { mensagemPublica, requisicao } from "../api";
import { useMercado } from "../app/mercado-context";
import { Carregando, EstadoVazio } from "../shared/estado";
import { currency } from "../shared/formatacao";

type Categoria = { id: string; name: string };
type Variacao = { attributes: Record<string, unknown>; id: string; priceCents: number | null; sku: string | null; stockQuantity: number };
type Produto = {
  attributes: Record<string, unknown>;
  category: Categoria | null;
  description: string;
  id: string;
  imageUrl: string | null;
  priceCents: number;
  sku: string | null;
  status: "ACTIVE" | "ARCHIVED" | "DRAFT" | "PAUSED";
  stockQuantity: number;
  title: string;
  variants: Variacao[];
};

type DadosProduto = {
  attributes: Record<string, unknown>;
  categoryId: string | null;
  description: string;
  priceCents: number;
  sku?: string | undefined;
  status: Produto["status"];
  stockQuantity: number;
  title: string;
};

function emCentavos(value: FormDataEntryValue | null): number {
  const parsed = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Informe um preço válido.");
  return Math.round(parsed * 100);
}

function jsonObject(value: FormDataEntryValue | null): Record<string, unknown> {
  const text = String(value ?? "").trim();
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Atributos devem ser um objeto JSON válido.");
  return parsed as Record<string, unknown>;
}

function productData(form: HTMLFormElement): DadosProduto {
  const data = new FormData(form);
  return {
    attributes: jsonObject(data.get("attributes")),
    categoryId: String(data.get("categoryId") ?? "") || null,
    description: String(data.get("description") ?? "").trim(),
    priceCents: emCentavos(data.get("price")),
    sku: String(data.get("sku") ?? "").trim() || undefined,
    status: String(data.get("status") ?? "DRAFT") as Produto["status"],
    stockQuantity: Math.max(0, Number.parseInt(String(data.get("stockQuantity") ?? "0"), 10) || 0),
    title: String(data.get("title") ?? "").trim(),
  };
}

function rotuloStatus(value: Produto["status"]): string {
  return ({ ACTIVE: "Publicado", ARCHIVED: "Arquivado", DRAFT: "Rascunho", PAUSED: "Pausado" } as const)[value];
}

function FormularioProduto({ categorias, initial, saving, submit }: { categorias: Categoria[]; initial?: Produto; saving: boolean; submit: (data: DadosProduto, image: File | null) => Promise<void> }): ReactNode {
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("image");
    await submit(productData(event.currentTarget), file instanceof File && file.size > 0 ? file : null);
  };
  return <form className="form-stack seller-product-form-react" onSubmit={(event) => void onSubmit(event)}>
    <label className="field-group"><span>Título</span><input name="title" defaultValue={initial?.title} minLength={3} maxLength={200} required /></label>
    <label className="field-group"><span>Categoria</span><select name="categoryId" defaultValue={initial?.category?.id ?? ""}><option value="">Sem categoria</option>{categorias.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
    <label className="field-group"><span>Preço em reais</span><input name="price" defaultValue={initial ? (initial.priceCents / 100).toFixed(2) : ""} min="0" step="0.01" type="number" required /></label>
    <label className="field-group"><span>Estoque {initial ? "atual" : "inicial"}</span><input name="stockQuantity" defaultValue={initial?.stockQuantity ?? 0} min="0" step="1" type="number" disabled={Boolean(initial)} required /></label>
    <label className="field-group"><span>SKU</span><input name="sku" defaultValue={initial?.sku ?? ""} maxLength={100} /></label>
    <label className="field-group"><span>Situação</span><select name="status" defaultValue={initial?.status ?? "DRAFT"}><option value="DRAFT">Rascunho</option><option value="ACTIVE">Publicado</option><option value="PAUSED">Pausado</option><option value="ARCHIVED">Arquivado</option></select></label>
    <label className="field-group seller-product-form-react__wide"><span>Descrição</span><textarea name="description" defaultValue={initial?.description} minLength={20} maxLength={20_000} required /></label>
    <label className="field-group seller-product-form-react__wide"><span>Atributos em JSON</span><textarea name="attributes" defaultValue={initial ? JSON.stringify(initial.attributes) : "{}"} aria-describedby="seller-json-help" /><small id="seller-json-help">Exemplo: {"{\"Cor\":\"Azul\",\"Garantia\":\"12 meses\"}"}</small></label>
    {!initial ? <label className="field-group seller-product-form-react__wide"><span>Imagem</span><input accept="image/jpeg,image/png,image/webp" name="image" type="file" /><small>JPEG, PNG ou WebP, até 10 MB. Produtos publicados precisam de imagem real.</small></label> : null}
    <button className="button button--primary seller-product-form-react__wide" type="submit" disabled={saving}>{saving ? "Salvando…" : initial ? "Salvar alterações" : "Criar produto"}</button>
  </form>;
}

export function GerenciadorProdutosVendedor(): ReactNode {
  const { publicarAviso } = useMercado();
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [productResult, categoryResult] = await Promise.all([
        requisicao<{ items: Produto[] }>("/api/v1/seller/products?limit=100"),
        requisicao<{ items: Categoria[] }>("/api/v1/catalog/categories"),
      ]);
      setProdutos(productResult.items);
      setCategorias(categoryResult.items);
    } catch (error) {
      publicarAviso(mensagemPublica(error));
      setProdutos([]);
    }
  }, [publicarAviso]);

  useEffect(() => { void load(); }, [load]);

  const enviarImagem = async (id: string, image: File) => {
    const form = new FormData();
    form.set("file", image);
    await requisicao(`/api/v1/seller/products/${id}/images`, { body: form, method: "POST" });
  };

  const create = async (data: DadosProduto, image: File | null) => {
    setSaving(true);
    try {
      const result = await requisicao<{ id: string }>("/api/v1/seller/products", { body: JSON.stringify(data), method: "POST" });
      if (image) await enviarImagem(result.id, image);
      publicarAviso("Produto criado e persistido na sua loja.", "success");
      await load();
    } catch (error) { publicarAviso(error instanceof Error ? error.message : mensagemPublica(error)); } finally { setSaving(false); }
  };

  const update = async (product: Produto, data: DadosProduto) => {
    setSaving(true);
    try {
      const { stockQuantity: _stockQuantity, ...payload } = data;
      await requisicao(`/api/v1/seller/products/${product.id}`, { body: JSON.stringify(payload), method: "PUT" });
      setEditing(null);
      publicarAviso("Produto atualizado.", "success");
      await load();
    } catch (error) { publicarAviso(error instanceof Error ? error.message : mensagemPublica(error)); } finally { setSaving(false); }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>, id: string) => {
    const image = event.currentTarget.files?.[0];
    if (!image) return;
    try { await enviarImagem(id, image); publicarAviso("Imagem enviada.", "success"); await load(); } catch (error) { publicarAviso(mensagemPublica(error)); } finally { event.currentTarget.value = ""; }
  };

  const addVariant = async (event: FormEvent<HTMLFormElement>, product: Produto) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await requisicao(`/api/v1/seller/products/${product.id}/variants`, { body: JSON.stringify({ attributes: jsonObject(data.get("attributes")), priceCents: data.get("price") ? emCentavos(data.get("price")) : null, sku: String(data.get("sku") ?? "").trim() || undefined, stockQuantity: Math.max(0, Number.parseInt(String(data.get("stockQuantity") ?? "0"), 10) || 0) }), method: "POST" });
      event.currentTarget.reset(); publicarAviso("Variação adicionada.", "success"); await load();
    } catch (error) { publicarAviso(error instanceof Error ? error.message : mensagemPublica(error)); }
  };

  const adjustStock = async (event: FormEvent<HTMLFormElement>, product: Produto) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const delta = Number.parseInt(String(data.get("delta") ?? "0"), 10);
    if (!delta) { publicarAviso("O ajuste de estoque deve ser diferente de zero."); return; }
    try {
      await requisicao(`/api/v1/seller/products/${product.id}/stock-adjustments`, { body: JSON.stringify({ delta, reason: String(data.get("reason") ?? "").trim(), variantId: String(data.get("variantId") ?? "") || undefined }), method: "POST" });
      event.currentTarget.reset(); publicarAviso("Estoque ajustado com auditoria.", "success"); await load();
    } catch (error) { publicarAviso(mensagemPublica(error)); }
  };

  return <>
    <section className="info-panel seller-section-react"><p className="eyebrow">Novo catálogo</p><h2>Criar produto</h2><FormularioProduto categorias={categorias} saving={saving} submit={create} /></section>
    <section className="seller-section-react" aria-labelledby="seller-products-title"><div className="section-heading"><div><p className="eyebrow">{produtos?.length ?? 0} produtos próprios</p><h2 id="seller-products-title">Produtos, variações e estoque</h2></div></div>{!produtos ? <Carregando label="Carregando produtos da loja" /> : produtos.length === 0 ? <EstadoVazio title="Sua loja ainda não possui produtos" description="Crie o primeiro produto acima. Ele será persistido no banco." /> : <div className="seller-product-list-react">{produtos.map((product) => <article className="info-panel seller-product-card-react" key={product.id}>
      <div className="seller-product-card-react__head">{product.imageUrl ? <img src={product.imageUrl} alt={`Imagem de ${product.title}`} loading="lazy" decoding="async" /> : <div className="seller-product-card-react__empty-image">Sem imagem</div>}<div><p className="eyebrow">{rotuloStatus(product.status)} · {product.stockQuantity <= 5 ? "Estoque crítico" : "Estoque regular"}</p><h3>{product.title}</h3><p>{currency(product.priceCents)} · {product.stockQuantity} unidades no estoque principal</p></div></div>
      <div className="seller-product-actions-react"><button className="button button--secondary" type="button" onClick={() => setEditing((current) => current === product.id ? null : product.id)}>{editing === product.id ? "Fechar edição" : "Editar"}</button><label className="button button--secondary seller-upload-button-react">Enviar imagem<input accept="image/jpeg,image/png,image/webp" aria-label={`Enviar imagem de ${product.title}`} type="file" onChange={(event) => void upload(event, product.id)} /></label></div>
      {editing === product.id ? <FormularioProduto categorias={categorias} initial={product} saving={saving} submit={(data) => update(product, data)} /> : null}
      <details className="seller-details-react"><summary>Variações ({product.variants.length})</summary>{product.variants.length ? <ul>{product.variants.map((variant) => <li key={variant.id}>{Object.values(variant.attributes).map(String).join(" · ") || "Variação"} · {variant.sku ?? "Sem SKU"} · {variant.stockQuantity} unidades</li>)}</ul> : <p>Sem variações cadastradas.</p>}<form className="seller-inline-form-react" onSubmit={(event) => void addVariant(event, product)}><label><span>Atributos JSON</span><input name="attributes" placeholder='{"Cor":"Azul"}' required /></label><label><span>SKU</span><input name="sku" /></label><label><span>Preço</span><input name="price" min="0" step="0.01" type="number" /></label><label><span>Saldo</span><input name="stockQuantity" min="0" step="1" type="number" defaultValue="0" required /></label><button className="button button--secondary" type="submit">Adicionar variação</button></form></details>
      <details className="seller-details-react"><summary>Ajustar estoque</summary><form className="seller-inline-form-react" onSubmit={(event) => void adjustStock(event, product)}><label><span>Item</span><select name="variantId"><option value="">Produto principal</option>{product.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.sku ?? "Variação"}</option>)}</select></label><label><span>Ajuste</span><input name="delta" placeholder="Ex.: 10 ou -2" step="1" type="number" required /></label><label><span>Motivo</span><input name="reason" minLength={3} maxLength={40} placeholder="Reposição" required /></label><button className="button button--secondary" type="submit">Registrar ajuste</button></form></details>
    </article>)}</div>}</section>
  </>;
}
