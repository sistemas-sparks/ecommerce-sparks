// SEO: fonte única da URL base e montagem de metadados e JSON-LD (docs/seo.md, regras R6).
// Nada aqui inventa dado da cliente: o que falta fica de fora ou como [A DEFINIR] no texto da página.
import type { Metadata } from 'next';
import type { CatalogImage, PublicCategory, PublicProduct } from '@sparks/shared';

/** Domínio real ainda não existe. Definir NEXT_PUBLIC_SITE_URL no build quando o domínio estiver pronto. */
export const SITE_URL_PENDING = 'https://dominio-a-definir.example';
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || SITE_URL_PENDING).replace(/\/+$/, '');
export const SITE_NAME = 'Sparks Papelaria';
export const SITE_ALTERNATE_NAMES = ['Papelaria Sparks', 'Sparks Pink', 'Sparks Pink Papelaria'];
export const SITE_DESCRIPTION =
  'Papelaria afetiva com cadernos, canetas, kits escolares e presentes escolhidos com carinho. Embalagem para presente e pagamento por Pix e cartão.';
export const INSTAGRAM_URL = 'https://www.instagram.com/sparks_papelaria/';
export const OG_IMAGE = { path: '/og-image.jpg', width: 1200, height: 630 };
/**
 * As políticas ainda estão como [A DEFINIR] (faltam os textos aprovados pela cliente).
 * Enquanto for false: noindex e fora do sitemap. Virar true quando os textos forem aprovados.
 */
export const POLICY_PAGES_INDEXABLE = false;
export const THEME_COLOR = '#4B2145';

/** URL absoluta para um caminho do site (com barra final, como o export estático). */
export const absoluteUrl = (path: string) =>
  `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;

const absoluteImage = (url: string) => (url.startsWith('/') ? absoluteUrl(url) : url);

/** Corta o texto no limite, sem quebrar palavra. */
export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 40 ? space : cut.length).replace(/[\s,;:.-]+$/, '')}…`;
}

type PageMetaInput = {
  title: string;
  description: string;
  path: string;
  image?: CatalogImage | null;
  type?: 'website' | 'article';
  /** Usa o título como está, sem o sufixo da marca. */
  absoluteTitle?: boolean;
};

/** Metadados completos da página: title, description, canonical, Open Graph e Twitter Card. */
export function pageMetadata({
  title,
  description,
  path,
  image,
  type = 'website',
  absoluteTitle = false,
}: PageMetaInput): Metadata {
  const fullTitle = absoluteTitle ? title : `${title} | ${SITE_NAME}`;
  const picture = image
    ? { url: absoluteImage(image.url), alt: image.alt || title }
    : {
        url: absoluteUrl(OG_IMAGE.path),
        width: OG_IMAGE.width,
        height: OG_IMAGE.height,
        alt: SITE_NAME,
      };
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: absoluteUrl(path) },
    openGraph: {
      type,
      locale: 'pt_BR',
      siteName: SITE_NAME,
      title: fullTitle,
      description,
      url: absoluteUrl(path),
      images: [picture],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [picture.url],
    },
  };
}

/** Rotas privadas ou sem valor de busca: fora do Google, mas os links continuam seguidos. */
export const noIndex: Metadata['robots'] = { index: false, follow: true };

export function websiteLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    alternateName: SITE_ALTERNATE_NAMES,
    url: absoluteUrl('/'),
    inLanguage: 'pt-BR',
  };
}

/** Store: só o que está visível no site. Telefone e cidade/CEP ficam de fora até a cliente confirmar. */
export function storeLd(contact: { address: string | null }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: SITE_NAME,
    alternateName: SITE_ALTERNATE_NAMES,
    description: SITE_DESCRIPTION,
    url: absoluteUrl('/'),
    logo: absoluteUrl('/icon-512.png'),
    image: absoluteUrl(OG_IMAGE.path),
    sameAs: [INSTAGRAM_URL],
    ...(contact.address
      ? {
          address: {
            '@type': 'PostalAddress',
            streetAddress: contact.address,
            addressCountry: 'BR',
          },
        }
      : {}),
    paymentAccepted: 'Pix, cartão de crédito',
    currenciesAccepted: 'BRL',
  };
}

export function breadcrumbLd(items: { name: string; path?: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      ...(item.path ? { item: absoluteUrl(item.path) } : {}),
    })),
  };
}

/**
 * Product: nome, descrição, fotos e preço são os mesmos do HTML estático.
 * Sem disponibilidade: ela só é confirmada na hora pela API (a página estática mostra "Consultando…").
 * Sem aggregateRating nem review.
 */
export function productLd(product: PublicProduct, path: string) {
  const images = product.images.map((image) => absoluteImage(image.url));
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    ...(product.description ? { description: product.description } : {}),
    ...(images.length ? { image: images } : {}),
    offers: {
      '@type': 'Offer',
      url: absoluteUrl(path),
      priceCurrency: 'BRL',
      price: (product.price_cents / 100).toFixed(2),
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: SITE_NAME },
    },
  };
}

export function productDescription(product: PublicProduct, category?: PublicCategory): string {
  const text = product.description.trim();
  if (text) return truncate(text, 155);
  return truncate(
    `${product.name}${category ? ` em ${category.name}` : ''} na ${SITE_NAME}. Veja fotos, preço e detalhes e compre com Pix ou cartão.`,
    155,
  );
}

/** Serializa JSON-LD de forma segura para dentro de <script>. */
export function serializeLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}
