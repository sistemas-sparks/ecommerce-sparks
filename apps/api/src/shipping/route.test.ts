import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MelhorEnvioResult,
  ShippingAdminData,
  ShippingHybridData,
  ShippingProductRow,
} from '@sparks/shared';
import { createApp } from '../app';
import { createTestKey, signToken, testEnv, type TestKey } from '../test-utils';
import type { MelhorEnvioClient } from './melhor-envio';
import type { ShippingRepo } from './repo';

const productId = '11111111-1111-4111-8111-111111111111';
const zoneId = '22222222-2222-4222-8222-222222222222';
const ownTypeId = '66666666-6666-4666-8666-666666666666';
let key: TestKey;
let data: ShippingAdminData;
let hybrid: ShippingHybridData;
let product: ShippingProductRow;
let repo: ShippingRepo;
beforeAll(async () => {
  key = await createTestKey();
});
beforeEach(() => {
  data = {
    uf_ranges: [{ uf: 'SE', cep_start: '49000000', cep_end: '49999999' }],
    zones: [{ id: zoneId, name: 'Zona de teste', ufs: ['SE'], active: true }],
    rates: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        zone_id: zoneId,
        service: 'economy',
        max_weight_g: 1000,
        price_cents: 1700,
        days_min: 2,
        days_max: 4,
      },
    ],
    local_rules: [],
    exceptions: [],
    package_sizes: ['P', 'M', 'G'].map((size) => ({
      size: size as 'P' | 'M' | 'G',
      weight_g: 100,
      length_cm: 16,
      width_cm: 11,
      height_cm: 4,
    })),
    settings: {
      origin_cep: null,
      origin_uf: null,
      handling_days: 1,
      free_shipping_min_cents: 1500,
      max_items_auto_shipping: 50,
      max_weight_auto_g: 5000,
      package_tare_g: 0,
      cubic_divisor: null,
      gift_wrap_enabled: false,
    },
  };
  product = {
    id: productId,
    price_cents: 1000,
    stock: 10,
    active: true,
    kind: 'regular',
    deleted_at: null,
    weight_g: 200,
    package_size: 'P',
    length_cm: null,
    width_cm: null,
    height_cm: null,
  };
  hybrid = {
    exceptions: [],
    package_sizes: data.package_sizes,
    settings: { ...data.settings, origin_cep: '49000000', melhor_envio_margin_cents: 0 },
    own_types: [{ id: ownTypeId, name: 'Entrega local', active: true, sort_order: 0 }],
    own_areas: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        type_id: ownTypeId,
        label: 'Aracaju',
        cep_start: '49000000',
        cep_end: '49099999',
        price_cents: 800,
        days_min: 1,
        days_max: 2,
        active: true,
      },
    ],
    melhor_envio_services: [
      { service_id: 1, name: 'PAC', carrier: 'Correios', enabled: true, sort_order: 0 },
    ],
  };
  repo = {
    load: vi.fn(async () => data),
    loadAdmin: vi.fn(async () => {
      throw new Error('fora do escopo da cotação');
    }),
    loadHybrid: vi.fn(async () => hybrid),
    products: vi.fn(async () => [product]),
    coupon: vi.fn(async () => null),
    save: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    settings: vi.fn(async () => {}),
  };
});
interface AppOptions {
  allow?: boolean;
  captcha?: boolean;
  me?: MelhorEnvioClient | null;
}
function app(options: AppOptions = {}) {
  return createApp({
    shippingRepo: () => repo,
    melhorEnvio: () => options.me ?? null,
    getJwks: async () => [key.publicJwk],
    rateLimitHit: async () => options.allow !== false,
    fetch: async () => Response.json({ success: options.captcha !== false }),
  });
}
const input = () => ({
  cep: '49000000',
  items: [{ productId, qty: 1 }],
  addressType: 'urban',
  turnstileToken: 'token-de-teste',
});
async function quote(body: unknown = input(), options: AppOptions = {}) {
  return app(options).request(
    '/shipping/quote',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    testEnv,
  );
}
const meItem = (id: number, name: string, price: string) => ({
  id,
  name,
  price,
  delivery_range: { min: 3, max: 5 },
  company: { id: 1, name: 'Correios' },
});
function fakeMe(result: MelhorEnvioResult) {
  const calculate = vi.fn(async () => result);
  return { client: { calculate } as MelhorEnvioClient, calculate };
}
type Options = { options: { service: string; priceCents: number }[] };

describe('cotação pública', () => {
  it('junta frete próprio e Melhor Envio, ignorando preço do navegador', async () => {
    const { client, calculate } = fakeMe({
      ok: true,
      items: [meItem(1, 'PAC', '23.50'), meItem(2, 'SEDEX', '40.00')],
    });
    const response = await quote(
      { ...input(), priceCents: 1, discountedSubtotalCents: 999999, weightG: 1 },
      { me: client },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Options;
    // serviço 2 está desligado no banco: descartado
    expect(body.options.map((o) => [o.service, o.priceCents])).toEqual([
      [`own:${ownTypeId}`, 800],
      ['me:1', 2350],
    ]);
    expect(calculate).toHaveBeenCalledTimes(1);
  });
  it('nome e rótulo de 60 caracteres: responde 200 com o rótulo completo', async () => {
    hybrid.own_types[0]!.name = 'N'.repeat(60);
    hybrid.own_areas[0]!.label = 'R'.repeat(60);
    const response = await quote();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { options: { label: string }[] };
    expect(body.options[0]!.label).toBe(`${'N'.repeat(60)} · ${'R'.repeat(60)}`);
  });
  it('Melhor Envio falhando mantém só os fretes próprios', async () => {
    const { client } = fakeMe({ ok: false, reason: 'timeout' });
    const body = (await (await quote(input(), { me: client })).json()) as Options;
    expect(body.options.map((o) => o.service)).toEqual([`own:${ownTypeId}`]);
  });
  it('sem frete próprio e Melhor Envio falhando: a combinar', async () => {
    const { client } = fakeMe({ ok: false, reason: 'network' });
    const response = await quote({ ...input(), cep: '01001000' }, { me: client });
    expect(await response.json()).toMatchObject({ mode: 'consult', reason: 'no_option' });
  });
  it('sem cliente (sem token) usa só os próprios', async () => {
    expect(await (await quote()).json()).toMatchObject({
      mode: 'options',
      options: [{ service: `own:${ownTypeId}` }],
    });
  });
  it('sem origin_cep não chama o Melhor Envio', async () => {
    hybrid.settings.origin_cep = null;
    const { client, calculate } = fakeMe({ ok: true, items: [] });
    await quote(input(), { me: client });
    expect(calculate).not.toHaveBeenCalled();
  });
  it('rural devolve frete a combinar', async () => {
    expect(await (await quote({ ...input(), addressType: 'rural' })).json()).toMatchObject({
      mode: 'consult',
      reason: 'address_type',
    });
  });
  it('considera o desconto do cupom antes do frete grátis do Melhor Envio', async () => {
    repo.coupon = vi.fn(async () => ({
      type: 'percent' as const,
      value: 50,
      min_order_cents: null,
      max_uses: null,
      used_count: 0,
      active: true,
      starts_at: null,
      ends_at: null,
    }));
    const { client } = fakeMe({ ok: true, items: [meItem(1, 'PAC', '23.50')] });
    // 2 x 1000 com 50% = 1000, abaixo de 1500: sem frete grátis
    const response = await quote(
      { ...input(), items: [{ productId, qty: 2 }], couponCode: 'TESTE' },
      { me: client },
    );
    const body = (await response.json()) as Options;
    expect(body.options.find((o) => o.service === 'me:1')?.priceCents).toBe(2350);
  });
  it('frete grátis só na opção do Melhor Envio, no subtotal exato', async () => {
    hybrid.settings.free_shipping_min_cents = 1000;
    const { client } = fakeMe({ ok: true, items: [meItem(1, 'PAC', '23.50')] });
    const body = (await (await quote(input(), { me: client })).json()) as Options;
    expect(body.options.map((o) => o.priceCents)).toEqual([800, 0]);
  });
  it('recusa produto inativo, embalagem na vitrine e estoque insuficiente', async () => {
    for (const fields of [
      { active: false },
      { active: true, kind: 'gift_wrap' as const },
      { kind: 'regular' as const, stock: 0 },
    ]) {
      Object.assign(product, fields);
      expect((await quote()).status).toBe(409);
    }
  });
  it('embalagem desligada é recusada', async () => {
    const gift = {
      ...product,
      id: '44444444-4444-4444-8444-444444444444',
      kind: 'gift_wrap' as const,
      price_cents: 5000,
    };
    repo.products = vi.fn(async () => [product, gift]);
    hybrid.settings.gift_wrap_enabled = true;
    expect((await quote({ ...input(), giftWrapProductId: gift.id })).status).toBe(200);
    hybrid.settings.gift_wrap_enabled = false;
    expect((await quote({ ...input(), giftWrapProductId: gift.id })).status).toBe(409);
  });
  it('limite e CAPTCHA bloqueiam antes de consultar o catálogo', async () => {
    expect((await quote(input(), { allow: false })).status).toBe(429);
    expect((await quote(input(), { captcha: false })).status).toBe(403);
    expect(repo.loadHybrid).not.toHaveBeenCalled();
  });
  it('recusa quantidade fracionária e CEP inválido', async () => {
    expect((await quote({ ...input(), cep: 'abc' })).status).toBe(400);
    expect((await quote({ ...input(), items: [{ productId, qty: 1.5 }] })).status).toBe(400);
    expect(repo.loadHybrid).not.toHaveBeenCalled();
  });
});
describe('painel de frete', () => {
  async function adminRequest(path: string, method: string, body?: unknown) {
    return app().request(
      `/admin/shipping${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${await signToken(key, { app_metadata: { role: 'admin' }, aal: 'aal2' })}`,
          'Content-Type': 'application/json',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      testEnv,
    );
  }
  it('protege os tamanhos padrão contra exclusão e troca de identidade', async () => {
    expect((await adminRequest('/package-sizes/P', 'DELETE')).status).toBe(400);
    expect(
      (
        await adminRequest('/package-sizes/P', 'PATCH', {
          size: 'M',
          weight_g: 100,
          length_cm: 16,
          width_cm: 11,
          height_cm: 4,
        })
      ).status,
    ).toBe(400);
    expect(repo.remove).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('nega leitura anônima e de cliente comum', async () => {
    expect((await app().request('/admin/shipping', {}, testEnv)).status).toBe(401);
    expect(
      (
        await app().request(
          '/admin/shipping',
          { headers: { Authorization: `Bearer ${await signToken(key)}` } },
          testEnv,
        )
      ).status,
    ).toBe(403);
    expect(repo.load).not.toHaveBeenCalled();
  });
  it('não permite ligar cubagem não confirmada', async () => {
    const { gift_wrap_enabled: _unused, ...settings } = data.settings;
    void _unused;
    const response = await app().request(
      '/admin/shipping/settings',
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${await signToken(key, { app_metadata: { role: 'admin' }, aal: 'aal2' })}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...settings, cubic_divisor: 6000 }),
      },
      testEnv,
    );
    expect(response.status).toBe(400);
    expect(repo.settings).not.toHaveBeenCalled();
  });
});
