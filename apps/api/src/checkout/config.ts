// Segredos usados só pelo checkout. Falha fechada (503) e o log cita só os nomes (ver app.ts).
import { z } from 'zod';
import { ConfigError, type Bindings } from '../env';

const schema = z.object({
  MP_ACCESS_TOKEN: z.string().min(10),
  // Pimenta do HMAC do link do pedido: longa e aleatória (ex.: `openssl rand -base64 48`).
  ORDER_TOKEN_PEPPER: z.string().min(32),
});

export interface CheckoutSecrets {
  mpAccessToken: string;
  orderTokenPepper: string;
}

export function loadCheckoutSecrets(env: Bindings): CheckoutSecrets {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError([...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))]);
  }
  return {
    mpAccessToken: parsed.data.MP_ACCESS_TOKEN,
    orderTokenPepper: parsed.data.ORDER_TOKEN_PEPPER,
  };
}

/** Minutos para pagar antes de o pedido expirar e o estoque voltar (decisão do Rafael: 30). */
export const PAYMENT_WINDOW_MINUTES = 30;
