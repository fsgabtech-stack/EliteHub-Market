export type Papel = "CUSTOMER" | "SELLER" | "PROFESSIONAL" | "ADMIN" | "SUPPORT";

export type UsuarioDaSessao = {
  email: string;
  emailVerified: boolean;
  fullName: string;
  id: string;
  roles: Papel[];
};

export type Avaliacao = { average: number; count: number };

export type ProdutoResumo = {
  availability: "AVAILABLE" | "LOW_STOCK" | "OUT_OF_STOCK";
  category: { id: string; name: string } | null;
  id: string;
  imageUrl: string | null;
  priceCents: number;
  rating: Avaliacao | null;
  seller: { id: string; name: string };
  title: string;
};

export type Produto = ProdutoResumo & {
  attributes: Record<string, unknown>;
  description: string;
  images: Array<{ url: string }>;
  variants: Array<{
    attributes: Record<string, unknown>;
    availability: ProdutoResumo["availability"];
    id: string;
    priceCents: number | null;
    sku: string | null;
  }>;
};

export type Endereco = {
  city: string;
  complement: string | null;
  id: string;
  label: string;
  neighborhood: string;
  number: string;
  postalCode: string;
  recipientName: string;
  state: string;
  street: string;
};

export type Carrinho = {
  id: string;
  items: Array<{
    id: string;
    imageUrl: string | null;
    product: { id: string; title: string };
    quantity: number;
    stockQuantity: number;
    unitPriceCents: number;
    variant: { attributes: Record<string, unknown>; id: string } | null;
  }>;
  subtotalCents: number;
};
