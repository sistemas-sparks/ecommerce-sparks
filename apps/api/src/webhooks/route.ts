// POST /webhooks/mercadopago (docs/arquitetura.md §7, R3.4).
// 1. confere a assinatura; 2. busca o pagamento na API do Mercado Pago; 3. confere status, moeda,
// referência e valor; 4. marca como pago uma única vez (mark_order_paid é idempotente).
// Respostas 2xx encerram o aviso; 5xx fazem o Mercado Pago tentar de novo mais tarde.
import { Hono } from 'hono';
import { z } from 'zod';
import { MESSAGES, apiError } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';
import {
  type MarkPaidResult,
  PaymentNotFound,
  fetchMpPayment,
  loadWebhookSecrets,
  paymentMethodOf,
  verifyMpSignature,
} from './mercadopago';

const PAYMENT_ID = /^\d{1,30}$/;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Resultados que pedem atenção da lojista (sem dados pessoais no log: só ids técnicos). */
const NEEDS_ATTENTION: MarkPaidResult[] = [
  'double_payment',
  'late_payment',
  'amount_mismatch',
  'order_not_found',
];

export const webhookRoutes = new Hono<AppEnv>().post(
  '/mercadopago',
  rateLimit({ bucket: 'mp-webhook', max: 600, windowSeconds: 60 }),
  async (c) => {
    const secrets = loadWebhookSecrets(c.env ?? {});
    const type = c.req.query('type') ?? c.req.query('topic');
    const dataId = c.req.query('data.id') ?? c.req.query('id') ?? '';

    const valid = await verifyMpSignature({
      xSignature: c.req.header('x-signature'),
      xRequestId: c.req.header('x-request-id'),
      dataId,
      secret: secrets.mpWebhookSecret,
    });
    if (!valid) {
      console.warn(JSON.stringify({ level: 'warn', event: 'mp_webhook_bad_signature' }));
      throw apiError(401, 'invalid_signature', MESSAGES.unauthorized);
    }

    // Só interessam avisos de pagamento; o resto é aceito e ignorado.
    if (type !== 'payment') return c.json({ ok: true, ignored: 'type' });
    if (!PAYMENT_ID.test(dataId)) throw apiError(400, 'invalid_input', 'Aviso inválido.');

    let fetched;
    try {
      fetched = await fetchMpPayment(c.var.deps.fetch, secrets.mpAccessToken, dataId);
    } catch (err) {
      if (err instanceof PaymentNotFound) return c.json({ ok: true, ignored: 'not_found' });
      throw apiError(503, 'unavailable', MESSAGES.unavailable);
    }
    const { payment, raw } = fetched;

    if (payment.status !== 'approved') return c.json({ ok: true, ignored: 'status' });

    const orderId = z.uuid().safeParse(payment.external_reference);
    if (payment.currency_id !== 'BRL' || !orderId.success) {
      console.warn(
        JSON.stringify({ level: 'warn', event: 'mp_webhook_unexpected', paymentId: payment.id }),
      );
      return c.json({ ok: true, ignored: 'reference' });
    }

    const result = await c.var.deps.webhookRepo(c.var.config).markOrderPaid({
      orderId: orderId.data,
      mpPaymentId: payment.id,
      // O Mercado Pago fala em reais com 2 casas; arredonda para o centavo mais próximo.
      amountCents: Math.round(payment.transaction_amount * 100),
      paymentMethod: paymentMethodOf(payment),
      // Um evento por pagamento aprovado: avisos repetidos do mesmo pagamento caem em 'duplicate'.
      eventId: `payment:${payment.id}:approved`,
      payloadHash: await sha256Hex(raw),
    });

    if (NEEDS_ATTENTION.includes(result)) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'mp_webhook_attention',
          result,
          orderId: orderId.data,
          paymentId: payment.id,
        }),
      );
    }
    return c.json({ ok: true, result });
  },
);
