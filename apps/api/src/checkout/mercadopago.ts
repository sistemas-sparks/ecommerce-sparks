// Preferência de pagamento no checkout hospedado do Mercado Pago (R2.3: Pix e cartões, sem boleto).
import { type MpPreferenceResponse, mpPreferenceResponseSchema } from '@sparks/shared';

const PREFERENCES_URL = 'https://api.mercadopago.com/checkout/preferences';

export interface PreferenceInput {
  orderId: string;
  orderCode: string;
  totalCents: number;
  /** Página do pedido no site (retorno depois do pagamento). */
  returnUrl: string;
  /** Endereço do webhook na API. */
  notificationUrl: string;
  expiresAt: Date;
  /** Chave de idempotência. Padrão: o id do pedido (uma só preferência por pedido). */
  idempotencyKey?: string;
}

export type PreferenceResult = MpPreferenceResponse;

/**
 * Corpo da preferência. Um único item com o total já calculado pelo servidor: o Mercado Pago não
 * recalcula nada e o webhook (T-015) confere o valor pago com `total_cents`.
 * O Mercado Pago recebe reais com 2 casas; a conversão de centavos só acontece aqui, na fronteira.
 */
export function buildPreferenceBody(input: PreferenceInput) {
  return {
    items: [
      {
        id: input.orderCode,
        title: `Pedido ${input.orderCode} · Sparks Papelaria`,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: input.totalCents / 100,
      },
    ],
    external_reference: input.orderId,
    metadata: { order_code: input.orderCode },
    payment_methods: {
      // Sem boleto e sem pagamento em lotérica: só Pix e cartões (R2.3).
      excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }],
    },
    back_urls: { success: input.returnUrl, pending: input.returnUrl, failure: input.returnUrl },
    auto_return: 'approved',
    notification_url: input.notificationUrl,
    // A preferência vence junto com a reserva do estoque.
    expires: true,
    expiration_date_to: input.expiresAt.toISOString(),
    date_of_expiration: input.expiresAt.toISOString(),
  };
}

export async function createPreference(
  fetchFn: typeof fetch,
  accessToken: string,
  input: PreferenceInput,
): Promise<PreferenceResult> {
  const res = await fetchFn(PREFERENCES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      // Repetir a chamada para o mesmo pedido não cria duas preferências.
      'X-Idempotency-Key': input.idempotencyKey ?? input.orderId,
    },
    body: JSON.stringify(buildPreferenceBody(input)),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`mercadopago_${res.status}`);
  return mpPreferenceResponseSchema.parse(await res.json());
}
