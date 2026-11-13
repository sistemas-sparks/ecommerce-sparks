import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import type { Bindings } from '../env';
import { testEnv } from '../test-utils';
import type { MarkPaidArgs, MarkPaidResult } from './mercadopago';

const SECRET = 'segredo-do-webhook-de-teste';
const env: Bindings = { ...testEnv, MP_ACCESS_TOKEN: 'TEST-token-mp', MP_WEBHOOK_SECRET: SECRET };
const ORDER_ID = '99999999-9999-4999-8999-999999999999';
const PAYMENT_ID = '123456789';

/** Assinatura calculada à parte (node:crypto), como o Mercado Pago faz. */
function sign(dataId: string, requestId: string, ts = '1704908010') {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return `ts=${ts},v1=${createHmac('sha256', SECRET).update(manifest).digest('hex')}`;
}

let payment: Record<string, unknown>;
let mpStatus: number;
let calls: MarkPaidArgs[];
let result: MarkPaidResult;

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url === `https://api.mercadopago.com/v1/payments/${PAYMENT_ID}`) {
    return new Response(JSON.stringify(payment), { status: mpStatus });
  }
  throw new Error(`fetch inesperado: ${url}`);
});

beforeEach(() => {
  payment = {
    id: Number(PAYMENT_ID),
    status: 'approved',
    transaction_amount: 89.8,
    currency_id: 'BRL',
    external_reference: ORDER_ID,
    payment_type_id: 'bank_transfer',
    payment_method_id: 'pix',
  };
  mpStatus = 200;
  calls = [];
  result = 'paid';
  fetchMock.mockClear();
});

function app() {
  return createApp({
    fetch: fetchMock,
    rateLimitHit: async () => true,
    webhookRepo: () => ({
      markOrderPaid: async (args) => {
        calls.push(args);
        return result;
      },
    }),
  });
}

function notify(
  opts: { dataId?: string; type?: string; signature?: string | null; envOverride?: Bindings } = {},
) {
  const dataId = opts.dataId ?? PAYMENT_ID;
  const requestId = 'req-abc';
  const headers: Record<string, string> = { 'x-request-id': requestId };
  const signature = opts.signature === undefined ? sign(dataId, requestId) : opts.signature;
  if (signature) headers['x-signature'] = signature;
  return app().request(
    `/webhooks/mercadopago?data.id=${dataId}&type=${opts.type ?? 'payment'}`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      // O corpo é ignorado: tudo vem da consulta à API do Mercado Pago.
      body: JSON.stringify({ type: 'payment', data: { id: dataId }, transaction_amount: 0.01 }),
    },
    opts.envOverride ?? env,
  );
}

describe('webhook do Mercado Pago — pagamento aprovado', () => {
  it('consulta o pagamento e marca o pedido como pago com o valor da API', async () => {
    const res = await notify();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: 'paid' });
    expect(calls).toEqual([
      {
        orderId: ORDER_ID,
        mpPaymentId: PAYMENT_ID,
        amountCents: 8980,
        paymentMethod: 'pix',
        eventId: `payment:${PAYMENT_ID}:approved`,
        payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
  });

  it('arredonda reais para centavos sem erro de float', async () => {
    payment.transaction_amount = 0.1 + 0.2;
    await notify();
    expect(calls[0]?.amountCents).toBe(30);
  });

  it('cartão de crédito vira credit_card', async () => {
    payment.payment_type_id = 'credit_card';
    payment.payment_method_id = 'visa';
    await notify();
    expect(calls[0]?.paymentMethod).toBe('credit_card');
  });

  it('aviso repetido usa o mesmo id de evento (o banco processa uma vez só)', async () => {
    await notify();
    await notify();
    expect(calls[0]?.eventId).toBe(calls[1]?.eventId);
  });

  it('resultado que pede atenção da lojista gera log sem dados pessoais', async () => {
    result = 'amount_mismatch';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await notify();
    expect(res.status).toBe(200);
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain('amount_mismatch');
    expect(logged).toContain(ORDER_ID);
    expect(logged).not.toMatch(/whatsapp|cpf|email/i);
    warn.mockRestore();
  });
});

describe('webhook do Mercado Pago — assinatura', () => {
  it('sem assinatura: 401 e nenhuma consulta', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await notify({ signature: null });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('assinatura de outro segredo: 401', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const forged = `ts=1,v1=${createHmac('sha256', 'outro').update('x').digest('hex')}`;
    expect((await notify({ signature: forged })).status).toBe(401);
    vi.restoreAllMocks();
  });

  it('assinatura válida de OUTRO pagamento não vale para este: 401', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await notify({ signature: sign('999', 'req-abc') });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
    vi.restoreAllMocks();
  });
});

describe('webhook do Mercado Pago — avisos ignorados', () => {
  it('tipo diferente de payment: 200 sem consultar', async () => {
    const res = await notify({ type: 'merchant_order' });
    expect(await res.json()).toEqual({ ok: true, ignored: 'type' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['pending', 'rejected', 'in_process', 'refunded'])(
    'status %s: não marca como pago',
    async (status) => {
      payment.status = status;
      const res = await notify();
      expect(await res.json()).toEqual({ ok: true, ignored: 'status' });
      expect(calls).toHaveLength(0);
    },
  );

  it('moeda diferente de BRL ou referência inválida: ignora', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    payment.currency_id = 'USD';
    await notify();
    payment.currency_id = 'BRL';
    payment.external_reference = 'nao-e-uuid';
    await notify();
    expect(calls).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('pagamento inexistente no Mercado Pago: 200 ignorado', async () => {
    mpStatus = 404;
    expect(await (await notify()).json()).toEqual({ ok: true, ignored: 'not_found' });
  });

  it('id de pagamento malformado: 400', async () => {
    expect((await notify({ dataId: 'abc' })).status).toBe(400);
  });
});

describe('webhook do Mercado Pago — falhas', () => {
  it('Mercado Pago fora do ar: 503 para o aviso ser reenviado depois', async () => {
    mpStatus = 500;
    expect((await notify()).status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it('sem os segredos: 503 e log só com os nomes', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await notify({ envOverride: testEnv });
    expect(res.status).toBe(503);
    expect(String(log.mock.calls[0]?.[0])).toContain('MP_WEBHOOK_SECRET');
    log.mockRestore();
  });
});
