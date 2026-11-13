// T-021 · Banners da vitrine e links do mini site da bio, no painel. Protegido pelo guard de /admin/*
// (papel admin + aal2) montado em app.ts. Entrada validada com Zod; o destino do link só pode ser
// caminho do próprio site ou https. A leitura pública dos itens ativos é o snapshot do build
// (GET /catalog/snapshot, em publish.ts); aqui não há rota pública.
import type { ZodType } from 'zod';
import { Hono } from 'hono';
import {
  adminBannersResponseSchema,
  adminBioLinksResponseSchema,
  bannerCreateSchema,
  bannerUpdateSchema,
  bioLinkCreateSchema,
  bioLinkUpdateSchema,
  productUploadInputSchema,
  siteContentDeleteSchema,
  siteContentOrderSchema,
  uuidSchema,
  BANNER_MAX_COUNT,
  BIO_LINK_MAX_COUNT,
} from '@sparks/shared';
import { apiError } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Só as mensagens escritas para a lojista (regras "custom") vão para a tela; o resto é genérico.
    const custom = result.error.issues.find((issue) => issue.code === 'custom');
    throw apiError(400, 'invalid_input', custom?.message ?? 'Confira os campos informados.');
  }
  return result.data;
}
const id = (value: string) => parse(uuidSchema, value);
const body = (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => null);

const writeLimit = rateLimit({ bucket: 'admin-site-content', max: 60, windowSeconds: 600 });
const uploadLimit = rateLimit({ bucket: 'admin-banner-upload', max: 20, windowSeconds: 600 });

export const bannersAdminRoutes = new Hono<AppEnv>()
  .get('/', async (c) =>
    c.json(
      adminBannersResponseSchema.parse({
        banners: await c.var.deps.siteContentRepo(c.var.config).listBanners(),
        limit: BANNER_MAX_COUNT,
      }),
    ),
  )
  .post('/upload', uploadLimit, async (c) => {
    // Só tipo e tamanho do arquivo original; o navegador converte e envia as 3 larguras.
    parse(productUploadInputSchema, await body(c));
    return c.json(await c.var.deps.siteContentRepo(c.var.config).signBannerImage());
  })
  .put('/order', writeLimit, async (c) => {
    const { ids } = parse(siteContentOrderSchema, await body(c));
    await c.var.deps.siteContentRepo(c.var.config).reorderBanners(ids, c.var.user.id);
    return c.json({ ok: true });
  })
  .post('/', writeLimit, async (c) => {
    const input = parse(bannerCreateSchema, await body(c));
    return c.json(
      await c.var.deps.siteContentRepo(c.var.config).createBanner(input, c.var.user.id),
      201,
    );
  })
  .patch('/:id', writeLimit, async (c) => {
    const { expectedUpdatedAt, ...input } = parse(bannerUpdateSchema, await body(c));
    return c.json(
      await c.var.deps
        .siteContentRepo(c.var.config)
        .updateBanner(id(c.req.param('id')), input, expectedUpdatedAt, c.var.user.id),
    );
  })
  .delete('/:id', writeLimit, async (c) => {
    const { expectedUpdatedAt } = parse(siteContentDeleteSchema, await body(c));
    await c.var.deps
      .siteContentRepo(c.var.config)
      .deleteBanner(id(c.req.param('id')), expectedUpdatedAt, c.var.user.id);
    return c.json({ ok: true });
  });

export const bioLinksAdminRoutes = new Hono<AppEnv>()
  .get('/', async (c) =>
    c.json(
      adminBioLinksResponseSchema.parse({
        ...(await c.var.deps.siteContentRepo(c.var.config).listBioLinks()),
        limit: BIO_LINK_MAX_COUNT,
      }),
    ),
  )
  .put('/order', writeLimit, async (c) => {
    const { ids } = parse(siteContentOrderSchema, await body(c));
    await c.var.deps.siteContentRepo(c.var.config).reorderBioLinks(ids, c.var.user.id);
    return c.json({ ok: true });
  })
  .post('/', writeLimit, async (c) => {
    const input = parse(bioLinkCreateSchema, await body(c));
    return c.json(
      await c.var.deps.siteContentRepo(c.var.config).createBioLink(input, c.var.user.id),
      201,
    );
  })
  .patch('/:id', writeLimit, async (c) => {
    const { expectedUpdatedAt, ...input } = parse(bioLinkUpdateSchema, await body(c));
    return c.json(
      await c.var.deps
        .siteContentRepo(c.var.config)
        .updateBioLink(id(c.req.param('id')), input, expectedUpdatedAt, c.var.user.id),
    );
  })
  .delete('/:id', writeLimit, async (c) => {
    const { expectedUpdatedAt } = parse(siteContentDeleteSchema, await body(c));
    await c.var.deps
      .siteContentRepo(c.var.config)
      .deleteBioLink(id(c.req.param('id')), expectedUpdatedAt, c.var.user.id);
    return c.json({ ok: true });
  });
