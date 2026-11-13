// Pedido do cliente (docs/arquitetura.md §5): link exclusivo, código + WhatsApp e guardar na conta.
// Duas formas de abrir um pedido sem login, ambas com limite de requisições (R3.6):
//  - link exclusivo: token de 256 bits; o banco guarda só o HMAC dele (checkout/token.ts);
//  - código + WhatsApp: com Turnstile, e a mesma resposta para "não existe" e "dados não batem".
import {
  type OrderView,
  orderClaimInputSchema,
  orderLookupInputSchema,
  orderViewSchema,
} from '@sparks/shared';
import { Hono } from 'hono';
import { hashOrderToken } from '../checkout/token';
import { MESSAGES, apiError } from '../lib/errors';
import { requireUser } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import { assertTurnstile } from '../middleware/turnstile';
import type { AppEnv } from '../types';
import { loadOrderPepper } from './config';
import { toOrderView } from './view';

export const ORDER_MESSAGES = {
  invalidJson: 'Não foi possível ler os dados. Recarregue a página e tente de novo.',
  // Igual para "não existe" e "dados não batem": não revela se o código é de um pedido real.
  lookupNotFound:
    'Não encontramos um pedido com esse código e esse WhatsApp. Confira os dados e tente de novo.',
  linkNotFound: 'Pedido não encontrado. Confira o link que você recebeu.',
  claimed: 'Pedido guardado na sua conta.',
} as const;

/** Só um resumo do número: o WhatsApp puro não vira chave do limite (R3.7). */
async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sparks:${value}`));
  return [...new Uint8Array(digest).slice(0, 12)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => {
    throw apiError(400, 'invalid_input', ORDER_MESSAGES.invalidJson);
  });
}

function respond(view: OrderView) {
  // Confere a própria resposta: nada além do formato público sai daqui.
  return orderViewSchema.parse(view);
}

export const ordersRoutes = new Hono<AppEnv>()
  // Pelo link exclusivo (também é o destino do retorno do Mercado Pago). O link é a credencial:
  // vai no CORPO (POST), nunca na URL, para não ficar gravado nos logs de requisições (Workers Logs).
  .post(
    '/by-token',
    rateLimit({ bucket: 'order-token', max: 60, windowSeconds: 600 }),
    async (c) => {
      // Corpo ilegível ou link fora do formato: a mesma resposta de "não encontrado" (sem eco do valor).
      const parsed = orderClaimInputSchema.safeParse(await readJson(c));
      if (!parsed.success) throw apiError(404, 'order_not_found', ORDER_MESSAGES.linkNotFound);
      const { token } = parsed.data;
      const pepper = loadOrderPepper(c.env ?? {});
      const row = await c.var.deps
        .ordersRepo(c.var.config)
        .findByTokenHash(await hashOrderToken(token, pepper));
      if (!row) throw apiError(404, 'order_not_found', ORDER_MESSAGES.linkNotFound);
      return c.json(respond(toOrderView(row)));
    },
  )

  // Por código + WhatsApp.
  .post(
    '/lookup',
    rateLimit({ bucket: 'order-lookup', max: 10, windowSeconds: 600 }),
    async (c) => {
      const parsed = orderLookupInputSchema.safeParse(await readJson(c));
      if (!parsed.success) {
        throw apiError(
          400,
          'invalid_input',
          parsed.error.issues[0]?.message ?? ORDER_MESSAGES.invalidJson,
        );
      }
      const { code, whatsapp, turnstileToken } = parsed.data;
      await assertTurnstile(c, turnstileToken);

      // Segunda trava, por número: impede chutar códigos de um WhatsApp usando vários IPs.
      // Só depois do Turnstile, para um robô não conseguir bloquear a consulta de outra pessoa.
      const allowed = await c.var.deps
        .rateLimitHit(c.var.config, `order-lookup-wa:${await shortHash(whatsapp)}`, 3600, 10)
        .catch(() => {
          throw apiError(503, 'unavailable', MESSAGES.unavailable);
        });
      if (!allowed) {
        throw apiError(429, 'rate_limited', MESSAGES.tooMany, { 'Retry-After': '3600' });
      }

      const row = await c.var.deps.ordersRepo(c.var.config).findByCodeAndWhatsapp(code, whatsapp);
      if (!row) throw apiError(404, 'order_not_found', ORDER_MESSAGES.lookupNotFound);
      return c.json(respond(toOrderView(row)));
    },
  )

  // Quem está logado e tem o link exclusivo guarda o pedido na conta ("Meus pedidos").
  .post(
    '/claim',
    rateLimit({ bucket: 'order-claim', max: 20, windowSeconds: 600 }),
    requireUser,
    async (c) => {
      const parsed = orderClaimInputSchema.safeParse(await readJson(c));
      if (!parsed.success) throw apiError(404, 'order_not_found', ORDER_MESSAGES.linkNotFound);
      const pepper = loadOrderPepper(c.env ?? {});
      const ok = await c.var.deps
        .ordersRepo(c.var.config)
        .claimByTokenHash(await hashOrderToken(parsed.data.token, pepper), c.var.user.id);
      // Pedido de outra conta responde igual a pedido inexistente.
      if (!ok) throw apiError(404, 'order_not_found', ORDER_MESSAGES.linkNotFound);
      return c.json({ linked: true, message: ORDER_MESSAGES.claimed });
    },
  );
