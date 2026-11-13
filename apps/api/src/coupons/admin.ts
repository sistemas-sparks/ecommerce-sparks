import {
  couponAdminCreateSchema,
  couponAdminListSchema,
  couponAdminRowSchema,
  couponAdminUpdateSchema,
  uuidSchema,
} from '@sparks/shared';
import { Hono } from 'hono';
import { apiError } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

const limit = rateLimit({ bucket: 'admin-coupons', max: 60, windowSeconds: 600 });
const invalid = (message: string | undefined) =>
  apiError(400, 'invalid_input', message ?? 'Confira os dados do cupom.');
const idOf = (raw: string) => {
  const id = uuidSchema.safeParse(raw);
  if (!id.success) throw apiError(404, 'not_found', 'Não encontrado.');
  return id.data;
};

// Protegido pelo guard de /admin/* montado em app.ts.
export const couponsAdminRoutes = new Hono<AppEnv>()
  .get('/', async (c) =>
    c.json(
      couponAdminListSchema.parse({
        coupons: await c.var.deps.couponsRepo(c.var.config).list(),
      }),
    ),
  )
  .post('/', limit, async (c) => {
    const parsed = couponAdminCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw invalid(parsed.error.issues[0]?.message);
    const row = await c.var.deps
      .couponsRepo(c.var.config)
      .create(parsed.data, `admin:${c.var.user.id}`);
    return c.json(couponAdminRowSchema.parse(row), 201);
  })
  .patch('/:id', limit, async (c) => {
    const id = idOf(c.req.param('id'));
    const parsed = couponAdminUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw invalid(parsed.error.issues[0]?.message);
    const row = await c.var.deps
      .couponsRepo(c.var.config)
      .update(id, parsed.data, `admin:${c.var.user.id}`);
    return c.json(couponAdminRowSchema.parse(row));
  })
  .delete('/:id', limit, async (c) => {
    const id = idOf(c.req.param('id'));
    await c.var.deps.couponsRepo(c.var.config).remove(id, `admin:${c.var.user.id}`);
    return c.json({ ok: true });
  });
