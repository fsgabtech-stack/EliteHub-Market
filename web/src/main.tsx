import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../../static/elitehub.css";
import "../../static/motion.css";
import "./react-app.css";
import { Aplicacao } from "./Aplicacao";

const container = document.getElementById("root");
if (!container) throw new Error("O elemento raiz da EliteHub não foi encontrado.");

createRoot(container).render(
  <StrictMode>
    <Aplicacao />
  </StrictMode>,
);
