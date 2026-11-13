import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// API simulada: o fetch é falso; nenhum pedido real é consultado.
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
const fetchMock = vi.fn<typeof fetch>();

const order = {
  code: 'SPK-7F3K2',
  status: 'awaiting_payment',
  createdAt: '2026-11-10T14:30:00Z',
  paidAt: null,
  reservedUntil: '2026-11-10T15:00:00Z',
  customerFirstName: 'Maria',
  destination: { city: 'Aracaju', uf: 'SE' },
  items: [{ name: 'Caderno', qty: 1, unitPriceCents: 2500 }],
  subtotalCents: 2500,
  discountCents: 0,
  shippingCents: 1200,
  giftWrapCents: 0,
  totalCents: 3700,
  shipping: { label: 'Entrega local', carrier: null, daysMin: 1, daysMax: 2 },
  paymentMethod: null,
  trackingCode: null,
  events: [],
  linkedToAccount: false,
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function load() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.test/');
  const [api, { ApiError }] = await Promise.all([import('./api'), import('@/lib/api')]);
  return { ...api, ApiError };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('pedido pelo link exclusivo (API simulada)', () => {
  it('chama POST /orders/by-token com o link só no corpo, sem credenciais', async () => {
    fetchMock.mockResolvedValue(json(order));
    const { fetchOrderByToken } = await load();
    const result = await fetchOrderByToken(TOKEN);
    expect(result.status).toBe('awaiting_payment');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.test/orders/by-token');
    expect(String(url)).not.toContain(TOKEN);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ token: TOKEN });
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });

  it('404 vira ApiError com o código order_not_found e a mensagem do servidor', async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: 'order_not_found', message: 'Pedido não encontrado.' } }, 404),
    );
    const { fetchOrderByToken, ApiError } = await load();
    await expect(fetchOrderByToken(TOKEN)).rejects.toMatchObject({
      code: 'order_not_found',
      status: 404,
      message: 'Pedido não encontrado.',
    });
    await expect(fetchOrderByToken(TOKEN)).rejects.toBeInstanceOf(ApiError);
  });

  it('resposta fora do formato é recusada, nunca mostrada', async () => {
    fetchMock.mockResolvedValue(json({ ...order, status: 'pago-por-engano' }));
    const { fetchOrderByToken } = await load();
    await expect(fetchOrderByToken(TOKEN)).rejects.toMatchObject({ code: 'unexpected_response' });
  });

  it('sem internet: mensagem em português', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { fetchOrderByToken } = await load();
    await expect(fetchOrderByToken(TOKEN)).rejects.toMatchObject({ code: 'network' });
  });
});

describe('consulta por código + WhatsApp (API simulada)', () => {
  it('envia código, WhatsApp e token do Turnstile e devolve o pedido', async () => {
    fetchMock.mockResolvedValue(json({ ...order, status: 'paid' }));
    const { lookupOrder } = await load();
    const result = await lookupOrder({
      code: 'SPK-7F3K2',
      whatsapp: '79988887777',
      turnstileToken: 'turnstile-ok',
    });
    expect(result.status).toBe('paid');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.test/orders/lookup');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      code: 'SPK-7F3K2',
      whatsapp: '79988887777',
      turnstileToken: 'turnstile-ok',
    });
  });

  it('a mensagem de "não achei" é a do servidor (igual para os dois casos)', async () => {
    const message = 'Não encontramos um pedido com esse código e esse WhatsApp.';
    fetchMock.mockResolvedValue(json({ error: { code: 'order_not_found', message } }, 404));
    const { lookupOrder } = await load();
    const input = { code: 'SPK-7F3K2', whatsapp: '79988887777', turnstileToken: 't' };
    await expect(lookupOrder(input)).rejects.toMatchObject({ status: 404, message });
  });
});

describe('conta do cliente (API simulada)', () => {
  it('envia o token de acesso só nas rotas da conta', async () => {
    fetchMock.mockImplementation(async () => json({ orders: [] }));
    const { fetchMyOrders, claimOrder } = await load();
    expect(await fetchMyOrders('jwt-de-teste')).toEqual([]);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer jwt-de-teste',
    );
    fetchMock.mockResolvedValue(json({ linked: true }));
    await claimOrder(TOKEN, 'jwt-de-teste');
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(url).toBe('https://api.test/orders/claim');
    expect(JSON.parse(String(init?.body))).toEqual({ token: TOKEN });
  });

  it('endereço salvo e favoritos usam PUT com o corpo certo', async () => {
    const { saveProfile, saveAccountFavorites } = await load();
    fetchMock.mockResolvedValueOnce(json({ name: null, whatsapp: null, defaultAddress: null }));
    await saveProfile({ name: null, whatsapp: null, defaultAddress: null }, 'jwt');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.test/me/profile');

    const id = '11111111-1111-4111-8111-111111111111';
    fetchMock.mockResolvedValueOnce(json({ ids: [id] }));
    expect(await saveAccountFavorites([id], 'jwt')).toEqual([id]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ ids: [id] });
  });
});
