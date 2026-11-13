// Pedido do cliente: link exclusivo, código + WhatsApp, guardar na conta e conta (API simulada:
// banco em memória, Turnstile e Supabase Auth falsos; nada real é chamado).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { orderViewSchema, type OrderRow, type Profile } from '@sparks/shared';
import { createApp } from '../app';
import { generateOrderToken, hashOrderToken } from '../checkout/token';
import { USER_ID, createTestKey, signToken, testEnv, type TestKey } from '../test-utils';
import type { OrdersRepo } from './repo';
import { ORDER_MESSAGES } from './route';

const PEPPER = 'pimenta-de-teste-com-mais-de-trinta-e-dois-caracteres';
const env = { ...testEnv, ORDER_TOKEN_PEPPER: PEPPER };
const WHATSAPP = '79988887777';
const OTHER_USER = '00000000-0000-4000-8000-0000000000bb';
const PRODUCT_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT_B = '22222222-2222-4222-8222-222222222222';

let key: TestKey;
beforeAll(async () => {
  key = await createTestKey();
});

function row(over: Partial<OrderRow> = {}): OrderRow {
  return {
    code: 'SPK-7F3K2',
    status: 'paid',
    customer_user_id: null,
    customer_name: 'Maria Aparecida da Silva',
    address: {
      cep: '49000000',
      street: 'Rua Secreta',
      number: '123',
      district: 'Jardins',
      city: 'Aracaju',
      uf: 'SE',
    },
    shipping_service: 'local',
    shipping_label: 'Entrega local',
    shipping_carrier: null,
    shipping_cents: 1200,
    shipping_days_min: 1,
    shipping_days_max: 2,
    tracking_code: null,
    subtotal_cents: 5000,
    discount_cents: 500,
    gift_wrap_cents: 300,
    total_cents: 6000,
    payment_method: 'pix',
    paid_at: '2026-11-10T12:00:00Z',
    reserved_until: '2026-11-10T11:50:00Z',
    created_at: '2026-11-10T11:30:00Z',
    order_items: [{ name_snapshot: 'Caderno capa dura', unit_price_cents: 2500, qty: 2 }],
    order_events: [
      { to_status: 'paid', created_at: '2026-11-10T12:00:00Z' },
      { to_status: 'awaiting_payment', created_at: '2026-11-10T11:30:00Z' },
    ],
    ...over,
  };
}

let stored: Map<string, OrderRow>; // por hash do link
let profile: Profile;
let favorites: string[];
let repo: OrdersRepo;

beforeEach(() => {
  stored = new Map();
  profile = { name: null, whatsapp: null, defaultAddress: null };
  favorites = [];
  repo = {
    findByTokenHash: vi.fn(async (hash: string) => stored.get(hash) ?? null),
    findByCodeAndWhatsapp: vi.fn(async (code: string, whatsapp: string) =>
      code === 'SPK-7F3K2' && whatsapp === WHATSAPP ? row() : null,
    ),
    findByUserAndCode: vi.fn(async (userId: string, code: string) =>
      userId === USER_ID && code === 'SPK-7F3K2' ? row({ customer_user_id: USER_ID }) : null,
    ),
    listByUser: vi.fn(async (userId: string) =>
      userId === USER_ID ? [row({ customer_user_id: USER_ID })] : [],
    ),
    claimByTokenHash: vi.fn(async (hash: string, userId: string) => {
      const found = stored.get(hash);
      if (!found) return false;
      if (found.customer_user_id && found.customer_user_id !== userId) return false;
      stored.set(hash, { ...found, customer_user_id: userId });
      return true;
    }),
    getProfile: vi.fn(async () => profile),
    saveProfile: vi.fn(async (_id: string, input) => {
      profile = {
        name: input.name,
        whatsapp: input.whatsapp,
        defaultAddress: input.defaultAddress,
      };
    }),
    listFavorites: vi.fn(async () => favorites),
    replaceFavorites: vi.fn(async (_id: string, ids: string[]) => {
      favorites = ids.filter((id) => id === PRODUCT_A || id === PRODUCT_B);
      return favorites;
    }),
  };
});

interface Options {
  allow?: boolean;
  captcha?: boolean;
  bucketLimit?: (key: string) => boolean;
  env?: Record<string, string>;
}

function makeApp(options: Options = {}) {
  const hits: string[] = [];
  const app = createApp({
    ordersRepo: () => repo,
    getJwks: async () => [key.publicJwk],
    rateLimitHit: async (_c, k) => {
      hits.push(k);
      if (options.bucketLimit) return options.bucketLimit(k);
      return options.allow !== false;
    },
    fetch: async () => Response.json({ success: options.captcha !== false }),
  });
  return {
    hits,
    request: (path: string, init?: RequestInit) =>
      app.request(path, init, { ...env, ...options.env }),
  };
}

function post(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}
function put(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { ...post(body, headers), method: 'PUT' };
}
async function bearer(overrides: Record<string, unknown> = {}) {
  return { Authorization: `Bearer ${await signToken(key, overrides)}` };
}
async function storeWithToken(over: Partial<OrderRow> = {}) {
  const token = generateOrderToken();
  stored.set(await hashOrderToken(token, PEPPER), row(over));
  return token;
}
const byToken = (token: unknown) => post({ token });
const lookupBody = (over: Record<string, unknown> = {}) => ({
  code: 'SPK-7F3K2',
  whatsapp: '(79) 98888-7777',
  turnstileToken: 'token-de-teste',
  ...over,
});

describe('POST /orders/by-token (link exclusivo no corpo)', () => {
  it('abre o pedido pelo link e devolve só o necessário', async () => {
    const token = await storeWithToken();
    const res = await makeApp().request('/orders/by-token', byToken(token));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as Record<string, unknown>;
    expect(orderViewSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      code: 'SPK-7F3K2',
      status: 'paid',
      customerFirstName: 'Maria',
      destination: { city: 'Aracaju', uf: 'SE' },
      totalCents: 6000,
      linkedToAccount: false,
    });
    // Minimização (R3.7): nada de WhatsApp, rua, número, CEP, nome completo nem ids.
    const text = JSON.stringify(body);
    for (const secret of [WHATSAPP, 'Rua Secreta', '49000000', 'Aparecida', 'Silva', 'Jardins']) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(body)).not.toContain('id');
  });

  it('o repositório recebe o HMAC do link, nunca o link', async () => {
    const token = await storeWithToken();
    await makeApp().request('/orders/by-token', byToken(token));
    expect(repo.findByTokenHash).toHaveBeenCalledWith(await hashOrderToken(token, PEPPER));
    expect(vi.mocked(repo.findByTokenHash).mock.calls[0]?.[0]).not.toContain(token);
  });

  it('link malformado ou inexistente: mesma resposta 404, sem consultar o banco quando malformado', async () => {
    const app = makeApp();
    const malformed = await app.request('/orders/by-token', byToken('curto'));
    expect(malformed.status).toBe(404);
    expect(repo.findByTokenHash).not.toHaveBeenCalled();
    const unknown = await app.request('/orders/by-token', byToken(generateOrderToken()));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual(await malformed.json());
  });

  it('mostra a validade da reserva só enquanto aguarda pagamento', async () => {
    const waiting = await storeWithToken({ status: 'awaiting_payment', paid_at: null });
    const paid = await storeWithToken({ status: 'paid' });
    const app = makeApp();
    const a = (await (await app.request('/orders/by-token', byToken(waiting))).json()) as {
      reservedUntil: string | null;
    };
    const b = (await (await app.request('/orders/by-token', byToken(paid))).json()) as {
      reservedUntil: string | null;
    };
    expect(a.reservedUntil).toBe('2026-11-10T11:50:00Z');
    expect(b.reservedUntil).toBeNull();
  });

  it('pedido aguardando frete sai sem valor de frete e sem serviço', async () => {
    const token = await storeWithToken({
      status: 'awaiting_shipping_quote',
      shipping_cents: null,
      shipping_label: null,
      shipping_service: null,
      shipping_days_min: null,
      shipping_days_max: null,
      reserved_until: null,
      total_cents: 4800,
      paid_at: null,
      payment_method: null,
    });
    const body = (await (await makeApp().request('/orders/by-token', byToken(token))).json()) as {
      shippingCents: number | null;
      shipping: unknown;
      status: string;
    };
    expect(body.status).toBe('awaiting_shipping_quote');
    expect(body.shippingCents).toBeNull();
    expect(body.shipping).toBeNull();
  });

  it('histórico em ordem cronológica e rastreio quando existe', async () => {
    const token = await storeWithToken({ status: 'shipped', tracking_code: 'AB123456789BR' });
    const body = (await (await makeApp().request('/orders/by-token', byToken(token))).json()) as {
      events: { status: string }[];
      trackingCode: string;
    };
    expect(body.events.map((e) => e.status)).toEqual(['awaiting_payment', 'paid']);
    expect(body.trackingCode).toBe('AB123456789BR');
  });

  it('respeita o limite de requisições', async () => {
    const res = await makeApp({ allow: false }).request(
      '/orders/by-token',
      byToken(generateOrderToken()),
    );
    expect(res.status).toBe(429);
    expect(repo.findByTokenHash).not.toHaveBeenCalled();
  });

  it('sem a pimenta configurada: 503 (falha fechada)', async () => {
    const token = generateOrderToken();
    const res = await makeApp({ env: { ORDER_TOKEN_PEPPER: 'curta' } }).request(
      '/orders/by-token',
      byToken(token),
    );
    expect(res.status).toBe(503);
    expect(repo.findByTokenHash).not.toHaveBeenCalled();
  });

  it('o retorno do Mercado Pago (parâmetros na URL) não muda o que o servidor responde', async () => {
    const token = await storeWithToken({ status: 'awaiting_payment', paid_at: null });
    const res = await makeApp().request(
      '/orders/by-token?status=approved&collection_status=approved&payment_id=1',
      byToken(token),
    );
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('awaiting_payment');
  });

  it('o link antigo na URL (GET) deixou de existir e o link não é aceito fora do corpo', async () => {
    const token = await storeWithToken();
    const app = makeApp();
    expect((await app.request(`/orders/by-token/${token}`)).status).toBe(404);
    expect((await app.request(`/orders/by-token?token=${token}`)).status).toBe(404);
    expect((await app.request('/orders/by-token', post({}))).status).toBe(404);
    expect(repo.findByTokenHash).not.toHaveBeenCalled();
  });

  it('o link não aparece em nenhuma resposta de erro nem no log de erro', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const token = generateOrderToken();
    const app = makeApp();
    vi.mocked(repo.findByTokenHash).mockRejectedValueOnce(new Error(`falha com ${token}`));
    const responses = [
      await app.request('/orders/by-token', byToken(token)), // 500 interno
      await app.request('/orders/by-token', byToken(token)), // 404 não encontrado
      await app.request('/orders/by-token', byToken(`${token}x`)), // formato inválido
      await app.request('/orders/by-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: `{"token":"${token}`, // JSON quebrado
      }),
    ];
    expect(responses.map((r) => r.status)).toEqual([500, 404, 404, 400]);
    for (const r of responses) expect(await r.text()).not.toContain(token);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(token);
    errors.mockRestore();
  });
});

describe('POST /orders/lookup (código + WhatsApp)', () => {
  it('acha o pedido, com WhatsApp mascarado ou com +55', async () => {
    const app = makeApp();
    const a = await app.request('/orders/lookup', post(lookupBody()));
    expect(a.status).toBe(200);
    const b = await app.request(
      '/orders/lookup',
      post(lookupBody({ code: ' spk-7f3k2 ', whatsapp: '+55 79 98888-7777' })),
    );
    expect(b.status).toBe(200);
    expect(repo.findByCodeAndWhatsapp).toHaveBeenLastCalledWith('SPK-7F3K2', WHATSAPP);
    const body = (await a.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain(WHATSAPP);
  });

  it('anti-enumeração: pedido inexistente e dados que não batem têm resposta idêntica', async () => {
    const app = makeApp();
    const wrongPhone = await app.request(
      '/orders/lookup',
      post(lookupBody({ whatsapp: '79911112222' })),
    );
    const unknownCode = await app.request(
      '/orders/lookup',
      post(lookupBody({ code: 'SPK-ZZZZZ' })),
    );
    expect(wrongPhone.status).toBe(404);
    expect(unknownCode.status).toBe(404);
    const unknownBody = (await unknownCode.json()) as { error: { message: string } };
    expect(await wrongPhone.json()).toEqual(unknownBody);
    expect(wrongPhone.headers.get('Content-Type')).toBe(unknownCode.headers.get('Content-Type'));
    expect(unknownBody.error.message).toBe(ORDER_MESSAGES.lookupNotFound);
  });

  it('exige Turnstile antes de consultar o banco', async () => {
    const res = await makeApp({ captcha: false }).request('/orders/lookup', post(lookupBody()));
    expect(res.status).toBe(403);
    expect(repo.findByCodeAndWhatsapp).not.toHaveBeenCalled();
  });

  it('sem token do Turnstile ou com campos inválidos: 400, sem consultar o banco', async () => {
    const app = makeApp();
    for (const bad of [
      lookupBody({ turnstileToken: '' }),
      lookupBody({ code: 'ABC' }),
      lookupBody({ whatsapp: '123' }),
      { code: 'SPK-7F3K2' },
    ]) {
      const res = await app.request('/orders/lookup', post(bad));
      expect(res.status).toBe(400);
    }
    const garbage = await app.request('/orders/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{nao-e-json',
    });
    expect(garbage.status).toBe(400);
    expect(repo.findByCodeAndWhatsapp).not.toHaveBeenCalled();
  });

  it('limite por IP: 429 sem Turnstile nem banco', async () => {
    const res = await makeApp({ allow: false }).request('/orders/lookup', post(lookupBody()));
    expect(res.status).toBe(429);
    expect(repo.findByCodeAndWhatsapp).not.toHaveBeenCalled();
  });

  it('limite por WhatsApp: estourou, 429; e o número nunca aparece nas chaves do limite', async () => {
    const app = makeApp({ bucketLimit: (k) => !k.startsWith('order-lookup-wa:') });
    const res = await app.request('/orders/lookup', post(lookupBody()));
    expect(res.status).toBe(429);
    expect(repo.findByCodeAndWhatsapp).not.toHaveBeenCalled();
    expect(app.hits.some((k) => k.startsWith('order-lookup-wa:'))).toBe(true);
    for (const k of app.hits) expect(k).not.toContain(WHATSAPP);
  });

  it('não vaza o pedido nem o número em logs de erro', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(repo.findByCodeAndWhatsapp).mockRejectedValueOnce(new Error(`falha ${WHATSAPP}`));
    const res = await makeApp().request('/orders/lookup', post(lookupBody()));
    expect(res.status).toBe(500);
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).not.toContain(WHATSAPP);
    spy.mockRestore();
  });
});

describe('POST /orders/claim (guardar na conta)', () => {
  it('exige login', async () => {
    const token = await storeWithToken();
    const res = await makeApp().request('/orders/claim', post({ token }));
    expect(res.status).toBe(401);
  });

  it('liga o pedido à conta de quem tem o link', async () => {
    const token = await storeWithToken();
    const res = await makeApp().request('/orders/claim', post({ token }, await bearer()));
    expect(res.status).toBe(200);
    expect(repo.claimByTokenHash).toHaveBeenCalledWith(
      await hashOrderToken(token, PEPPER),
      USER_ID,
    );
    const again = await makeApp().request('/orders/claim', post({ token }, await bearer()));
    expect(again.status).toBe(200);
  });

  it('pedido de outra conta ou link inexistente: a mesma resposta 404', async () => {
    const token = await storeWithToken({ customer_user_id: OTHER_USER });
    const app = makeApp();
    const taken = await app.request('/orders/claim', post({ token }, await bearer()));
    const missing = await app.request(
      '/orders/claim',
      post({ token: generateOrderToken() }, await bearer()),
    );
    const malformed = await app.request('/orders/claim', post({ token: 'x' }, await bearer()));
    expect(taken.status).toBe(404);
    expect(await taken.json()).toEqual(await missing.json());
    expect(malformed.status).toBe(404);
  });
});

describe('/me (conta do cliente)', () => {
  it('exige login em todas as rotas', async () => {
    const app = makeApp();
    for (const [method, path] of [
      ['GET', '/me/orders'],
      ['GET', '/me/orders/SPK-7F3K2'],
      ['GET', '/me/profile'],
      ['PUT', '/me/profile'],
      ['GET', '/me/favorites'],
      ['PUT', '/me/favorites'],
    ] as const) {
      const res = await app.request(path, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    expect(repo.listByUser).not.toHaveBeenCalled();
  });

  it('token com assinatura de outra chave é recusado', async () => {
    const other = await createTestKey('chave-teste');
    const res = await makeApp().request('/me/orders', {
      headers: { Authorization: `Bearer ${await signToken(other)}` },
    });
    expect(res.status).toBe(401);
  });

  it('Meus pedidos: só os da conta logada (id vem do JWT)', async () => {
    const mine = await makeApp().request('/me/orders', { headers: await bearer() });
    expect(mine.status).toBe(200);
    expect(await mine.json()).toEqual({
      orders: [
        {
          code: 'SPK-7F3K2',
          status: 'paid',
          createdAt: '2026-11-10T11:30:00Z',
          totalCents: 6000,
          itemCount: 2,
        },
      ],
    });
    expect(repo.listByUser).toHaveBeenCalledWith(USER_ID);
    const other = await makeApp().request('/me/orders', {
      headers: await bearer({ sub: OTHER_USER }),
    });
    expect(await other.json()).toEqual({ orders: [] });
  });

  it('detalhe de "Meus pedidos": só do dono; de outra conta ou inexistente dá 404 igual', async () => {
    const own = await makeApp().request('/me/orders/SPK-7F3K2', { headers: await bearer() });
    expect(own.status).toBe(200);
    expect(((await own.json()) as { linkedToAccount: boolean }).linkedToAccount).toBe(true);
    const other = await makeApp().request('/me/orders/SPK-7F3K2', {
      headers: await bearer({ sub: OTHER_USER }),
    });
    const bad = await makeApp().request('/me/orders/nada', { headers: await bearer() });
    expect(other.status).toBe(404);
    expect(bad.status).toBe(404);
    expect(await other.json()).toEqual(await bad.json());
  });

  it('endereço salvo: grava, devolve e aceita limpar', async () => {
    const app = makeApp();
    const address = {
      cep: '49000-000',
      street: 'Rua das Flores',
      number: '10',
      district: 'Jardins',
      city: 'Aracaju',
      uf: 'SE',
      addressType: 'urban',
    };
    const saved = await app.request(
      '/me/profile',
      put(
        { name: ' Maria ', whatsapp: '(79) 98888-7777', defaultAddress: address, preco: 1 },
        await bearer(),
      ),
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      name: 'Maria',
      whatsapp: WHATSAPP,
      defaultAddress: { cep: '49000000', city: 'Aracaju', uf: 'SE' },
    });
    expect(repo.saveProfile).toHaveBeenCalledWith(
      USER_ID,
      expect.not.objectContaining({ preco: 1 }),
    );

    const cleared = await app.request(
      '/me/profile',
      put({ name: '', whatsapp: '', defaultAddress: null }, await bearer()),
    );
    expect(await cleared.json()).toEqual({ name: null, whatsapp: null, defaultAddress: null });
    expect((await app.request('/me/profile', { headers: await bearer() })).status).toBe(200);
  });

  it('endereço salvo: dados inválidos não gravam', async () => {
    const app = makeApp();
    const bad = await app.request(
      '/me/profile',
      put({ name: 'Maria', whatsapp: '123', defaultAddress: null }, await bearer()),
    );
    expect(bad.status).toBe(400);
    const badAddress = await app.request(
      '/me/profile',
      put({ name: 'Maria', whatsapp: '', defaultAddress: { cep: 'x' } }, await bearer()),
    );
    expect(badAddress.status).toBe(400);
    expect(repo.saveProfile).not.toHaveBeenCalled();
  });

  it('favoritos: troca pela lista dada e ignora produto que não existe', async () => {
    const app = makeApp();
    const res = await app.request(
      '/me/favorites',
      put({ ids: [PRODUCT_A, '33333333-3333-4333-8333-333333333333'] }, await bearer()),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ids: [PRODUCT_A] });
    const list = await app.request('/me/favorites', { headers: await bearer() });
    expect(await list.json()).toEqual({ ids: [PRODUCT_A] });
    expect(repo.replaceFavorites).toHaveBeenCalledWith(USER_ID, expect.any(Array));
  });

  it('favoritos: id inválido, repetido ou lista enorme são recusados', async () => {
    const app = makeApp();
    for (const ids of [
      ['nao-e-uuid'],
      [PRODUCT_A, PRODUCT_A],
      Array.from(
        { length: 201 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      ),
    ]) {
      const res = await app.request('/me/favorites', put({ ids }, await bearer()));
      expect(res.status).toBe(400);
    }
    expect(repo.replaceFavorites).not.toHaveBeenCalled();
  });

  it('preflight do CORS aceita PUT só para a origem do site', async () => {
    const app = makeApp();
    const ok = await app.request('/me/profile', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://loja.teste',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect(ok.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://loja.teste');
    const bad = await app.request('/me/profile', {
      method: 'OPTIONS',
      headers: { Origin: 'https://malvado.exemplo', 'Access-Control-Request-Method': 'PUT' },
    });
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
