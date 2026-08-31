import { motion } from "framer-motion";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { mensagemPublica, requisicao } from "../api";
import { Carregando, EstadoVazio } from "../shared/estado";
import { date } from "../shared/formatacao";
import { AreaProtegida, PainelPrivado } from "../shared/privado";

type Notificacao = { body: string; createdAt: string; id: string; linkPath: string | null; readAt: string | null; title: string };

export function NotificacoesPage(): ReactNode {
  const navigate = useNavigate();
  const [items, setItems] = useState<Notificacao[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { const result = await requisicao<{ items: Notificacao[] }>("/api/v1/notifications"); setItems(result.items); } catch (failure) { setError(mensagemPublica(failure)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const open = async (item: Notificacao) => { try { if (!item.readAt) await requisicao(`/api/v1/notifications/${item.id}/read`, { method: "PATCH" }); if (item.linkPath) navigate(item.linkPath); else await load(); } catch (failure) { setError(mensagemPublica(failure)); } };
  return <AreaProtegida message="Entre para acessar suas notificações."><PainelPrivado title="Notificações" description="Atualizações relacionadas à sua conta e aos seus pedidos.">{error ? <EstadoVazio title="Não foi possível carregar as notificações" description={error} /> : !items ? <Carregando /> : !items.length ? <EstadoVazio title="Você não tem notificações" description="Quando houver uma atualização relevante, ela aparecerá aqui." /> : <div className="notification-list">{items.map((item) => <motion.button className={`notification-item notification-button-react ${item.readAt ? "" : "notification-item--unread"}`} type="button" key={item.id} onClick={() => void open(item)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><div><h2>{item.title}</h2><p>{item.body}</p></div><time dateTime={item.createdAt}>{date(item.createdAt)}</time></motion.button>)}</div>}</PainelPrivado></AreaProtegida>;
}
