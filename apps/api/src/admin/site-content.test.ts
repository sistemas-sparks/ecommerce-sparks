// T-021 · Rotas /admin/banners e /admin/bio-links: acesso (admin + aal2), validação com Zod,
// destino seguro e repasse ao repositório. O repositório é simulado; o SQL é testado em PGlite.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { createTestKey, signToken, testEnv, type TestKey, USER_ID } from '../test-utils';
import { apiError } from '../lib/errors';
import { checkMutation, type SiteContentRepo } from './site-content-repo';

const ID = '11111111-1111-4111-8111-111111111111';
const IMG = '22222222-2222-4222-8222-222222222222';
const VERSION = '2026-11-13T12:00:00.123456+00:00';

let key: TestKey;
let repo: { [K in keyof SiteContentRepo]: ReturnType<typeof vi.fn> };

const adminBanner = {
  id: ID,
  alt: 'Cadernos',
  href: '/',
  startsAt: null,
  endsAt: null,
  active: true,
  position: 0,
  updatedAt: VERSION,
  imageUrl: 'https://x.supabase.co/storage/v1/object/public/products/banners/a/1920.webp',
  sources: [],
};
const adminLink = {
  id: ID,
  label: 'Catálogo',
  href: '/',
  active: true,
  position: 0,
  updatedAt: VERSION,
};

beforeAll(async () => {
  key = await createTestKey();
});
beforeEach(() => {
  repo = {
    listBanners: vi.fn(async () => [adminBanner]),
    listBioLinks: vi.fn(async () => ({ links: [adminLink], whatsapp: null })),
    signBannerImage: vi.fn(async () => ({ imageId: IMG, files: [] })),
    createBanner: vi.fn(async () => adminBanner),
    updateBanner: vi.fn(async () => adminBanner),
    deleteBanner: vi.fn(async () => undefined),
    reorderBanners: vi.fn(async () => undefined),
    createBioLink: vi.fn(async () => adminLink),
    updateBioLink: vi.fn(async () => adminLink),
    deleteBioLink: vi.fn(async () => undefined),
    reorderBioLinks: vi.fn(async () => undefined),
  };
});

async function call(
  path: string,
  method: string,
  payload?: unknown,
  opts: { role?: string | null; aal?: string; allow?: boolean } = {},
) {
  const role = opts.role === undefined ? 'admin' : opts.role;
  const token =
    role === null
      ? null
      : await signToken(key, { app_metadata: { role }, aal: opts.aal ?? 'aal2' });
  const app = createApp({
    siteContentRepo: () => repo as unknown as SiteContentRepo,
    getJwks: async () => [key.publicJwk],
    rateLimitHit: async () => opts.allow ?? true,
  });
  return app.request(
    path,
    {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    },
    testEnv,
  );
}
const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;

const bannerBody = {
  imageId: IMG,
  alt: 'Cadernos coloridos sobre a mesa',
  href: '/busca/?q=caderno',
  startsAt: null,
  endsAt: null,
  active: true,
};
const linkBody = { label: 'Catálogo', href: 'https://exemplo.com.br/catalogo', active: true };

describe('acesso', () => {
  const routes: [string, string, unknown][] = [
    ['/admin/banners', 'GET', undefined],
    ['/admin/banners', 'POST', bannerBody],
    ['/admin/banners/upload', 'POST', { type: 'image/png', size: 1000 }],
    ['/admin/banners/order', 'PUT', { ids: [ID] }],
    [`/admin/banners/${ID}`, 'PATCH', { ...bannerBody, expectedUpdatedAt: VERSION }],
    [`/admin/banners/${ID}`, 'DELETE', { expectedUpdatedAt: VERSION }],
    ['/admin/bio-links', 'GET', undefined],
    ['/admin/bio-links', 'POST', linkBody],
    ['/admin/bio-links/order', 'PUT', { ids: [ID] }],
    [`/admin/bio-links/${ID}`, 'PATCH', { ...linkBody, expectedUpdatedAt: VERSION }],
    [`/admin/bio-links/${ID}`, 'DELETE', { expectedUpdatedAt: VERSION }],
  ];

  it.each(routes)(
    '%s %s: 401 sem login, 403 sem papel admin e sem segunda etapa',
    async (path, method, payload) => {
      expect((await call(path, method, payload, { role: null })).status).toBe(401);
      expect((await call(path, method, payload, { role: 'customer' })).status).toBe(403);
      expect((await call(path, method, payload, { aal: 'aal1' })).status).toBe(403);
      for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
    },
  );

  it.each(routes.filter(([, method]) => method !== 'GET'))(
    '%s %s: o limite de requisições responde 429 antes do banco',
    async (path, method, payload) => {
      expect((await call(path, method, payload, { allow: false })).status).toBe(429);
      for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
    },
  );
});

describe('banners', () => {
  it('lista com o limite', async () => {
    const r = await call('/admin/banners', 'GET');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ banners: [adminBanner], limit: 10 });
  });

  it('cria com 201 e repassa o admin como autor', async () => {
    const r = await call('/admin/banners', 'POST', bannerBody);
    expect(r.status).toBe(201);
    expect(repo.createBanner).toHaveBeenCalledWith(bannerBody, USER_ID);
  });

  it.each([
    ['sem texto alternativo', { alt: '' }],
    ['só espaços no texto alternativo', { alt: '   ' }],
    ['destino javascript:', { href: 'javascript:alert(1)' }],
    ['destino http', { href: 'http://exemplo.com' }],
    ['destino com //', { href: '//outro-site.com' }],
    [
      'fim antes do início',
      { startsAt: '2026-12-02T00:00:00-03:00', endsAt: '2026-12-01T00:00:00-03:00' },
    ],
    ['imagem sem uuid', { imageId: 'abc' }],
    ['campo extra', { position: 3 }],
  ])('recusa %s com 400', async (_name, change) => {
    const r = await call('/admin/banners', 'POST', { ...bannerBody, ...change });
    expect(r.status).toBe(400);
    expect(await code(r)).toBe('invalid_input');
    expect(repo.createBanner).not.toHaveBeenCalled();
  });

  it('mostra a mensagem em português do erro de destino', async () => {
    const r = await call('/admin/banners', 'POST', { ...bannerBody, href: 'javascript:1' });
    const { error } = (await r.json()) as { error: { message: string } };
    expect(error.message).toMatch(/caminho do site/);
  });

  it('edita separando a versão do restante e aceita trocar a foto só se enviada', async () => {
    const { imageId, ...withoutImage } = bannerBody;
    void imageId;
    const r = await call(`/admin/banners/${ID}`, 'PATCH', {
      ...withoutImage,
      expectedUpdatedAt: VERSION,
    });
    expect(r.status).toBe(200);
    expect(repo.updateBanner).toHaveBeenCalledWith(ID, withoutImage, VERSION, USER_ID);
    expect((await call(`/admin/banners/${ID}`, 'PATCH', withoutImage)).status).toBe(400);
    expect(
      (
        await call('/admin/banners/nao-e-uuid', 'PATCH', {
          ...withoutImage,
          expectedUpdatedAt: VERSION,
        })
      ).status,
    ).toBe(400);
  });

  it('exclui e reordena com validação', async () => {
    expect(
      (await call(`/admin/banners/${ID}`, 'DELETE', { expectedUpdatedAt: VERSION })).status,
    ).toBe(200);
    expect(repo.deleteBanner).toHaveBeenCalledWith(ID, VERSION, USER_ID);
    expect((await call(`/admin/banners/${ID}`, 'DELETE', {})).status).toBe(400);
    expect((await call('/admin/banners/order', 'PUT', { ids: [ID] })).status).toBe(200);
    expect(repo.reorderBanners).toHaveBeenCalledWith([ID], USER_ID);
    expect((await call('/admin/banners/order', 'PUT', { ids: [ID, ID] })).status).toBe(400);
  });

  it('o envio da imagem só assina com tipo e tamanho válidos', async () => {
    expect(
      (await call('/admin/banners/upload', 'POST', { type: 'image/png', size: 1000 })).status,
    ).toBe(200);
    expect(repo.signBannerImage).toHaveBeenCalledTimes(1);
    for (const bad of [
      { type: 'image/svg+xml', size: 1000 },
      { type: 'image/png', size: 6 * 1024 * 1024 },
      { type: 'image/png' },
    ]) {
      expect((await call('/admin/banners/upload', 'POST', bad)).status).toBe(400);
    }
    expect(repo.signBannerImage).toHaveBeenCalledTimes(1);
  });

  it('repassa o conflito de versão do repositório como 409', async () => {
    repo.updateBanner.mockRejectedValueOnce(apiError(409, 'content_changed', 'Mudou.'));
    const { imageId, ...rest } = bannerBody;
    void imageId;
    const r = await call(`/admin/banners/${ID}`, 'PATCH', { ...rest, expectedUpdatedAt: VERSION });
    expect(r.status).toBe(409);
  });
});

describe('links da bio', () => {
  it('lista com limite e WhatsApp da configuração', async () => {
    repo.listBioLinks.mockResolvedValueOnce({ links: [], whatsapp: '79999991234' });
    const r = await call('/admin/bio-links', 'GET');
    expect(await r.json()).toEqual({ links: [], limit: 3, whatsapp: '79999991234' });
  });

  it('cria, edita, exclui e reordena', async () => {
    expect((await call('/admin/bio-links', 'POST', linkBody)).status).toBe(201);
    expect(repo.createBioLink).toHaveBeenCalledWith(linkBody, USER_ID);
    expect(
      (await call(`/admin/bio-links/${ID}`, 'PATCH', { ...linkBody, expectedUpdatedAt: VERSION }))
        .status,
    ).toBe(200);
    expect(
      (await call(`/admin/bio-links/${ID}`, 'DELETE', { expectedUpdatedAt: VERSION })).status,
    ).toBe(200);
    expect((await call('/admin/bio-links/order', 'PUT', { ids: [ID] })).status).toBe(200);
  });

  it.each([
    ['sem rótulo', { label: '' }],
    ['rótulo longo demais', { label: 'x'.repeat(61) }],
    ['destino data:', { href: 'data:text/html,1' }],
    ['destino http', { href: 'http://exemplo.com' }],
    ['campo extra', { position: 1 }],
  ])('recusa %s com 400', async (_name, change) => {
    expect((await call('/admin/bio-links', 'POST', { ...linkBody, ...change })).status).toBe(400);
    expect(repo.createBioLink).not.toHaveBeenCalled();
  });
});

describe('checkMutation (erros do banco)', () => {
  const status = (error: { code?: string; message?: string }) => {
    try {
      checkMutation(error);
    } catch (err) {
      return (err as { status: number }).status;
    }
    return 0;
  };
  it('traduz sem repassar texto do banco', () => {
    expect(status({ code: 'P0001', message: 'content_changed' })).toBe(409);
    expect(status({ code: 'P0001', message: 'limit_reached' })).toBe(409);
    expect(status({ code: 'P0001', message: 'content_invalid' })).toBe(400);
    expect(
      status({ code: '23514', message: 'violates check constraint "banners_href_check"' }),
    ).toBe(400);
    expect(status({ code: '08006', message: 'connection to host db.secret failed' })).toBe(503);
    expect(() => checkMutation(null)).not.toThrow();
  });
});
