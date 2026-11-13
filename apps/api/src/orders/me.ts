// Conta do cliente logado (login opcional com Google): "Meus pedidos", endereço salvo e favoritos.
// Sempre filtrado pelo id do JWT validado; nunca por id enviado pelo navegador.
import {
  accountFavoritesInputSchema,
  orderCodeSchema,
  orderSummaryListSchema,
  orderViewSchema,
  profileInputSchema,
  profileSchema,
} from '@sparks/shared';
import { Hono } from 'hono';
import { apiError } from '../lib/errors';
import { requireUser } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';
import { ORDER_MESSAGES, readJson } from './route';
import { toOrderSummary, toOrderView } from './view';

const NOT_FOUND = 'Pedido não encontrado na sua conta.';

export const meRoutes = new Hono<AppEnv>()
  .use('*', rateLimit({ bucket: 'me', max: 120, windowSeconds: 600 }), requireUser)

  .get('/orders', async (c) => {
    const rows = await c.var.deps.ordersRepo(c.var.config).listByUser(c.var.user.id);
    return c.json(orderSummaryListSchema.parse({ orders: rows.map(toOrderSummary) }));
  })

  .get('/orders/:code', async (c) => {
    const code = orderCodeSchema.safeParse(c.req.param('code'));
    if (!code.success) throw apiError(404, 'order_not_found', NOT_FOUND);
    const row = await c.var.deps
      .ordersRepo(c.var.config)
      .findByUserAndCode(c.var.user.id, code.data);
    if (!row) throw apiError(404, 'order_not_found', NOT_FOUND);
    return c.json(orderViewSchema.parse(toOrderView(row)));
  })

  .get('/profile', async (c) => {
    const profile = await c.var.deps.ordersRepo(c.var.config).getProfile(c.var.user.id);
    return c.json(profileSchema.parse(profile));
  })

  .put('/profile', async (c) => {
    const parsed = profileInputSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      throw apiError(
        400,
        'invalid_input',
        parsed.error.issues[0]?.message ?? ORDER_MESSAGES.invalidJson,
      );
    }
    const repo = c.var.deps.ordersRepo(c.var.config);
    await repo.saveProfile(c.var.user.id, parsed.data);
    return c.json(profileSchema.parse(await repo.getProfile(c.var.user.id)));
  })

  .get('/favorites', async (c) => {
    const ids = await c.var.deps.ordersRepo(c.var.config).listFavorites(c.var.user.id);
    return c.json({ ids });
  })

  .put('/favorites', async (c) => {
    const parsed = accountFavoritesInputSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      throw apiError(
        400,
        'invalid_input',
        parsed.error.issues[0]?.message ?? ORDER_MESSAGES.invalidJson,
      );
    }
    const ids = await c.var.deps
      .ordersRepo(c.var.config)
      .replaceFavorites(c.var.user.id, parsed.data.ids);
    return c.json({ ids });
  });
