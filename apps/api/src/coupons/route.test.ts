import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShippingCouponRow, ShippingProductRow } from '@sparks/shared';
import { createApp } from '../app';
import { createTestKey, testEnv, type TestKey } from '../test-utils';
import type { ShippingRepo } from '../shipping/repo';

const productId = '11111111-1111-4111-8111-111111111111';
let key: TestKey;
let product: ShippingProductRow;
let coupon: ShippingCouponRow | null;
let repo: ShippingRepo;
beforeAll(async () => {
  key = await createTestKey();
});
beforeEach(() => {
  product = {
    id: productId,
    price_cents: 1999,
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
  coupon = {
    type: 'percent',
    value: 10,
    min_order_cents: null,
    max_uses: null,
    used_count: 0,
    active: true,
    starts_at: null,
    ends_at: null,
  };
  repo = {
    load: vi.fn(),
    loadAdmin: vi.fn(),
    loadHybrid: vi.fn(),
    products: vi.fn(async () => [product]),
    coupon: vi.fn(async () => coupon),
    save: vi.fn(),
    remove: vi.fn(),
    settings: vi.fn(),
  } as unknown as ShippingRepo;
});
interface Options {
  allow?: boolean;
  captcha?: boolean;
}
async function validate(body: unknown, options: Options = {}) {
  const app = createApp({
    shippingRepo: () => repo,
    getJwks: async () => [key.publicJwk],
    rateLimitHit: async () => options.allow !== false,
    fetch: async () => Response.json({ success: options.captcha !== false }),
  });
  return app.request(
    '/coupons/validate',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    testEnv,
  );
}
const input = (over: Record<string, unknown> = {}) => ({
  couponCode: 'BEMVINDA10',
  items: [{ productId, qty: 2 }],
  turnstileToken: 'token-de-teste',
  ...over,
});
const day = 86_400_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();

describe('validação pública de cupom', () => {
  it('percentual: arredonda para baixo e ignora preço enviado pelo cliente', async () => {
    // 2 x 1999 = 3998; 10% = 399,8 -> 399
    const response = await validate(
      input({ priceCents: 1, subtotalCents: 1, discountCents: 99999 }),
    );
    expect(response.status).toBe(400);
    const ok = await validate(input());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      couponCode: 'BEMVINDA10',
      type: 'percent',
      value: 10,
      subtotalCents: 3998,
      discountCents: 399,
      discountedSubtotalCents: 3599,
    });
  });
  it('fixo: limitado ao subtotal; frete e embalagem não entram', async () => {
    coupon = { ...coupon!, type: 'fixed', value: 500 };
    const a = (await (await validate(input())).json()) as { discountCents: number };
    expect(a.discountCents).toBe(500);
    coupon = { ...coupon, value: 100000 };
    const b = (await (await validate(input())).json()) as {
      discountCents: number;
      discountedSubtotalCents: number;
    };
    expect(b.discountCents).toBe(3998);
    expect(b.discountedSubtotalCents).toBe(0);
  });
  it('inexistente, desativado, agendado, expirado e esgotado: mesmo corpo 422', async () => {
    const cases: (ShippingCouponRow | null)[] = [
      null,
      { ...coupon!, active: false },
      { ...coupon!, starts_at: iso(day) },
      { ...coupon!, ends_at: iso(-day) },
      { ...coupon!, max_uses: 3, used_count: 3 },
    ];
    const bodies: string[] = [];
    for (const c of cases) {
      coupon = c;
      const response = await validate(input());
      expect(response.status).toBe(422);
      bodies.push(await response.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0]!)).toEqual({
      error: { code: 'coupon_invalid', message: 'Cupom inválido ou expirado.' },
    });
  });
  it('compra mínima não atingida: 422 com o valor', async () => {
    coupon = { ...coupon!, min_order_cents: 10000 };
    const response = await validate(input());
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('coupon_min_order');
    expect(body.error.message).toContain('100,00');
  });
  it('produto indisponível: 409', async () => {
    for (const p of [
      { ...product, stock: 1 },
      { ...product, active: false },
      { ...product, kind: 'gift_wrap' as const },
      { ...product, deleted_at: '2026-10-01T00:00:00+00:00' },
    ]) {
      repo.products = vi.fn(async () => [p]);
      expect((await validate(input())).status).toBe(409);
    }
    repo.products = vi.fn(async () => []);
    expect((await validate(input())).status).toBe(409);
  });
  it('Turnstile ruim: 403 sem consultar o banco', async () => {
    const response = await validate(input(), { captcha: false });
    expect(response.status).toBe(403);
    expect(repo.coupon).not.toHaveBeenCalled();
  });
  it('sem token do Turnstile: 400', async () => {
    const { turnstileToken: _t, ...rest } = input();
    void _t;
    expect((await validate(rest)).status).toBe(400);
  });
  it('limite de requisições: 429', async () => {
    expect((await validate(input(), { allow: false })).status).toBe(429);
    expect(repo.coupon).not.toHaveBeenCalled();
  });
  it('corpo inválido: 400', async () => {
    expect((await validate(null)).status).toBe(400);
    expect((await validate(input({ items: [] }))).status).toBe(400);
    expect((await validate(input({ couponCode: 'x' }))).status).toBe(400);
  });
});
