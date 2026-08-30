import { documentoOpenApi } from "../openapi.js";

const requiredPaths = [
  "/api/v1/health",
  "/api/v1/catalog/products",
  "/api/v1/catalog/search-suggestions",
  "/api/v1/sellers/{id}",
  "/api/v1/favorites",
  "/api/v1/notifications",
  "/api/v1/cart",
  "/api/v1/checkout",
  "/api/v1/payments/webhooks/{provedor}",
];

if (documentoOpenApi.openapi !== "3.1.0" || requiredPaths.some((path) => !(path in documentoOpenApi.paths))) {
  throw new Error("O documento OpenAPI não contém os contratos mínimos obrigatórios.");
}

console.log("Documento OpenAPI validado.");
