// Interruptor do plano de incidente (docs/seguranca.md): CHECKOUT_ENABLED=false pausa as compras.
import { createMiddleware } from 'hono/factory';
import { MESSAGES, apiError } from '../lib/errors';
import type { AppEnv } from '../types';

export const checkoutEnabled = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.config.checkoutEnabled) {
    throw apiError(503, 'checkout_paused', MESSAGES.checkoutPaused);
  }
  await next();
});
