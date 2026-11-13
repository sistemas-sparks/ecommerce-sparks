import { describe, expect, it } from 'vitest';
import { publicCatalogSchema } from './catalog';
import {
  bannerCreateSchema,
  bannerImagePaths,
  bannerUpdateSchema,
  bioLinkCreateSchema,
  isBannerLive,
  isExternalHref,
  isSafeSiteHref,
  siteContentOrderSchema,
} from './site-content';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

describe('isSafeSiteHref', () => {
  it.each([
    '/',
    '/busca/?q=presente',
    '/produto/caderno-de-pelucia/',
    'https://www.instagram.com/sparks_papelaria/',
    'https://exemplo.com.br/loja?a=1#topo',
  ])('aceita %s', (href) => expect(isSafeSiteHref(href)).toBe(true));

  it.each([
    '',
    '//outro-site.com',
    '/\\outro-site.com',
    'http://exemplo.com',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'https:exemplo.com',
    'https://',
    'https://usuario:senha@exemplo.com',
    'https://exemplo.com/a b',
    'busca/',
    'mailto:oi@exemplo.com',
    '/ok\u0000',
    `/${'a'.repeat(2048)}`,
  ])('recusa %j', (href) => expect(isSafeSiteHref(href)).toBe(false));

  it('só o https é externo', () => {
    expect(isExternalHref('https://exemplo.com')).toBe(true);
    expect(isExternalHref('/busca/')).toBe(false);
  });
});

describe('banners', () => {
  const base = {
    imageId: ID,
    alt: 'Cadernos coloridos sobre a mesa',
    href: '/busca/?q=caderno',
    startsAt: null,
    endsAt: null,
    active: true,
  };

  it('aceita um banner completo e apara espaços', () => {
    const parsed = bannerCreateSchema.parse({ ...base, alt: '  Cadernos  ', href: ' /busca/ ' });
    expect(parsed.alt).toBe('Cadernos');
    expect(parsed.href).toBe('/busca/');
  });

  it('exige texto alternativo', () => {
    expect(bannerCreateSchema.safeParse({ ...base, alt: '' }).success).toBe(false);
    expect(bannerCreateSchema.safeParse({ ...base, alt: '   ' }).success).toBe(false);
    expect(bannerCreateSchema.safeParse({ ...base, alt: 'x'.repeat(301) }).success).toBe(false);
  });

  it('recusa destino perigoso e campos extras', () => {
    expect(bannerCreateSchema.safeParse({ ...base, href: 'javascript:alert(1)' }).success).toBe(
      false,
    );
    expect(bannerCreateSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(bannerCreateSchema.safeParse({ ...base, imageId: 'x' }).success).toBe(false);
  });

  it('o fim do período precisa ser depois do início', () => {
    const start = '2026-12-01T00:00:00-03:00';
    expect(
      bannerCreateSchema.safeParse({
        ...base,
        startsAt: start,
        endsAt: '2026-12-10T00:00:00-03:00',
      }).success,
    ).toBe(true);
    expect(bannerCreateSchema.safeParse({ ...base, startsAt: start, endsAt: start }).success).toBe(
      false,
    );
    expect(
      bannerCreateSchema.safeParse({
        ...base,
        startsAt: start,
        endsAt: '2026-11-01T00:00:00-03:00',
      }).success,
    ).toBe(false);
  });

  it('na edição a foto é opcional e a versão é obrigatória', () => {
    const { imageId, ...rest } = base;
    void imageId;
    expect(bannerUpdateSchema.safeParse(rest).success).toBe(false);
    expect(
      bannerUpdateSchema.safeParse({
        ...rest,
        expectedUpdatedAt: '2026-11-13T10:00:00.123456+00:00',
      }).success,
    ).toBe(true);
  });

  it('gera os caminhos das três larguras', () => {
    expect(bannerImagePaths(ID)).toEqual([
      `banners/${ID}/640.webp`,
      `banners/${ID}/1280.webp`,
      `banners/${ID}/1920.webp`,
    ]);
  });
});

describe('links da bio e ordem', () => {
  it('exige rótulo e destino válido', () => {
    expect(
      bioLinkCreateSchema.safeParse({ label: 'Catálogo', href: '/', active: true }).success,
    ).toBe(true);
    expect(bioLinkCreateSchema.safeParse({ label: ' ', href: '/', active: true }).success).toBe(
      false,
    );
    expect(
      bioLinkCreateSchema.safeParse({ label: 'x', href: 'http://x.com', active: true }).success,
    ).toBe(false);
  });

  it('a ordem não aceita ids repetidos nem lista vazia', () => {
    expect(siteContentOrderSchema.safeParse({ ids: [ID, ID2] }).success).toBe(true);
    expect(siteContentOrderSchema.safeParse({ ids: [ID, ID] }).success).toBe(false);
    expect(siteContentOrderSchema.safeParse({ ids: [] }).success).toBe(false);
  });
});

describe('isBannerLive', () => {
  const now = Date.parse('2026-11-13T12:00:00-03:00');
  it('sem período está sempre no ar', () => {
    expect(isBannerLive({ starts_at: null, ends_at: null }, now)).toBe(true);
  });
  it('respeita início e fim (o fim é exclusivo)', () => {
    expect(isBannerLive({ starts_at: '2026-11-14T00:00:00-03:00', ends_at: null }, now)).toBe(
      false,
    );
    expect(isBannerLive({ starts_at: null, ends_at: '2026-11-13T12:00:00-03:00' }, now)).toBe(
      false,
    );
    expect(
      isBannerLive(
        { starts_at: '2026-11-13T00:00:00-03:00', ends_at: '2026-11-14T00:00:00-03:00' },
        now,
      ),
    ).toBe(true);
  });
});

describe('catálogo público', () => {
  const empty = {
    categories: [],
    products: [],
    contact: { whatsapp: null, address: null },
    instagram_images: [],
  };
  it('o snapshot antigo (sem banners) continua válido, com listas vazias', () => {
    const parsed = publicCatalogSchema.parse(empty);
    expect(parsed.banners).toEqual([]);
    expect(parsed.bio_links).toEqual([]);
  });
  it('recusa banner com destino perigoso', () => {
    expect(
      publicCatalogSchema.safeParse({
        ...empty,
        banners: [
          {
            id: ID,
            href: 'javascript:alert(1)',
            starts_at: null,
            ends_at: null,
            image: { url: 'https://x.supabase.co/a.webp', alt: 'a', sources: [] },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
