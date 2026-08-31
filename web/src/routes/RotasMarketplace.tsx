import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { lazy, Suspense, type ReactNode } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import { Carregando } from "../shared/estado";

const CatalogoPage = lazy(async () => import("../catalog/CatalogoPage").then((module) => ({ default: module.CatalogoPage })));
const ProdutoDetalhePage = lazy(async () => import("../product/ProdutoDetalhePage").then((module) => ({ default: module.ProdutoDetalhePage })));
const LojaPublicaPage = lazy(async () => import("../seller/LojaPublicaPage").then((module) => ({ default: module.LojaPublicaPage })));
const CarrinhoPage = lazy(async () => import("../cart/CarrinhoPage").then((module) => ({ default: module.CarrinhoPage })));
const CheckoutPage = lazy(async () => import("../checkout/CheckoutPage").then((module) => ({ default: module.CheckoutPage })));
const FavoritosPage = lazy(async () => import("../favorites/FavoritosPage").then((module) => ({ default: module.FavoritosPage })));
const NotificacoesPage = lazy(async () => import("../notifications/NotificacoesPage").then((module) => ({ default: module.NotificacoesPage })));
const PedidosPage = lazy(async () => import("../orders/PedidosPage").then((module) => ({ default: module.PedidosPage })));
const ContaPage = lazy(async () => import("../account/ContaPage").then((module) => ({ default: module.ContaPage })));
const VendedorPage = lazy(async () => import("../seller/VendedorPage").then((module) => ({ default: module.VendedorPage })));
const AdministracaoPage = lazy(async () => import("../admin/AdministracaoPage").then((module) => ({ default: module.AdministracaoPage })));
const AjudaPage = lazy(async () => import("../pages/AjudaPage").then((module) => ({ default: module.AjudaPage })));
const PaginaNaoEncontrada = lazy(async () => import("../pages/PaginaNaoEncontrada").then((module) => ({ default: module.PaginaNaoEncontrada })));

export function RotasMarketplace(): ReactNode {
  const location = useLocation();
  const reduced = useReducedMotion();
  const fallback = <Carregando label="Carregando área" />;
  return <AnimatePresence mode="wait"><motion.div className="route-page-react" key={location.pathname} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ type: "spring", stiffness: 330, damping: 32 }}><Suspense fallback={fallback}><Routes location={location}><Route path="/" element={<CatalogoPage />} /><Route path="/catalogo" element={<CatalogoPage />} /><Route path="/produto/:id" element={<ProdutoDetalhePage />} /><Route path="/loja/:id" element={<LojaPublicaPage />} /><Route path="/carrinho" element={<CarrinhoPage />} /><Route path="/checkout" element={<CheckoutPage />} /><Route path="/favoritos" element={<FavoritosPage />} /><Route path="/notificacoes" element={<NotificacoesPage />} /><Route path="/pedidos" element={<PedidosPage />} /><Route path="/conta" element={<ContaPage />} /><Route path="/vendedor" element={<VendedorPage />} /><Route path="/admin" element={<AdministracaoPage />} /><Route path="/ajuda" element={<AjudaPage />} /><Route path="*" element={<PaginaNaoEncontrada />} /></Routes></Suspense></motion.div></AnimatePresence>;
}
