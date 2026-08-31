import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

export type NomeIcone = "arrow" | "bell" | "cart" | "close" | "heart" | "location" | "menu" | "search" | "share" | "user";

const desenhos: Record<NomeIcone, ReactNode> = {
  arrow: <path d="m9 18 6-6-6-6" />,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  cart: <><path d="M3 4h2l2.1 10.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 1.9-1.4L20 8H6" /><circle cx="9" cy="20" r="1" /><circle cx="17" cy="20" r="1" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  heart: <path d="M20.8 4.8a5.4 5.4 0 0 0-7.6 0L12 6l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.6a5.4 5.4 0 0 0 0-7.6Z" />,
  location: <><path d="M20 10c0 5.25-8 10-8 10S4 15.25 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
};

export function Icone({ ativo = false, nome }: { ativo?: boolean; nome: NomeIcone }): ReactNode {
  const reduzirMovimento = useReducedMotion();
  const pulsarFavorito = nome === "heart" && ativo && !reduzirMovimento;
  return <motion.svg
    aria-hidden="true"
    className={`icone icone--${nome}`}
    data-ativo={ativo || undefined}
    viewBox="0 0 24 24"
    animate={pulsarFavorito ? { scale: [1, 1.16, 1] } : { scale: 1 }}
    transition={pulsarFavorito ? { duration: 0.28, ease: "easeOut" } : { duration: 0.01 }}
  >{desenhos[nome]}</motion.svg>;
}

export function MarcaGoogle(): ReactNode {
  return <svg className="provider-mark provider-mark--google" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3.2-4.4 3.2-7.3Z" /><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.5L15.4 17a6 6 0 0 1-8.9-3.2H3.2a10 10 0 0 0 0 8.8l3.3-2.6Z" /><path fill="#FBBC05" d="M6.5 13.8a6 6 0 0 1 0-3.6V7.6H3.2a10 10 0 0 0 0 8.8l3.3-2.6Z" /><path fill="#EA4335" d="M12 6a5.4 5.4 0 0 1 3.8 1.5l2.9-2.9A10 10 0 0 0 3.2 7.6l3.3 2.6A6 6 0 0 1 12 6Z" /></svg>;
}

export function MarcaMicrosoft(): ReactNode {
  return <svg className="provider-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="#F25022" d="M2 2h9.5v9.5H2z" /><path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" /><path fill="#00A4EF" d="M2 12.5h9.5V22H2z" /><path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" /></svg>;
}
