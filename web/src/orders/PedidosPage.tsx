import { motion } from "framer-motion";
import { type ReactNode, useEffect, useState } from "react";

import { mensagemPublica, requisicao } from "../api";
import { useMercado } from "../app/mercado-context";
import { Carregando, EstadoVazio } from "../shared/estado";
import { currency, date } from "../shared/formatacao";
import { AreaProtegida, PainelPrivado } from "../shared/privado";

type Pedido = { createdAt: string; id: string; number: string; paymentStatus: string; status: string; totalCents: number };

export function PedidosPage(): ReactNode {
  const { user } = useMercado();
  const [scope, setScope] = useState<"mine" | "received">("mine");
  const [items, setItems] = useState<Pedido[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void requisicao<{ items: Pedido[] }>(`/api/v1/orders?scope=${scope}`).then((result) => { setItems(result.items); setError(null); }).catch((failure) => setError(mensagemPublica(failure))); }, [scope]);
  return <AreaProtegida message="Entre para acessar seus pedidos."><PainelPrivado title="Meus pedidos" description="Acompanhe seus pedidos e os respectivos status.">{user?.roles.includes("SELLER") ? <div className="page-tabs" role="tablist"><button type="button" role="tab" aria-selected={scope === "mine"} onClick={() => setScope("mine")}>Minhas compras</button><button type="button" role="tab" aria-selected={scope === "received"} onClick={() => setScope("received")}>Vendas recebidas</button></div> : null}{error ? <EstadoVazio title="Não foi possível carregar os pedidos" description={error} /> : !items ? <Carregando /> : !items.length ? <EstadoVazio title="Você ainda não tem pedidos" description="Quando concluir uma compra, ela aparecerá nesta área." /> : <div className="notification-list">{items.map((item) => <motion.article className="notification-item" key={item.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><div><h2>Pedido {item.number}</h2><p>{currency(item.totalCents)} · {item.status} · pagamento {item.paymentStatus}</p></div><time dateTime={item.createdAt}>{date(item.createdAt)}</time></motion.article>)}</div>}</PainelPrivado></AreaProtegida>;
}
