// Segredo do link do pedido. Falha fechada (503): sem a pimenta, nenhum link é conferido.
import { z } from 'zod';
import { ConfigError, type Bindings } from '../env';

const schema = z.object({ ORDER_TOKEN_PEPPER: z.string().min(32) });

export function loadOrderPepper(env: Bindings): string {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new ConfigError(['ORDER_TOKEN_PEPPER']);
  return parsed.data.ORDER_TOKEN_PEPPER;
}
