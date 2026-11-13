// Limite de requisições por IP e por grupo de rotas (R3.6). Contagem atômica no banco.
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { MESSAGES, apiError } from '../lib/errors';
import type { AppEnv } from '../types';

export interface RateLimitOptions {
  /** Nome do grupo, ex.: 'coupon', 'checkout', 'admin-login'. */
  bucket: string;
  max: number;
  windowSeconds: number;
}

/** IP do cliente pelo Cloudflare. Fora do Cloudflare (dev local) vira 'local'. */
export function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? 'local';
}

/** O IP não é guardado puro: só um hash curto (os registros somem em 1 dia). */
async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sparks:${ip}`));
  return [...new Uint8Array(digest).slice(0, 16)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const key = `${opts.bucket}:${await hashIp(clientIp(c))}`;
    let allowed: boolean;
    try {
      allowed = await c.var.deps.rateLimitHit(c.var.config, key, opts.windowSeconds, opts.max);
    } catch {
      // Falha fechada: sem conseguir contar, não deixa passar.
      throw apiError(503, 'unavailable', MESSAGES.unavailable);
    }
    if (!allowed) {
      throw apiError(429, 'rate_limited', MESSAGES.tooMany, {
        'Retry-After': String(opts.windowSeconds),
      });
    }
    await next();
  });
}
