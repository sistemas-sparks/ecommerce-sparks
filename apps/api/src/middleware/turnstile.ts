// Cloudflare Turnstile (R3.6): login, consulta de pedido, cupom, cotação de frete e checkout.
// O token vem no corpo já validado pelo Zod (turnstileTokenSchema); a rota chama assertTurnstile.
import type { Context } from 'hono';
import { turnstileResponseSchema } from '@sparks/shared';
import { MESSAGES, apiError } from '../lib/errors';
import type { AppEnv } from '../types';
import { clientIp } from './rate-limit';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(c: Context<AppEnv>, token: string): Promise<boolean> {
  const form = new FormData();
  form.append('secret', c.var.config.turnstileSecretKey);
  form.append('response', token);
  const ip = clientIp(c);
  if (ip !== 'local') form.append('remoteip', ip);

  try {
    const res = await c.var.deps.fetch(SITEVERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = turnstileResponseSchema.safeParse(await res.json());
    return data.success && data.data.success;
  } catch {
    // Falha fechada: sem resposta do Turnstile, a requisição não passa.
    return false;
  }
}

export async function assertTurnstile(c: Context<AppEnv>, token: string): Promise<void> {
  if (!(await verifyTurnstile(c, token))) {
    throw apiError(403, 'turnstile_failed', MESSAGES.turnstile);
  }
}
