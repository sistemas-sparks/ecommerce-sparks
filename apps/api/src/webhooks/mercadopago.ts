// Mercado Pago: assinatura do webhook, consulta do pagamento e acesso ao banco (R3.4).
import {
  type MarkOrderPaidResult,
  type MpPayment,
  markOrderPaidResultSchema,
  mpPaymentSchema,
} from '@sparks/shared';
import { z } from 'zod';
import { ConfigError, type Bindings, type Config } from '../env';
import { getServiceClient } from '../lib/supabase';

const schema = z.object({
  MP_ACCESS_TOKEN: z.string().min(10),
  MP_WEBHOOK_SECRET: z.string().min(16),
});

export interface WebhookSecrets {
  mpAccessToken: string;
  mpWebhookSecret: string;
}

export function loadWebhookSecrets(env: Bindings): WebhookSecrets {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError([...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))]);
  }
  return {
    mpAccessToken: parsed.data.MP_ACCESS_TOKEN,
    mpWebhookSecret: parsed.data.MP_WEBHOOK_SECRET,
  };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparação em tempo constante (não vaza, pelo tempo de resposta, quantos caracteres batem). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Assinatura `x-signature: ts=<ts>,v1=<hmac>` do Mercado Pago.
 * Manifesto: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (só as partes presentes), com
 * HMAC-SHA256 da chave secreta do webhook. data.id alfanumérico vai em minúsculas.
 */
export async function verifyMpSignature(opts: {
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string;
  secret: string;
}): Promise<boolean> {
  if (!opts.xSignature) return false;
  const parts = new Map(
    opts.xSignature.split(',').map((part) => {
      const [k = '', ...v] = part.split('=');
      return [k.trim(), v.join('=').trim()] as const;
    }),
  );
  const ts = parts.get('ts');
  const v1 = parts.get('v1');
  if (!ts || !v1) return false;

  const id = /^[a-z0-9]+$/i.test(opts.dataId) ? opts.dataId.toLowerCase() : opts.dataId;
  let manifest = `id:${id};`;
  if (opts.xRequestId) manifest += `request-id:${opts.xRequestId};`;
  manifest += `ts:${ts};`;

  return safeEqual(await hmacHex(opts.secret, manifest), v1.toLowerCase());
}

export type { MpPayment };

export class PaymentNotFound extends Error {}

/** Busca o pagamento direto na API do Mercado Pago: o corpo do webhook nunca é confiável. */
export async function fetchMpPayment(
  fetchFn: typeof fetch,
  accessToken: string,
  paymentId: string,
): Promise<{ payment: MpPayment; raw: string }> {
  const res = await fetchFn(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) throw new PaymentNotFound();
  if (!res.ok) throw new Error(`mercadopago_${res.status}`);
  const raw = await res.text();
  return { payment: mpPaymentSchema.parse(JSON.parse(raw)), raw };
}

/** Meio de pagamento no formato do banco (pix, credit_card, debit_card). */
export function paymentMethodOf(payment: MpPayment): string | null {
  if (payment.payment_method_id === 'pix') return 'pix';
  if (payment.payment_type_id === 'credit_card' || payment.payment_type_id === 'debit_card') {
    return payment.payment_type_id;
  }
  return null;
}

export type MarkPaidResult = MarkOrderPaidResult;

export interface MarkPaidArgs {
  orderId: string;
  mpPaymentId: string;
  amountCents: number;
  paymentMethod: string | null;
  eventId: string;
  payloadHash: string;
}

export interface WebhookRepo {
  markOrderPaid(args: MarkPaidArgs): Promise<MarkPaidResult>;
}

export function supabaseWebhookRepo(config: Config): WebhookRepo {
  const db = getServiceClient(config);
  return {
    async markOrderPaid(args) {
      const { data, error } = await db.rpc('mark_order_paid', {
        p_order_id: args.orderId,
        p_mp_payment_id: args.mpPaymentId,
        p_amount_cents: args.amountCents,
        p_payment_method: args.paymentMethod,
        p_event_id: args.eventId,
        p_payload_hash: args.payloadHash,
      });
      if (error) throw new Error('webhook_repo_mark_order_paid');
      return markOrderPaidResultSchema.parse(data);
    },
  };
}
