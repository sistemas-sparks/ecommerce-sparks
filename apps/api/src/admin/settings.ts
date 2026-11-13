import { Hono } from 'hono';
import { giftWrapSettingsInputSchema } from '@sparks/shared';
import { apiError } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

// Protegido pelo guard de /admin/* montado em app.ts.
export const settingsAdminRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await c.var.deps.settingsRepo(c.var.config).get()))
  .patch('/', rateLimit({ bucket: 'admin-settings', max: 60, windowSeconds: 600 }), async (c) => {
    const parsed = giftWrapSettingsInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      throw apiError(
        400,
        'invalid_input',
        'Envie apenas o campo gift_wrap_enabled (verdadeiro ou falso).',
      );
    return c.json(
      await c.var.deps.settingsRepo(c.var.config).update(parsed.data, `admin:${c.var.user.id}`),
    );
  });
