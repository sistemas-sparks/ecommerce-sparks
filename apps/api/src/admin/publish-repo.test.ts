import { describe, expect, it } from 'vitest';
import { buildPublicCatalog } from './publish-repo';

const CAT_ON = '11111111-1111-4111-8111-111111111111';
const CAT_OFF = '22222222-2222-4222-8222-222222222222';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const P2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const P3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

const publicUrl = (path: string) =>
  `https://projeto.supabase.co/storage/v1/object/public/products/${path}`;

function product(id: string, category: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    slug: `produto-${id.slice(-1)}`,
    name: `Produto ${id.slice(-1)}`,
    description: '',
    category_id: category,
    price_cents: 1990,
    stock: 3,
    featured: false,
    badge: null,
    product_images: [],
    ...extra,
  };
}

describe('buildPublicCatalog', () => {
  const categories = [{ id: CAT_ON, slug: 'cadernos', name: 'Cadernos', position: 1 }];

  it('tira produtos de categoria inativa e mantém os sem categoria', () => {
    const catalog = buildPublicCatalog(
      categories,
      [product(P1, CAT_ON), product(P2, CAT_OFF), product(P3, null)],
      { store_whatsapp: null },
      publicUrl,
    );
    expect(catalog.products.map((p) => p.id)).toEqual([P1, P3]);
  });

  it('monta as fotos em ordem, com as 3 larguras e texto alternativo', () => {
    const catalog = buildPublicCatalog(
      categories,
      [
        product(P1, CAT_ON, {
          product_images: [
            { path: `${P1}/img2/1080.webp`, alt: '', position: 2 },
            { path: `${P1}/img1/1080.webp`, alt: 'Capa', position: 1 },
          ],
        }),
      ],
      { store_whatsapp: null },
      publicUrl,
    );
    const [first, second] = catalog.products[0]!.images;
    expect(first).toEqual({
      url: publicUrl(`${P1}/img1/1080.webp`),
      alt: 'Capa',
      sources: [
        { width: 360, url: publicUrl(`${P1}/img1/360.webp`) },
        { width: 720, url: publicUrl(`${P1}/img1/720.webp`) },
        { width: 1080, url: publicUrl(`${P1}/img1/1080.webp`) },
      ],
    });
    expect(second?.alt).toBe('Produto 1'); // sem texto alternativo: usa o nome
  });

  it('WhatsApp da loja com 55; endereço e Instagram vazios até a cliente confirmar', () => {
    const catalog = buildPublicCatalog([], [], { store_whatsapp: '79999991234' }, publicUrl);
    expect(catalog.contact).toEqual({ whatsapp: '5579999991234', address: null });
    expect(catalog.instagram_images).toEqual([]);
  });

  it('o resultado passa pelo contrato público (campos extras como custo são recusados)', () => {
    expect(() =>
      buildPublicCatalog(
        categories,
        [product(P1, CAT_ON), product(P1, CAT_ON)],
        { store_whatsapp: null },
        publicUrl,
      ),
    ).toThrow(/únicos/);
  });
});

describe('buildPublicCatalog: banners e links da bio (T-021)', () => {
  const B1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const B2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
  const B3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
  const IMG = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  const now = Date.parse('2026-11-13T12:00:00-03:00');
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    image_id: IMG,
    alt: 'Cadernos coloridos',
    href: '/busca/?q=caderno',
    starts_at: null,
    ends_at: null,
    ...over,
  });

  it('sem banners nem links, as listas saem vazias', () => {
    const catalog = buildPublicCatalog([], [], { store_whatsapp: null }, publicUrl);
    expect(catalog.banners).toEqual([]);
    expect(catalog.bio_links).toEqual([]);
  });

  it('monta a imagem com as 3 larguras e tira o banner cujo período terminou e o agendado que ainda não começou', () => {
    const catalog = buildPublicCatalog([], [], { store_whatsapp: null }, publicUrl, {
      banners: [
        row(B1, { starts_at: '2026-11-01T00:00:00-03:00' }),
        row(B2, { ends_at: '2026-11-01T00:00:00-03:00' }),
        row(B3, { starts_at: '2026-12-01T00:00:00-03:00' }),
      ],
      bioLinks: [],
      now,
    });
    expect(catalog.banners.map((b) => b.id)).toEqual([B1]);
    expect(catalog.banners[0]!.image).toEqual({
      url: publicUrl(`banners/${IMG}/1920.webp`),
      alt: 'Cadernos coloridos',
      sources: [
        { width: 640, url: publicUrl(`banners/${IMG}/640.webp`) },
        { width: 1280, url: publicUrl(`banners/${IMG}/1280.webp`) },
        { width: 1920, url: publicUrl(`banners/${IMG}/1920.webp`) },
      ],
    });
    // O banner agendado não vai ao snapshot (nem ao HTML público) antes da data de início.
    expect(JSON.stringify(catalog)).not.toContain(B3);
  });

  it('só repassa as colunas públicas dos links', () => {
    const catalog = buildPublicCatalog([], [], { store_whatsapp: null }, publicUrl, {
      banners: [],
      bioLinks: [
        { id: B1, label: 'Catálogo', href: 'https://exemplo.com.br/catalogo' },
        { id: B2, label: 'Loja', href: '/' },
      ],
      now,
    });
    expect(catalog.bio_links).toEqual([
      { id: B1, label: 'Catálogo', href: 'https://exemplo.com.br/catalogo' },
      { id: B2, label: 'Loja', href: '/' },
    ]);
  });

  it('falha fechado se o banco devolver destino inseguro', () => {
    expect(() =>
      buildPublicCatalog([], [], { store_whatsapp: null }, publicUrl, {
        banners: [row(B1, { href: 'javascript:alert(1)' })],
        bioLinks: [],
        now,
      }),
    ).toThrow();
  });
});
