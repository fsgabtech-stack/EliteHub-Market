import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";

import { ProvedorMercado } from "./app/ProvedorMercado";
import { RotasMarketplace } from "./routes/RotasMarketplace";

export function Aplicacao(): ReactNode {
  return <BrowserRouter><ProvedorMercado><RotasMarketplace /></ProvedorMercado></BrowserRouter>;
}
