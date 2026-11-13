import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/seo';

export const dynamic = 'force-static';

// Modelo: seo/robots.txt. /pedido e /minha-conta ainda não existem, mas já ficam protegidos.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin',
        '/sacola',
        '/checkout',
        '/pedido/',
        '/minha-conta',
        '/consultar-pedido',
        '/api/',
      ],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
