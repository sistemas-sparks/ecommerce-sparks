import { describe, expect, it } from 'vitest';
import type { PublicProduct } from '@sparks/shared';
import {
  SITE_URL,
  absoluteUrl,
  breadcrumbLd,
  pageMetadata,
  productDescription,
  productLd,
  serializeLd,
  storeLd,
  truncate,
} from './seo';

const product: PublicProduct = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'caderno-teste',
  name: 'Caderno teste',
  description: 'Caderno de teste.',
  category_id: null,
  kind: 'regular',
  price_cents: 5990,
  stock: 3,
  featured: false,
  badge: null,
  images: [{ url: '/img/a.webp', alt: 'Foto', sources: [] }],
};

describe('seo', () => {
  it('monta URL absoluta a partir da base única', () => {
    expect(absoluteUrl('/quem-somos/')).toBe(`${SITE_URL}/quem-somos/`);
  });

  it('corta texto sem passar do limite', () => {
    expect(truncate('palavra '.repeat(40), 50).length).toBeLessThanOrEqual(50);
    expect(truncate('curto', 50)).toBe('curto');
  });

  it('gera canonical, Open Graph e Twitter Card', () => {
    const meta = pageMetadata({
      title: 'Entrega',
      description: 'Texto.',
      path: '/politicas/entrega/',
    });
    expect(meta.alternates?.canonical).toBe(absoluteUrl('/politicas/entrega/'));
    expect(meta.openGraph).toMatchObject({ locale: 'pt_BR', title: 'Entrega | Sparks Papelaria' });
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image' });
  });

  it('Product usa preço com 2 casas, sem avaliações nem disponibilidade', () => {
    const ld = productLd(product, '/produto/caderno-teste/') as Record<string, unknown>;
    expect(ld.offers).toMatchObject({ price: '59.90', priceCurrency: 'BRL' });
    expect(JSON.stringify(ld)).not.toMatch(/aggregateRating|review|availability/);
    expect(ld.image).toEqual([absoluteUrl('/img/a.webp')]);
  });

  it('Store omite endereço e telefone não confirmados', () => {
    expect(JSON.stringify(storeLd({ address: null }))).not.toMatch(/address|telephone|A DEFINIR/);
    expect(JSON.stringify(storeLd({ address: 'Rua X, 1' }))).toContain('Rua X, 1');
  });

  it('migalhas numeram a partir de 1 e o último item não tem link', () => {
    const ld = breadcrumbLd([{ name: 'Início', path: '/' }, { name: 'Produto' }]);
    expect(ld.itemListElement[0]).toMatchObject({ position: 1 });
    expect(ld.itemListElement[1]).not.toHaveProperty('item');
  });

  it('descrição do produto cai em texto neutro quando está vazia', () => {
    expect(productDescription({ ...product, description: '' })).toContain('Caderno teste');
  });

  it('serializeLd impede fechar o script', () => {
    expect(serializeLd({ a: '</script><b>&' })).not.toMatch(/[<>&]/);
  });
});
