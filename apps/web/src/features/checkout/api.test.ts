import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { buildCheckoutRequest } from './checkout-logic';

// API simulada: nenhum pedido nem pagamento real. O fetch é falso.
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
const checkoutUrl = 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=abc';
const body = { items: [], turnstileToken: 't' } as unknown as ReturnType<
  typeof buildCheckoutRequest
>;

const fetchMock = vi.fn<typeof fetch>();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function load() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.test/');
  const [{ submitCheckout }, { ApiError }] = await Promise.all([
    import('./api'),
    import('@/lib/api'),
  ]);
  return { submitCheckout, ApiError };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('submitCheckout (API simulada)', () => {
  it('chama POST /checkout e devolve o link do Mercado Pago', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          code: 'SPK4X7QA',
          token: TOKEN,
          status: 'awaiting_payment',
          totalCents: 5990,
          orderUrl: `https://sparks.example/pedido/${TOKEN}/`,
          checkoutUrl,
        },
        201,
      ),
    );
    const { submitCheckout } = await load();
    const outcome = await submitCheckout(body);
    expect(outcome).toMatchObject({ kind: 'payment', code: 'SPK4X7QA', checkoutUrl });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.test/checkout');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ items: [], turnstileToken: 't' });
  });

  it('pedido aguardando frete volta com a mensagem de que não há cobrança', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          code: 'SPK4X7QA',
          token: TOKEN,
          status: 'awaiting_shipping_quote',
          totalCents: 4000,
          orderUrl: `https://sparks.example/pedido/${TOKEN}/`,
          message:
            'Recebemos seu pedido. A loja vai confirmar o frete pelo WhatsApp antes de qualquer cobrança.',
        },
        201,
      ),
    );
    const { submitCheckout } = await load();
    const outcome = await submitCheckout(body);
    expect(outcome.kind).toBe('awaiting_quote');
    if (outcome.kind === 'awaiting_quote') {
      expect(outcome.message).toContain('antes de qualquer cobrança');
      expect(outcome.totalCents).toBe(4000);
    }
  });

  it('erro do servidor chega como ApiError com código e mensagem em português', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          error: {
            code: 'shipping_changed',
            message: 'O frete mudou desde a cotação. Escolha a opção de entrega de novo.',
          },
        },
        409,
      ),
    );
    const { submitCheckout, ApiError } = await load();
    const error = await submitCheckout(body).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'shipping_changed' });
    expect((error as Error).message).toContain('O frete mudou');
  });

  it('sem conexão devolve a mensagem de rede', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const { submitCheckout } = await load();
    await expect(submitCheckout(body)).rejects.toMatchObject({ code: 'network', status: 0 });
  });

  it('resposta 201 com formato inesperado ou link de pagamento fora do Mercado Pago é recusada', async () => {
    const { submitCheckout } = await load();
    fetchMock.mockResolvedValueOnce(json({ ok: true }, 201));
    await expect(submitCheckout(body)).rejects.toMatchObject({ code: 'unexpected_response' });
    fetchMock.mockResolvedValueOnce(
      json(
        {
          code: 'SPK4X7QA',
          status: 'awaiting_payment',
          totalCents: 100,
          checkoutUrl: 'https://evil.example/pagar',
        },
        201,
      ),
    );
    await expect(submitCheckout(body)).rejects.toMatchObject({ code: 'unexpected_response' });
  });
});
