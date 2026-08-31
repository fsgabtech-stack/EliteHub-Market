import type { PropsWithChildren, ReactNode } from "react";
import { motion } from "framer-motion";
import { Link, useLocation } from "react-router-dom";

import { useMercado } from "../app/mercado-context";
import { ConteudoProtegido } from "../routes/ConteudoProtegido";
import { Carregando } from "./estado";

export function AreaProtegida({ children, message }: PropsWithChildren<{ message: string }>): ReactNode {
  const { abrirRotaProtegida, sessaoVerificada, user } = useMercado();
  const location = useLocation();
  if (!sessaoVerificada) return <Carregando label="Verificando sessão" />;
  return <ConteudoProtegido authenticated={Boolean(user)} destination={`${location.pathname}${location.search}`} fallback={<Carregando label="Aguardando autenticação" />} message={message} onRequireAuthentication={abrirRotaProtegida}>{children}</ConteudoProtegido>;
}

export function PainelPrivado({ children, description, title }: PropsWithChildren<{ description: string; title: string }>): ReactNode {
  return <motion.section className="account-panel" initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 320, damping: 30 }}><Link className="back-link" to="/catalogo">Voltar ao catálogo</Link><h1>{title}</h1><p>{description}</p>{children}</motion.section>;
}
