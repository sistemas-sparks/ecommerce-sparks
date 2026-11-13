import { describe, expect, it } from 'vitest';
import { publicCatalogSchema } from './catalog';
import { bannerCreateSchema, bioLinkCreateSchema } from './site-content';

const categoryId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const product = {
  id: productId,
  slug: 'produto-de-teste',
  name: 'Produto de teste',
  description: '',
  category_id: categoryId,
  kind: 'regular',
  price_cents: 1234,
  stock: 3,
  featured: false,
  badge: null,
  images: [],
};
const snapshot = {
  categories: [
    { id: categoryId, slug: 'categoria-de-teste', name: 'Categoria de teste', position: 0 },
  ],
  products: [product],
  contact: { whatsapp: null, address: null },
  instagram_images: [],
};

describe('catálogo público', () => {
  it('permite começar sem dados reais, sem criar produtos fictícios', () => {
    expect(
      publicCatalogSchema.parse({ ...snapshot, products: [], categories: [] }).products,
    ).toEqual([]);
  });
  it.each([{ cost_cents: 10 }, { kind: 'gift_wrap' }, { price_cents: 12.34 }, { price_cents: -1 }])(
    'recusa custo, embalagem e dinheiro inválido no DTO: %j',
    (fields) => {
      expect(
        publicCatalogSchema.safeParse({ ...snapshot, products: [{ ...product, ...fields }] })
          .success,
      ).toBe(false);
    },
  );
  it('recusa IDs/slugs repetidos e categorias ausentes', () => {
    expect(
      publicCatalogSchema.safeParse({ ...snapshot, products: [product, product] }).success,
    ).toBe(false);
    expect(publicCatalogSchema.safeParse({ ...snapshot, categories: [] }).success).toBe(false);
  });
  it.each([
    'javascript:alert(1)',
    'data:image/svg+xml,test',
    '//external.test/image',
    '/\\external.test/image',
  ])('recusa origem de imagem insegura: %s', (url) => {
    expect(
      publicCatalogSchema.safeParse({
        ...snapshot,
        products: [{ ...product, images: [{ url, alt: '' }] }],
      }).success,
    ).toBe(false);
  });
});

describe('limites de texto iguais no painel e no snapshot (emoji conta 1)', () => {
  const bannerId = '33333333-3333-4333-8333-333333333333';
  const base = {
    id: bannerId,
    href: '/busca/',
    starts_at: null,
    ends_at: null,
  };
  const withBanner = (alt: string) => ({
    ...snapshot,
    banners: [{ ...base, image: { url: '/a.webp', alt, sources: [] } }],
  });
  const panelBanner = (alt: string) =>
    bannerCreateSchema.safeParse({
      alt,
      href: '/busca/',
      startsAt: null,
      endsAt: null,
      active: true,
      imageId: bannerId,
    }).success;

  it('alt de 300 emojis vale no painel e no snapshot; 301 recusa nos dois', () => {
    const ok = '😀'.repeat(300);
    const tooLong = '😀'.repeat(301);
    expect(panelBanner(ok)).toBe(true);
    expect(publicCatalogSchema.safeParse(withBanner(ok)).success).toBe(true);
    expect(panelBanner(tooLong)).toBe(false);
    expect(publicCatalogSchema.safeParse(withBanner(tooLong)).success).toBe(false);
  });

  it('rótulo de 60 emojis vale no painel e no snapshot; 61 recusa nos dois', () => {
    const panel = (label: string) =>
      bioLinkCreateSchema.safeParse({ label, href: '/busca/', active: true }).success;
    const snap = (label: string) =>
      publicCatalogSchema.safeParse({
        ...snapshot,
        bio_links: [{ id: bannerId, label, href: '/busca/' }],
      }).success;
    expect(panel('🎁'.repeat(60))).toBe(true);
    expect(snap('🎁'.repeat(60))).toBe(true);
    expect(panel('🎁'.repeat(61))).toBe(false);
    expect(snap('🎁'.repeat(61))).toBe(false);
  });
});
