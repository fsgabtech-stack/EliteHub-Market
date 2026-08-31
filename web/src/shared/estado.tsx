import type { ReactNode } from "react";

export function Carregando({ label = "Carregando" }: { label?: string }): ReactNode {
  return <div className="route-loading" role="status" aria-live="polite"><span className="route-loading__dot" />{label}…</div>;
}

export function EstadoVazio({ action, description, title }: { action?: ReactNode; description: string; title: string }): ReactNode {
  return <section className="empty-state"><h2>{title}</h2><p>{description}</p>{action}</section>;
}
