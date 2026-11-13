import type { AdminOrderDetail } from '@sparks/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import type { Bindings } from '../env';
import { createTestKey, signToken, testEnv, type TestKey } from '../test-utils';
import type { AdminOrdersRepo, QuoteContext } from './orders-repo';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const env: Bindings = {
  ...testEnv,
  MP_ACCESS_TOKEN: 'TEST-token-mp',
  ORDER_TOKEN_PEPPER: 'pimenta-de-teste-com-mais-de-32-caracteres-aaa',
};

let key: TestKey;
let repo: AdminOrdersRepo;
let fetchMp: ReturnType<typeof vi.fn>;
let context: QuoteContext;
let detail: AdminOrderDetail;

beforeAll(async () => {
  key = await createTestKey();
});

beforeEach(() => {
  context = {
    code: 'SPK-7F3K2',
    status: 'awaiting_shipping_quote',
    subtotalCents: 5000,
    discountCents: 500,
    giftWrapCents: 300,
    items: [{ unitPriceCents: 2500, qty: 2 }],
  };
  detail = {
    id: ORDER_ID,
    code: 'SPK-7F3K2',
    status: 'paid',
    createdAt: '2026-11-10T12:00:00.000Z',
    paidAt: null,
    reservedUntil: null,
    customer: { name: 'Ana Souza', whatsapp: '79999991234', email: null },
    address: {
      cep: '49000000',
      street: 'Rua A',
      number: '10',
      complement: null,
      district: 'Centro',
      city: 'Aracaju',
      uf: 'SE',
      reference: null,
    },
    addressType: 'urban',
    items: [{ name: 'Caderno', qty: 2, unitPriceCents: 2500 }],
    subtotalCents: 5000,
    discountCents: 500,
    couponCode: null,
    giftWrap: { name: 'Embalagem', cents: 300, message: 'Feliz aniversário!' },
    shipping: { cents: 1500, label: 'PAC', carrier: 'Correios', daysMin: 3, daysMax: 5 },
    totalCents: 6300,
    paymentMethod: 'pix',
    paymentId: null,
    paymentUrl: null,
    trackingCode: null,
    events: [],
  };
  repo = {
    list: vi.fn(async (query) => ({
      orders: [],
      page: query.page,
      hasMore: false,
      pending: { awaitingShippingQuote: 1, paid: 2 },
    })),
    get: vi.fn(async () => detail),
    quoteContext: vi.fn(async () => context),
    setStatus: vi.fn(async () => 'ok' as const),
    setTracking: vi.fn(async () => 'ok' as const),
    applyQuote: vi.fn(async () => 'ok' as const),
    paymentAlerts: vi.fn(async () => []),
  };
  fetchMp = vi.fn(async () =>
    Response.json({ id: 'pref-1', init_point: 'https://www.mercadopago.com.br/checkout/pref-1' }),
  );
});

function app(allow = true) {
  return createApp({
    adminOrdersRepo: () => repo,
    getJwks: async () => [key.publicJwk],
    rateLimitHit: async () => allow,
    fetch: fetchMp as unknown as typeof fetch,
  });
}

async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  opts: { role?: string | null; aal?: string; allow?: boolean } = {},
) {
  const role = opts.role === undefined ? 'admin' : opts.role;
  const token =
    role === null
      ? null
      : await signToken(key, { app_metadata: { role }, aal: opts.aal ?? 'aal2' });
  return app(opts.allow ?? true).request(
    path,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
}
const errorCode = async (r: Response) =>
  ((await r.json()) as { error: { code: string } }).error.code;

const quoteBody = { shippingCents: 4000, daysMin: 5, daysMax: 9, label: 'Rodonaves' };

describe('acesso ao painel de pedidos', () => {
  const calls: [string, string, unknown?][] = [
    ['/admin/orders', 'GET'],
    ['/admin/orders/payment-alerts', 'GET'],
    [`/admin/orders/${ORDER_ID}`, 'GET'],
    [`/admin/orders/${ORDER_ID}/status`, 'POST', { status: 'preparing' }],
    [`/admin/orders/${ORDER_ID}/tracking`, 'PUT', { trackingCode: 'ABCD1234' }],
    [`/admin/orders/${ORDER_ID}/quote`, 'POST', quoteBody],
  ];

  it('recusa sem login (401), sem papel admin (403) e sem segunda etapa, antes do banco', async () => {
    for (const [path, method, body] of calls) {
      expect((await request(path, method, body, { role: null })).status).toBe(401);
      expect((await request(path, method, body, { role: 'customer' })).status).toBe(403);
      const noMfa = await request(path, method, body, { aal: 'aal1' });
      expect(noMfa.status).toBe(403);
      expect(await errorCode(noMfa)).toBe('mfa_required');
    }
    for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
    expect(fetchMp).not.toHaveBeenCalled();
  });

  it('aplica o limite de requisições (429) antes de tocar no banco', async () => {
    const r = await request('/admin/orders', 'GET', undefined, { allow: false });
    expect(r.status).toBe(429);
    expect(repo.list).not.toHaveBeenCalled();
  });
});

describe('lista e detalhe', () => {
  it('filtra por status, período e código, e nunca devolve WhatsApp na lista', async () => {
    const r = await request(
      '/admin/orders?status=paid&from=2026-11-01&to=2026-11-12&q=spk-7f&page=2',
    );
    expect(r.status).toBe(200);
    expect(repo.list).toHaveBeenCalledWith({
      status: 'paid',
      from: '2026-11-01',
      to: '2026-11-12',
      q: 'SPK-7F',
      page: 2,
    });
    expect(JSON.stringify(await r.json())).not.toContain('whatsapp');
  });

  it('recusa filtros inválidos e busca com caracteres de filtro do banco', async () => {
    for (const qs of ['status=x', 'q=a,or(id.neq.0)', 'from=hoje', 'page=0', 'q=a%25']) {
      expect((await request(`/admin/orders?${qs}`)).status).toBe(400);
    }
    expect(repo.list).not.toHaveBeenCalled();
  });

  it('mostra o detalhe e responde 404 para id inexistente ou malformado', async () => {
    const ok = await request(`/admin/orders/${ORDER_ID}`);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as AdminOrderDetail).giftWrap?.message).toBe('Feliz aniversário!');
    vi.mocked(repo.get).mockResolvedValueOnce(null);
    expect((await request(`/admin/orders/${ORDER_ID}`)).status).toBe(404);
    expect((await request('/admin/orders/nao-e-uuid')).status).toBe(404);
  });

  it('lista os alertas de pagamento', async () => {
    vi.mocked(repo.paymentAlerts).mockResolvedValueOnce([
      {
        result: 'double_payment',
        orderId: ORDER_ID,
        orderCode: 'SPK-7F3K2',
        orderTotalCents: 6300,
        paidCents: 6300,
        paymentId: '123',
        at: '2026-11-12T10:00:00Z',
      },
    ]);
    const r = await request('/admin/orders/payment-alerts');
    expect(r.status).toBe(200);
    expect(((await r.json()) as { alerts: unknown[] }).alerts).toHaveLength(1);
  });
});

describe('mudança de status e rastreio', () => {
  it('passa o autor (admin:<id>) e o rastreio normalizado para o banco', async () => {
    const r = await request(`/admin/orders/${ORDER_ID}/status`, 'POST', {
      status: 'shipped',
      trackingCode: ' ab123456789br ',
    });
    expect(r.status).toBe(200);
    const [id, status, tracking, actor] = vi.mocked(repo.setStatus).mock.calls[0]!;
    expect([id, status, tracking]).toEqual([ORDER_ID, 'shipped', 'AB123456789BR']);
    expect(actor).toMatch(/^admin:[0-9a-f-]{36}$/);
  });

  it('rastreio junto com o status só vale para enviado ou entregue (mesma validação do campo)', async () => {
    for (const status of ['preparing', 'canceled', 'returned']) {
      const r = await request(`/admin/orders/${ORDER_ID}/status`, 'POST', {
        status,
        trackingCode: 'AB123456789BR',
      });
      expect(r.status).toBe(400);
    }
    const bad = await request(`/admin/orders/${ORDER_ID}/status`, 'POST', {
      status: 'shipped',
      trackingCode: 'ab 12; drop',
    });
    expect(bad.status).toBe(400);
    expect(repo.setStatus).not.toHaveBeenCalled();
    vi.mocked(repo.setStatus).mockResolvedValueOnce('tracking_not_allowed');
    const db = await request(`/admin/orders/${ORDER_ID}/status`, 'POST', { status: 'delivered' });
    expect(db.status).toBe(400);
  });

  it('não aceita status que não é da lojista (pago, expirado, aguardando pagamento)', async () => {
    for (const status of ['paid', 'expired', 'awaiting_payment', 'banana']) {
      expect((await request(`/admin/orders/${ORDER_ID}/status`, 'POST', { status })).status).toBe(
        400,
      );
    }
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it('traduz as respostas do banco: transição inválida (409), rastreio (400) e inexistente (404)', async () => {
    const send = () => request(`/admin/orders/${ORDER_ID}/status`, 'POST', { status: 'delivered' });
    vi.mocked(repo.setStatus).mockResolvedValueOnce('invalid_transition');
    const conflict = await send();
    expect(conflict.status).toBe(409);
    expect(await errorCode(conflict)).toBe('invalid_transition');
    vi.mocked(repo.setStatus).mockResolvedValueOnce('invalid_tracking');
    expect((await send()).status).toBe(400);
    vi.mocked(repo.setStatus).mockResolvedValueOnce('not_found');
    expect((await send()).status).toBe(404);
  });

  it('grava, troca e apaga o rastreio digitado', async () => {
    const put = (trackingCode: string) =>
      request(`/admin/orders/${ORDER_ID}/tracking`, 'PUT', { trackingCode });
    expect((await put('br123456789xx')).status).toBe(200);
    expect(vi.mocked(repo.setTracking).mock.calls[0]!.slice(0, 2)).toEqual([
      ORDER_ID,
      'BR123456789XX',
    ]);
    expect((await put('')).status).toBe(200);
    expect(vi.mocked(repo.setTracking).mock.calls[1]![1]).toBeNull();
    expect((await put('com espaço')).status).toBe(400);
    expect((await put('https://x.test')).status).toBe(400);
    vi.mocked(repo.setTracking).mockResolvedValueOnce('invalid_status');
    expect((await put('ABCD1234')).status).toBe(409);
  });
});

describe('frete a combinar: valor e prazo da lojista', () => {
  const quote = (body: unknown = quoteBody) =>
    request(`/admin/orders/${ORDER_ID}/quote`, 'POST', body);

  it('recalcula o total no servidor, cria o link de 48 h e só então libera a cobrança', async () => {
    const r = await quote();
    expect(r.status).toBe(200);

    // Total = (5000 - 500) + 4000 + 300 = 8800, em reais com 2 casas só na fronteira do MP.
    const [url, init] = fetchMp.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mercadopago.com/checkout/preferences');
    const body = JSON.parse(String(init.body)) as {
      items: { unit_price: number }[];
      external_reference: string;
      expiration_date_to: string;
    };
    expect(body.items[0]?.unit_price).toBe(88);
    expect(body.external_reference).toBe(ORDER_ID);
    const hours = (Date.parse(body.expiration_date_to) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThan(48.1);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer TEST-token-mp' });

    const [id, applied, actor] = vi.mocked(repo.applyQuote).mock.calls[0]!;
    expect(id).toBe(ORDER_ID);
    expect(applied).toMatchObject({
      shippingCents: 4000,
      daysMin: 5,
      daysMax: 9,
      label: 'Rodonaves',
      carrier: null,
      expectedTotalCents: 8800,
      preferenceId: 'pref-1',
      checkoutUrl: 'https://www.mercadopago.com.br/checkout/pref-1',
    });
    expect(actor).toMatch(/^admin:/);
  });

  it('ignora total ou subtotal enviados pelo navegador (só frete e prazo valem)', async () => {
    await quote({ ...quoteBody, totalCents: 1, subtotalCents: 1, discountCents: 4999 });
    expect(vi.mocked(repo.applyQuote).mock.calls[0]![1].expectedTotalCents).toBe(8800);
  });

  it('não cobra se o link de pagamento não puder ser criado (nada muda no pedido)', async () => {
    fetchMp.mockResolvedValueOnce(new Response('erro', { status: 500 }));
    const r = await quote();
    expect(r.status).toBe(503);
    expect(await errorCode(r)).toBe('payment_unavailable');
    expect(repo.applyQuote).not.toHaveBeenCalled();
  });

  it('recusa resposta inesperada do Mercado Pago (link sem HTTPS)', async () => {
    fetchMp.mockResolvedValueOnce(Response.json({ id: 'p', init_point: 'http://x.test/pay' }));
    expect((await quote()).status).toBe(503);
    expect(repo.applyQuote).not.toHaveBeenCalled();
  });

  it('só libera pedido aguardando frete', async () => {
    context.status = 'awaiting_payment';
    const r = await quote();
    expect(r.status).toBe(409);
    expect(fetchMp).not.toHaveBeenCalled();
    expect(repo.applyQuote).not.toHaveBeenCalled();
  });

  it('recusa subtotal gravado que não bate com os itens', async () => {
    context.subtotalCents = 4000;
    const r = await quote();
    expect(await errorCode(r)).toBe('totals_changed');
    expect(fetchMp).not.toHaveBeenCalled();
  });

  it('valida valor e prazo: centavos inteiros, sem negativo e prazo coerente', async () => {
    for (const bad of [
      { ...quoteBody, shippingCents: 40.5 },
      { ...quoteBody, shippingCents: -100 },
      { ...quoteBody, shippingCents: 99_999_999 },
      { ...quoteBody, daysMin: 9, daysMax: 5 },
      { shippingCents: 4000 },
    ]) {
      expect((await quote(bad)).status).toBe(400);
    }
    expect((await request(`/admin/orders/${ORDER_ID}/quote`, 'POST')).status).toBe(400);
    expect(fetchMp).not.toHaveBeenCalled();
    expect(repo.applyQuote).not.toHaveBeenCalled();
  });

  it('se o banco achar o total diferente (corrida), responde 409 sem liberar', async () => {
    vi.mocked(repo.applyQuote).mockResolvedValueOnce('totals_changed');
    const r = await quote();
    expect(r.status).toBe(409);
    expect(await errorCode(r)).toBe('totals_changed');
  });

  it('segunda liberação do mesmo pedido (outra aba) é recusada pelo banco', async () => {
    vi.mocked(repo.applyQuote).mockResolvedValueOnce('invalid_status');
    expect((await quote()).status).toBe(409);
  });

  it('não registra o WhatsApp nem o link de pagamento nos logs', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(repo.applyQuote).mockRejectedValueOnce(new Error('admin_orders_repo_quote'));
    const r = await quote();
    expect(r.status).toBe(500);
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('79999991234');
    expect(logged).not.toContain('mercadopago.com.br');
    spy.mockRestore();
  });
});
