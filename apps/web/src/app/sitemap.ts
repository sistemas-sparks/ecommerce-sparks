import type { MetadataRoute } from 'next';
import { POLICY_PAGES_INDEXABLE, absoluteUrl } from '@/lib/seo';
import { categories, categoryHref, productHref, products } from './(site)/_lib/catalog';

export const dynamic = 'force-static';

// Só páginas indexáveis: sem sacola, checkout, admin nem busca. Sem lastModified (não há data real).
export default function sitemap(): MetadataRoute.Sitemap {
  const fixed = [
    '/',
    '/quem-somos/',
    '/links/',
    ...(POLICY_PAGES_INDEXABLE
      ? ['/politicas/entrega/', '/politicas/trocas-e-devolucoes/', '/politicas/privacidade/']
      : []),
  ];
  return [
    ...fixed,
    ...categories.map((category) => categoryHref(category.slug)),
    ...products.map((product) => productHref(product.slug)),
  ].map((path) => ({ url: absoluteUrl(path) }));
}
