import type { ZodType } from 'zod';
import { Hono } from 'hono';
import {
  productInputSchema,
  productUpdateSchema,
  productDeleteSchema,
  categoryInputSchema,
  categoryUpdateSchema,
  productUploadInputSchema,
  productImageConfirmSchema,
  productImageUpdateSchema,
  productsListQuerySchema,
  liveProductIdsSchema,
  liveProductsSchema,
  uuidSchema,
} from '@sparks/shared';
import { apiError } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw apiError(
      400,
      'invalid_input',
      'Confira os campos, valores, quantidades e links do cadastro.',
    );
  return result.data;
}
const id = (value: string) => parse(uuidSchema, value);

export const productsAdminRoutes = new Hono<AppEnv>()
  .get('/categories', async (c) =>
    c.json({ categories: await c.var.deps.productsRepo(c.var.config).categories() }),
  )
  .post('/categories', async (c) => {
    const input = parse(categoryInputSchema, await c.req.json().catch(() => null));
    return c.json(
      await c.var.deps.productsRepo(c.var.config).saveCategory(null, input, null, c.var.user.id),
      201,
    );
  })
  .patch('/categories/:id', async (c) => {
    const { expectedUpdatedAt, ...input } = parse(
      categoryUpdateSchema,
      await c.req.json().catch(() => null),
    );
    return c.json(
      await c.var.deps
        .productsRepo(c.var.config)
        .saveCategory(id(c.req.param('id')), input, expectedUpdatedAt, c.var.user.id),
    );
  })
  .delete('/categories/:id', async (c) => {
    const { expectedUpdatedAt } = parse(productDeleteSchema, await c.req.json().catch(() => null));
    await c.var.deps
      .productsRepo(c.var.config)
      .removeCategory(id(c.req.param('id')), expectedUpdatedAt, c.var.user.id);
    return c.json({ ok: true });
  })
  .get('/', async (c) => {
    const query = parse(productsListQuerySchema, c.req.query());
    return c.json(await c.var.deps.productsRepo(c.var.config).list(query));
  })
  .post('/', async (c) => {
    const input = parse(productInputSchema, await c.req.json().catch(() => null));
    return c.json(
      await c.var.deps.productsRepo(c.var.config).save(null, input, null, c.var.user.id),
      201,
    );
  })
  .get('/:id', async (c) =>
    c.json(await c.var.deps.productsRepo(c.var.config).get(id(c.req.param('id')))),
  )
  .patch('/:id', async (c) => {
    const { expectedUpdatedAt, ...input } = parse(
      productUpdateSchema,
      await c.req.json().catch(() => null),
    );
    return c.json(
      await c.var.deps
        .productsRepo(c.var.config)
        .save(id(c.req.param('id')), input, expectedUpdatedAt, c.var.user.id),
    );
  })
  .delete('/:id', async (c) => {
    const { expectedUpdatedAt } = parse(productDeleteSchema, await c.req.json().catch(() => null));
    await c.var.deps
      .productsRepo(c.var.config)
      .remove(id(c.req.param('id')), expectedUpdatedAt, c.var.user.id);
    return c.json({ ok: true });
  })
  .post(
    '/:id/images/upload',
    rateLimit({ bucket: 'admin-photo', max: 30, windowSeconds: 600 }),
    async (c) => {
      parse(productUploadInputSchema, await c.req.json().catch(() => null));
      return c.json(await c.var.deps.productsRepo(c.var.config).signImage(id(c.req.param('id'))));
    },
  )
  .post('/:id/images', async (c) => {
    const { imageId, ...input } = parse(
      productImageConfirmSchema,
      await c.req.json().catch(() => null),
    );
    await c.var.deps
      .productsRepo(c.var.config)
      .confirmImage(id(c.req.param('id')), imageId, input, c.var.user.id);
    return c.json({ ok: true }, 201);
  })
  .patch('/:id/images/:imageId', async (c) => {
    const { expectedUpdatedAt, ...input } = parse(
      productImageUpdateSchema,
      await c.req.json().catch(() => null),
    );
    await c.var.deps
      .productsRepo(c.var.config)
      .editImage(
        id(c.req.param('id')),
        id(c.req.param('imageId')),
        input,
        expectedUpdatedAt,
        c.var.user.id,
      );
    return c.json({ ok: true });
  })
  .delete('/:id/images/:imageId', async (c) => {
    const { expectedUpdatedAt } = parse(productDeleteSchema, await c.req.json().catch(() => null));
    await c.var.deps
      .productsRepo(c.var.config)
      .removeImage(
        id(c.req.param('id')),
        id(c.req.param('imageId')),
        expectedUpdatedAt,
        c.var.user.id,
      );
    return c.json({ ok: true });
  });

export const productsLiveRoutes = new Hono<AppEnv>().get(
  '/live',
  rateLimit({ bucket: 'products-live', max: 120, windowSeconds: 60 }),
  async (c) => {
    const ids = parse(liveProductIdsSchema, c.req.query('ids'));
    const rows = await c.var.deps.productsRepo(c.var.config).live(ids);
    return c.json(liveProductsSchema.parse({ products: rows }));
  },
);
