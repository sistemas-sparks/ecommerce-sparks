import type { HybridShippingConfig, MelhorEnvioResult } from '@sparks/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import type { Bindings } from '../env';
import type { MelhorEnvioClient } from '../shipping/melhor-envio';
import { testEnv } from '../test-utils';
import {
  CheckoutDbError,
  type CheckoutContext,
  type CheckoutCoupon,
  type CheckoutProduct,
  type CheckoutRepo,
  type CreateOrderPayload,
} from './repo';
import { CHECKOUT_MESSAGES } from './route';
import { ORDER_TOKEN_REGEX, hashOrderToken } from './token';

const PEPPER = 'pimenta-de-teste-com-mais-de-32-caracteres!!';
const env: Bindings = { ...testEnv, MP_ACCESS_TOKEN: 'TEST-token-mp', ORDER_TOKEN_PEPPER: PEPPER };

const CANETA = '11111111-1111-4111-8111-111111111111';
const CADERNO = '22222222-2222-4222-8222-222222222222';
const EMBALAGEM = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = '99999999-9999-4999-8999-999999999999';

function productRow(over: Partial<CheckoutProduct> & { id: string }): CheckoutProduct {
  return {
    name: 'Produto',
    priceCents: 1000,
    stock: 10,
    kind: 'regular',
    active: true,
    deleted: false,
    weightG: 200,
    packageSize: 'P',
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    ...over,
  };
}

const OWN_TYPE = '66666666-6666-4666-8666-666666666666';
const OWN_SERVICE = `own:${OWN_TYPE}`;

const shipping: HybridShippingConfig = {
  exceptions: [],
  packageSizes: {
    P: { weightG: 100, lengthCm: 16, widthCm: 11, heightCm: 4 },
    M: { weightG: 400, lengthCm: 30, widthCm: 22, heightCm: 5 },
    G: { weightG: 1000, lengthCm: 35, widthCm: 25, heightCm: 12 },
  },
  settings: {
    handlingDays: 1,
    freeShippingMinCents: 20000,
    maxItemsAutoShipping: null,
    maxWeightAutoG: 5000,
    packageTareG: 0,
    cubicDivisor: null,
  },
  ownTypes: [{ id: OWN_TYPE, name: 'Entrega local', active: true, sortOrder: 0 }],
  ownAreas: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      typeId: OWN_TYPE,
      label: 'Aracaju',
      cepStart: '49000000',
      cepEnd: '49999999',
      priceCents: 800,
      daysMin: 1,
      daysMax: 2,
      active: true,
    },
  ],
  melhorEnvio: { originCep: '49000000', enabledServiceIds: [1, 2], marginCents: 0 },
};

const meItem = (id: number, name: string, price: string) => ({
  id,
  name,
  price,
  delivery_range: { min: 3, max: 5 },
  company: { id: 1, name: 'Correios' },
});
let meResult: MelhorEnvioResult;
let meCalculate: ReturnType<typeof vi.fn>;

class FakeRepo implements CheckoutRepo {
  products = new Map<string, CheckoutProduct>([
    [CANETA, productRow({ id: CANETA, name: 'Caneta', priceCents: 1990 })],
    [CADERNO, productRow({ id: CADERNO, name: 'Caderno', priceCents: 3500, weightG: 400 })],
    [EMBALAGEM, productRow({ id: EMBALAGEM, name: 'Caixa', priceCents: 800, kind: 'gift_wrap' })],
  ]);
  coupons = new Map<string, CheckoutCoupon>();
  context: CheckoutContext = { shipping, giftWrapEnabled: true };
  payloads: CreateOrderPayload[] = [];
  createErrors: CheckoutDbError[] = [];
  attached: [string, string][] = [];
  released: [string, string, string][] = [];

  async loadProducts(ids: string[]) {
    return ids.flatMap((id) => this.products.get(id) ?? []);
  }
  async loadCoupon(code: string) {
    return this.coupons.get(code) ?? null;
  }
  async loadContext() {
    return this.context;
  }
  async createOrder(payload: CreateOrderPayload) {
    this.payloads.push(payload);
    const error = this.createErrors.shift();
    if (error) throw error;
    const gift = payload.gift_wrap_product_id
      ? (this.products.get(payload.gift_wrap_product_id)?.priceCents ?? 0)
      : 0;
    const total =
      payload.expected_subtotal_cents -
      payload.expected_discount_cents +
      (payload.shipping?.cents ?? 0) +
      gift;
    return {
      order_id: ORDER_ID,
      code: payload.code,
      status: payload.shipping
        ? ('awaiting_payment' as const)
        : ('awaiting_shipping_quote' as const),
      subtotal_cents: payload.expected_subtotal_cents,
      discount_cents: payload.expected_discount_cents,
      shipping_cents: payload.shipping?.cents ?? null,
      gift_wrap_cents: gift,
      total_cents: total,
      reserved_until: payload.shipping ? new Date(Date.now() + 30 * 60000).toISOString() : null,
    };
  }
  async attachPreference(orderId: string, preferenceId: string) {
    this.attached.push([orderId, preferenceId]);
  }
  async releaseOrder(orderId: string, status: string, actor: string) {
    this.released.push([orderId, status, actor]);
  }
}

let repo: FakeRepo;
let mpCalls: { url: string; init: RequestInit }[];
let turnstileOk: boolean;
let mpOk: boolean;

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('turnstile')) {
    return new Response(JSON.stringify({ success: turnstileOk }));
  }
  if (url.includes('mercadopago')) {
    mpCalls.push({ url, init: init ?? {} });
    if (!mpOk) return new Response('{}', { status: 500 });
    return new Response(
      JSON.stringify({
        id: 'pref-123',
        init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-123',
      }),
    );
  }
  throw new Error(`fetch inesperado: ${url}`);
});

beforeEach(() => {
  repo = new FakeRepo();
  mpCalls = [];
  turnstileOk = true;
  mpOk = true;
  fetchMock.mockClear();
  meResult = { ok: true, items: [meItem(1, 'PAC', '23.50'), meItem(2, 'SEDEX', '40.00')] };
  meCalculate = vi.fn(async () => meResult);
});

function app() {
  const me = { calculate: meCalculate } as unknown as MelhorEnvioClient;
  return createApp({
    fetch: fetchMock,
    rateLimitHit: async () => true,
    checkoutRepo: () => repo,
    melhorEnvio: () => me,
  });
}

function body(over: Record<string, unknown> = {}) {
  return {
    items: [
      { productId: CANETA, qty: 2 },
      { productId: CADERNO, qty: 1 },
    ],
    customer: { name: 'Maria Silva', whatsapp: '(79) 99999-1234' },
    address: {
      cep: '49100-000',
      street: 'Rua Teste',
      number: '10',
      district: 'Centro',
      city: 'Cidade Teste',
      uf: 'SE',
      addressType: 'urban',
    },
    shippingService: OWN_SERVICE,
    shippingQuotedCents: 800,
    turnstileToken: 'token-turnstile',
    ...over,
  };
}

function post(data: unknown, envOverride: Bindings = env) {
  return app().request(
    '/checkout',
    { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } },
    envOverride,
  );
}

async function errorOf(res: Response) {
  return ((await res.json()) as { error: { code: string; message: string; details?: unknown } })
    .error;
}

describe('POST /checkout — pedido com pagamento', () => {
  it('recalcula tudo no servidor, grava o pedido e devolve o link do Mercado Pago', async () => {
    const res = await post(body());
    expect(res.status).toBe(201);
    const json = (await res.json()) as Record<string, string | number>;
    expect(json).toMatchObject({
      status: 'awaiting_payment',
      totalCents: 1990 * 2 + 3500 + 800,
      checkoutUrl: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-123',
    });
    expect(String(json.token)).toMatch(ORDER_TOKEN_REGEX);
    expect(json.orderUrl).toBe(`https://loja.teste/pedido/${json.token}/`);

    const [payload] = repo.payloads;
    expect(payload).toMatchObject({
      customer_whatsapp: '79999991234',
      address_type: 'urban',
      expected_subtotal_cents: 7480,
      expected_discount_cents: 0,
      shipping: {
        service: OWN_SERVICE,
        cents: 800,
        days_min: 2,
        days_max: 3,
        label: 'Entrega local · Aracaju',
        carrier: null,
      },
      reserve_minutes: 30,
      customer_user_id: null,
    });
    // O banco guarda só o hash do link, nunca o token.
    expect(payload?.token_hash).toBe(await hashOrderToken(String(json.token), PEPPER));
    expect(payload?.token_hash).not.toContain(String(json.token));

    expect(repo.attached).toEqual([[ORDER_ID, 'pref-123']]);
  });

  it('a preferência tem Pix e cartão, sem boleto, com o total do servidor e idempotência', async () => {
    await post(body());
    const call = mpCalls[0]!;
    const headers = new Headers(call.init.headers);
    expect(headers.get('Authorization')).toBe('Bearer TEST-token-mp');
    expect(headers.get('X-Idempotency-Key')).toBe(ORDER_ID);

    const sent = JSON.parse(String(call.init.body));
    expect(sent.payment_methods.excluded_payment_types).toEqual([{ id: 'ticket' }, { id: 'atm' }]);
    expect(sent.items).toHaveLength(1);
    expect(sent.items[0]).toMatchObject({ quantity: 1, currency_id: 'BRL', unit_price: 82.8 });
    expect(sent.external_reference).toBe(ORDER_ID);
    expect(sent.notification_url).toBe('http://localhost/webhooks/mercadopago');
    expect(sent.expires).toBe(true);
    expect(sent.payer).toBeUndefined(); // nenhum dado pessoal vai para o Mercado Pago sem necessidade
  });

  it('ignora preço, frete e total enviados pelo navegador (R3.3)', async () => {
    await post(
      body({
        items: [{ productId: CANETA, qty: 1, unitPriceCents: 1 }],
        totalCents: 1,
        shippingCents: 0,
        discountCents: 99999,
      }),
    );
    expect(repo.payloads[0]).toMatchObject({
      expected_subtotal_cents: 1990,
      expected_discount_cents: 0,
      shipping: { cents: 800 },
    });
  });

  it('frete grátis conta o subtotal já com desconto (só a opção mais barata do Melhor Envio)', async () => {
    repo.coupons.set('DEZ', {
      type: 'percent',
      value: 10,
      minOrderCents: null,
      active: true,
      startsAt: null,
      endsAt: null,
      maxUses: null,
      usedCount: 0,
    });
    repo.products.set(CADERNO, productRow({ id: CADERNO, priceCents: 3500, weightG: 100 }));

    // 6 cadernos = R$ 210,00; com 10% = R$ 189,00: abaixo de R$ 200, o frete é cobrado.
    await post(
      body({
        items: [{ productId: CADERNO, qty: 6 }],
        couponCode: 'dez',
        shippingService: 'me:1',
        shippingQuotedCents: 2350,
      }),
    );
    expect(repo.payloads[0]).toMatchObject({
      expected_subtotal_cents: 21000,
      expected_discount_cents: 2100,
      coupon_code: 'DEZ',
      shipping: { service: 'me:1', cents: 2350 },
    });

    // 7 cadernos = R$ 245,00; com 10% = R$ 220,50: PAC grátis.
    await post(
      body({
        items: [{ productId: CADERNO, qty: 7 }],
        couponCode: 'dez',
        shippingService: 'me:1',
        shippingQuotedCents: 0,
      }),
    );
    expect(repo.payloads[1]).toMatchObject({
      expected_subtotal_cents: 24500,
      expected_discount_cents: 2450,
      shipping: { service: 'me:1', cents: 0 },
    });
  });

  it('embalagem de presente entra no total e a mensagem vai para o pedido', async () => {
    await post(body({ giftWrap: { productId: EMBALAGEM, message: 'Feliz aniversário!' } }));
    expect(repo.payloads[0]).toMatchObject({
      gift_wrap_product_id: EMBALAGEM,
      gift_message: 'Feliz aniversário!',
    });
  });
});

describe('POST /checkout — frete híbrido recalculado no servidor', () => {
  it('(b) opção do Melhor Envio: 201 e a transportadora vai no pedido', async () => {
    const res = await post(body({ shippingService: 'me:2', shippingQuotedCents: 4000 }));
    expect(res.status).toBe(201);
    expect(meCalculate).toHaveBeenCalledTimes(1);
    expect(repo.payloads[0]?.shipping).toMatchObject({
      service: 'me:2',
      cents: 4000,
      label: 'SEDEX',
      carrier: 'Correios',
    });
  });

  it('(c) preço recalculado diferente do que o navegador mostrou: 409 e nenhum pedido', async () => {
    const res = await post(body({ shippingService: 'me:2', shippingQuotedCents: 3000 }));
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({
      code: 'shipping_changed',
      message: CHECKOUT_MESSAGES.shippingChanged,
    });
    expect(repo.payloads).toHaveLength(0);
    expect(mpCalls).toHaveLength(0);
  });

  it('(d) opção sumiu (Melhor Envio falhou no recálculo): 409', async () => {
    meResult = { ok: false, reason: 'timeout' };
    const res = await post(body({ shippingService: 'me:2', shippingQuotedCents: 4000 }));
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({ code: 'shipping_changed' });
    expect(repo.payloads).toHaveLength(0);
  });

  it('(e) frete a combinar com opção enviada: 409; sem opção: pedido aguardando cotação', async () => {
    const rural = { ...body().address, addressType: 'rural' };
    const changed = await post(body({ address: rural }));
    expect(changed.status).toBe(409);
    expect(await errorOf(changed)).toMatchObject({ code: 'shipping_changed' });
    expect(repo.payloads).toHaveLength(0);

    const ok = await post(
      body({ address: rural, shippingService: undefined, shippingQuotedCents: undefined }),
    );
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ status: 'awaiting_shipping_quote' });
  });

  it('(f) frete grátis no recálculo: cobra 0 e recusa se o navegador mandou outro valor', async () => {
    repo.products.set(CADERNO, productRow({ id: CADERNO, priceCents: 30000, weightG: 100 }));
    const items = [{ productId: CADERNO, qty: 1 }];
    const free = await post(body({ items, shippingService: 'me:1', shippingQuotedCents: 0 }));
    expect(free.status).toBe(201);
    expect(repo.payloads[0]?.shipping).toMatchObject({ service: 'me:1', cents: 0 });

    const stale = await post(body({ items, shippingService: 'me:1', shippingQuotedCents: 2350 }));
    expect(stale.status).toBe(409);
    expect(repo.payloads).toHaveLength(1);
  });

  it('(g) shippingService sem shippingQuotedCents: 400', async () => {
    const res = await post(body({ shippingQuotedCents: undefined }));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({ message: 'Escolha a opção de entrega de novo.' });
    expect(repo.payloads).toHaveLength(0);
  });

  it('valores antigos (economy) não são mais aceitos', async () => {
    expect((await post(body({ shippingService: 'economy' }))).status).toBe(400);
  });
});

describe('POST /checkout — frete a combinar', () => {
  it('endereço rural cria o pedido sem cobrança e sem chamar o Mercado Pago', async () => {
    const res = await post(
      body({
        address: { ...body().address, addressType: 'rural' },
        shippingService: undefined,
        shippingQuotedCents: undefined,
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      status: 'awaiting_shipping_quote',
      totalCents: 7480,
      message: expect.stringContaining('antes de qualquer cobrança'),
    });
    expect(repo.payloads[0]?.shipping).toBeNull();
    expect(mpCalls).toHaveLength(0);
  });
});

describe('POST /checkout — validação', () => {
  it('dados inválidos: 400 com o campo', async () => {
    const res = await post(body({ customer: { name: 'M', whatsapp: '123' } }));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({ code: 'invalid_input' });
    expect(repo.payloads).toHaveLength(0);
  });

  it('JSON quebrado: 400', async () => {
    const res = await app().request(
      '/checkout',
      { method: 'POST', body: '{', headers: { 'Content-Type': 'application/json' } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('Turnstile inválido: 403 e nenhum pedido', async () => {
    turnstileOk = false;
    const res = await post(body());
    expect(res.status).toBe(403);
    expect(repo.payloads).toHaveLength(0);
  });

  it('produto inativo: 409 dizendo qual', async () => {
    repo.products.set(CANETA, productRow({ id: CANETA, active: false }));
    const res = await post(body());
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({
      code: 'product_unavailable',
      details: { productId: CANETA },
    });
  });

  it('embalagem não pode ser comprada como item', async () => {
    const res = await post(body({ items: [{ productId: EMBALAGEM, qty: 1 }] }));
    expect(res.status).toBe(409);
  });

  it('sem estoque: 409', async () => {
    repo.products.set(CANETA, productRow({ id: CANETA, stock: 1 }));
    const res = await post(body());
    expect(await errorOf(res)).toMatchObject({
      code: 'out_of_stock',
      details: { productId: CANETA },
    });
  });

  it('embalagem desligada no painel: 409', async () => {
    repo.context = { shipping, giftWrapEnabled: false };
    const res = await post(body({ giftWrap: { productId: EMBALAGEM, message: 'Oi' } }));
    expect(await errorOf(res)).toMatchObject({ code: 'gift_wrap_unavailable' });
  });

  it('cupom inexistente ou vencido: mesma resposta', async () => {
    repo.coupons.set('VENCIDO', {
      type: 'fixed',
      value: 500,
      minOrderCents: null,
      active: true,
      startsAt: null,
      endsAt: new Date(Date.now() - 1000).toISOString(),
      maxUses: null,
      usedCount: 0,
    });
    for (const code of ['NAOEXISTE', 'VENCIDO']) {
      const res = await post(body({ couponCode: code }));
      expect(res.status).toBe(422);
      expect(await errorOf(res)).toEqual({
        code: 'coupon_invalid',
        message: 'Cupom inválido ou expirado.',
      });
    }
  });

  it('cupom abaixo da compra mínima explica o valor', async () => {
    repo.coupons.set('MIN', {
      type: 'fixed',
      value: 500,
      minOrderCents: 10000,
      active: true,
      startsAt: null,
      endsAt: null,
      maxUses: null,
      usedCount: 0,
    });
    const res = await post(body({ couponCode: 'MIN' }));
    const error = await errorOf(res);
    expect(error.code).toBe('coupon_min_order');
    expect(error.message.replace(/\s/g, ' ')).toBe(
      'Este cupom vale para compras a partir de R$ 100,00.',
    );
  });

  it('CEP bloqueado por exceção: 422', async () => {
    repo.context = {
      shipping: {
        ...shipping,
        exceptions: [{ cepStart: '49100000', cepEnd: '49100999', action: 'block', value: null }],
      },
      giftWrapEnabled: true,
    };
    const res = await post(body());
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({ code: 'shipping_blocked' });
  });

  it('sem escolher o frete: 422; opção que não existe mais: 409', async () => {
    expect(
      await errorOf(
        await post(body({ shippingService: undefined, shippingQuotedCents: undefined })),
      ),
    ).toMatchObject({ code: 'shipping_service_required' });
    expect(
      await errorOf(await post(body({ shippingService: 'me:9', shippingQuotedCents: 100 }))),
    ).toMatchObject({ code: 'shipping_changed' });
  });
});

describe('POST /checkout — respostas do banco', () => {
  it.each([
    ['totals_changed', 409],
    ['too_many_pending', 429],
    ['out_of_stock', 409],
    ['coupon_invalid', 422],
  ])('%s vira %i com mensagem em português', async (code, status) => {
    repo.createErrors.push(new CheckoutDbError(code));
    const res = await post(body());
    expect(res.status).toBe(status);
    const error = await errorOf(res);
    expect(error.code).toBe(code);
    expect(error.message).not.toBe(code);
    expect(mpCalls).toHaveLength(0);
  });

  it('código de pedido repetido: tenta de novo com outro código', async () => {
    repo.createErrors.push(new CheckoutDbError('duplicate_code'));
    const res = await post(body());
    expect(res.status).toBe(201);
    expect(repo.payloads).toHaveLength(2);
    expect(repo.payloads[0]?.code).not.toBe(repo.payloads[1]?.code);
  });
});

describe('POST /checkout — Mercado Pago fora do ar', () => {
  it('cancela o pedido, devolve a reserva e responde 503 sem cobrar', async () => {
    mpOk = false;
    const res = await post(body());
    expect(res.status).toBe(503);
    expect(await errorOf(res)).toMatchObject({ code: 'payment_unavailable' });
    expect(repo.released).toEqual([[ORDER_ID, 'canceled', 'checkout']]);
    expect(repo.attached).toHaveLength(0);
  });

  it('falha só em attachPreference: não cancela, responde sucesso com checkoutUrl e log sem dados pessoais', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    repo.attachPreference = async () => {
      throw new Error('db down, cpf 12345678900');
    };
    const res = await post(body());
    expect(res.status).toBe(201);
    const json = (await res.json()) as { checkoutUrl?: string };
    expect(json.checkoutUrl).toContain('pref-123');
    expect(repo.released).toHaveLength(0);
    const logged = spy.mock.calls.map((a) => String(a[0])).join('\n');
    expect(logged).toContain(ORDER_ID);
    expect(logged).not.toContain('12345678900');
    expect(logged).not.toContain('db down');
    spy.mockRestore();
  });
});

describe('POST /checkout — resposta inválida do Mercado Pago', () => {
  it('link de pagamento sem HTTPS é recusado: cancela e devolve a reserva', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ success: true })));
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ id: 'pref-1', init_point: 'http://golpe.teste/pagar' })),
    );
    const res = await post(body());
    expect(res.status).toBe(503);
    expect(repo.released).toEqual([[ORDER_ID, 'canceled', 'checkout']]);
    expect(repo.attached).toHaveLength(0);
  });
});

describe('POST /checkout — operação', () => {
  it('checkout pausado: 503 antes de qualquer coisa', async () => {
    const res = await post(body(), { ...env, CHECKOUT_ENABLED: 'false' });
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem os segredos do Mercado Pago: 503 e log só com os nomes', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(body(), testEnv);
    expect(res.status).toBe(503);
    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toContain('MP_ACCESS_TOKEN');
    expect(logged).toContain('ORDER_TOKEN_PEPPER');
    log.mockRestore();
    expect(repo.payloads).toHaveLength(0);
  });

  it('respeita o limite de requisições', async () => {
    const limited = createApp({
      fetch: fetchMock,
      rateLimitHit: async () => false,
      checkoutRepo: () => repo,
    });
    const res = await limited.request(
      '/checkout',
      { method: 'POST', body: JSON.stringify(body()) },
      env,
    );
    expect(res.status).toBe(429);
  });
});
