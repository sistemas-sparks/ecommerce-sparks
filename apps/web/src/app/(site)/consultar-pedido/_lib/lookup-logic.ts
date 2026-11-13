// Validação do formulário "Consultar pedido": usa os mesmos schemas do servidor.
import { orderCodeSchema, whatsappSchema } from '@sparks/shared';

export interface LookupErrors {
  code?: string;
  whatsapp?: string;
}

export function validateLookup(code: string, whatsapp: string): LookupErrors {
  const errors: LookupErrors = {};
  const c = orderCodeSchema.safeParse(code);
  if (!c.success) errors.code = c.error.issues[0]?.message ?? 'Código do pedido inválido.';
  const w = whatsappSchema.safeParse(whatsapp);
  if (!w.success) errors.whatsapp = w.error.issues[0]?.message ?? 'WhatsApp inválido.';
  return errors;
}
