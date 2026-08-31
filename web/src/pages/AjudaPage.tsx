import { type ReactNode, useEffect } from "react";

export function AjudaPage(): ReactNode {
  useEffect(() => { document.title = "Ajuda | EliteHub Connect"; }, []);
  return <section className="legal-page"><h1>Ajuda</h1><section id="entregas"><h2>Entrega e compra</h2><p>Consulte os dados de entrega no checkout. A EliteHub calcula preço, estoque e pagamento no servidor antes de criar um pedido.</p></section><section><h2>Segurança da conta</h2><p>Use uma senha forte, confirme seu e-mail e nunca compartilhe códigos, cookies ou credenciais de pagamento.</p></section><section><h2>Atendimento</h2><p>As integrações de suporte dependem da operação habilitada pela plataforma.</p></section></section>;
}
