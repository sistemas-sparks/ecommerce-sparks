import { Hono } from 'hono';
import { giftWrapPublicSchema } from '@sparks/shared';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

// Público, só leitura. O interruptor precisa valer na hora, então nunca vai para cache.
export const giftWrapRoutes = new Hono<AppEnv>().get(
  '/',
  rateLimit({ bucket: 'gift-wrap', max: 120, windowSeconds: 60 }),
  async (c) => {
    const body = giftWrapPublicSchema.parse(await c.var.deps.giftWrapRepo(c.var.config).load());
    c.header('Cache-Control', 'no-store');
    return c.json(body);
  },
);
