import { config } from "../../config.js";
import { AppError } from "../../http/errors.js";

export type CotacaoFrete = {
  amountCents: number;
  estimatedMaxBusinessDays: number;
  estimatedMinBusinessDays: number;
  region: "CENTRO_OESTE" | "NORDESTE" | "NORTE" | "SUDESTE" | "SUL";
  service: string;
};

const estadosPorRegiao: Readonly<Record<CotacaoFrete["region"], readonly string[]>> = {
  CENTRO_OESTE: ["DF", "GO", "MS", "MT"],
  NORDESTE: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  NORTE: ["AC", "AM", "AP", "PA", "RO", "RR", "TO"],
  SUDESTE: ["ES", "MG", "RJ", "SP"],
  SUL: ["PR", "RS", "SC"],
};

const prazoPorRegiao: Readonly<Record<CotacaoFrete["region"], readonly [number, number]>> = {
  CENTRO_OESTE: [4, 8],
  NORDESTE: [6, 11],
  NORTE: [8, 15],
  SUDESTE: [2, 5],
  SUL: [3, 7],
};

function regiaoDoEstado(state: string): CotacaoFrete["region"] {
  const region = (Object.keys(estadosPorRegiao) as CotacaoFrete["region"][])
    .find((candidate) => estadosPorRegiao[candidate].includes(state));
  if (!region) {
    throw new AppError(400, "INVALID_REQUEST");
  }
  return region;
}

export function cotarFrete(input: { postalCode: string; state: string }): CotacaoFrete {
  if (!/^\d{8}$/.test(input.postalCode) || !/^[A-Z]{2}$/.test(input.state)) {
    throw new AppError(400, "INVALID_REQUEST");
  }
  if (config.shipping.fixedCents === undefined) {
    throw new AppError(503, "CHECKOUT_UNAVAILABLE");
  }
  const region = regiaoDoEstado(input.state);
  const [estimatedMinBusinessDays, estimatedMaxBusinessDays] = prazoPorRegiao[region];
  return {
    amountCents: config.shipping.fixedCents,
    estimatedMaxBusinessDays,
    estimatedMinBusinessDays,
    region,
    service: "Entrega padrão EliteHub",
  };
}
