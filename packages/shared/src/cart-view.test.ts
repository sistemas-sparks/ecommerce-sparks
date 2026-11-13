import { describe, expect, it } from 'vitest';
import {
  activeCoupon,
  buildCartView,
  formatDays,
  isCouponStale,
  isShippingCurrent,
  itemsSignature,
  maskCep,
  shippingSignature,
  type BuildCartViewInput,
} from './cart-view';
import type { LiveProduct, PublicProduct } from './schemas/catalog';

const A = '7b0b4c39-2d0e-4c55-9a43-5d1f8f1f6a01';
const B = '1c9e2f6a-8b1d-4c3e-9f2a-0d6b7e8f9a02';
const C = '9d3f1a2b-4c5d-4e6f-8a7b-1c2d3e4f5a03';

function cat(id: string, name: string): PublicProduct {
  return {
    id,
    slug: name.toLowerCase(),
    name,
    description: '',
    category_id: null,
    kind: 'regular',
    price_cents: 1, // preço estático propositalmente diferente do live
    stock: 1,
    featured: false,
    badge: null,
    images: [{ url: `/${name}.jpg`, alt: name, sources: [] }],
  };
}
const catalog = [cat(A, 'Caderno'), cat(B, 'Caneta')];
const liveA: LiveProduct = { id: A, price_cents: 1990, stock: 10, active: true };
const liveB: LiveProduct = { id: B, price_cents: 500, stock: 5, active: true };

function build(over: Partial<BuildCartViewInput> = {}) {
  return buildCartView({
    draft: [
      { productId: A, qty: 2 },
      { productId: B, qty: 3 },
    ],
    catalogProducts: catalog,
    liveProducts: [liveA, liveB],
    giftWrapPriceCents: null,
    appliedDiscountCents: 0,
    shippingCents: 1200,
    ...over,
  });
}

describe('buildCartView', () => {
  it('soma várias linhas e quantidades', () => {
    const v = build();
    expect(v.lines.map((l) => l.lineCents)).toEqual([3980, 1500]);
    expect(v.totals.subtotalCents).toBe(5480);
    expect(v.totals.totalCents).toBe(5480 + 1200);
    expect(v.lines[0]).toMatchObject({ name: 'Caderno', slug: 'caderno', maxQty: 10 });
    expect(v.lines[0]?.photo?.url).toBe('/Caderno.jpg');
  });

  it('usa o preço do live, nunca o do catálogo estático', () => {
    const v = build({ draft: [{ productId: A, qty: 1 }] });
    expect(v.lines[0]?.unitPriceCents).toBe(1990);
    expect(v.totals.subtotalCents).toBe(1990);
  });

  it('limita o desconto ao subtotal', () => {
    const v = build({ appliedDiscountCents: 999999, shippingCents: 0 });
    expect(v.totals.discountCents).toBe(5480);
    expect(v.totals.totalCents).toBe(0);
  });

  it('embalagem e frete somam sem entrar no desconto', () => {
    const v = build({ appliedDiscountCents: 480, giftWrapPriceCents: 800 });
    expect(v.totals).toEqual({
      subtotalCents: 5480,
      discountCents: 480,
      giftWrapCents: 800,
      shippingCents: 1200,
      totalCents: 5000 + 800 + 1200,
    });
  });

  it('frete null (a combinar) mantém null e total sem frete', () => {
    const v = build({ shippingCents: null });
    expect(v.totals.shippingCents).toBeNull();
    expect(v.totals.totalCents).toBe(5480);
  });

  it('status: ok, over_stock e fora do catálogo', () => {
    const v = build({
      draft: [
        { productId: A, qty: 10 },
        { productId: B, qty: 6 },
        { productId: C, qty: 1 },
      ],
      liveProducts: [liveA, liveB, { id: C, price_cents: 100, stock: 3, active: true }],
    });
    expect(v.lines.map((l) => l.status)).toEqual(['ok', 'over_stock', 'unavailable']);
    expect(v.totals.subtotalCents).toBe(19900 + 3000);
  });

  it('status unavailable por produto inativo', () => {
    const v = build({ liveProducts: [{ ...liveA, active: false }, liveB] });
    expect(v.lines[0]?.status).toBe('unavailable');
    expect(v.lines[0]?.lineCents).toBe(0);
    expect(v.totals.subtotalCents).toBe(1500);
  });

  it('status unavailable por estoque 0 e por falta de dado live', () => {
    const zero = build({ liveProducts: [{ ...liveA, stock: 0 }, liveB] });
    expect(zero.lines[0]).toMatchObject({ status: 'unavailable', maxQty: 0 });
    const missing = build({ liveProducts: [liveB] });
    expect(missing.lines[0]?.status).toBe('unavailable');
  });

  it('canCheckout em cada caso', () => {
    expect(build().canCheckout).toBe(true);
    expect(build({ shippingCents: null }).canCheckout).toBe(false);
    expect(build({ shippingCents: null, shippingChosen: true }).canCheckout).toBe(true);
    expect(build({ liveProducts: [{ ...liveA, stock: 1 }, liveB] }).canCheckout).toBe(false);
    expect(build({ liveProducts: [liveB] }).canCheckout).toBe(false);
  });

  it('sacola vazia', () => {
    const v = build({ draft: [] });
    expect(v.isEmpty).toBe(true);
    expect(v.canCheckout).toBe(false);
    expect(v.totals.subtotalCents).toBe(0);
    expect(v.totals.totalCents).toBe(0);
  });
});

describe('regras de invalidação da sacola', () => {
  const items = [
    { productId: A, qty: 2 },
    { productId: B, qty: 1 },
  ];
  const itemsSig = itemsSignature(items);

  it('assinatura dos itens: ordem não importa, quantidade importa', () => {
    expect(itemsSignature([...items].reverse())).toBe(itemsSig);
    expect(itemsSignature([{ productId: A, qty: 3 }, items[1]!])).not.toBe(itemsSig);
    expect(itemsSignature([items[0]!])).not.toBe(itemsSig);
  });

  it('cupom ativo e descartado', () => {
    const applied = { code: 'PROMO10', discountCents: 300, itemsSig };
    expect(activeCoupon(applied, itemsSig, 'PROMO10')).toBe(applied);
    expect(activeCoupon(applied, itemsSig, null)).toBeNull();
    expect(activeCoupon(applied, itemsSig, 'OUTRO')).toBeNull();
    const changed = itemsSignature([{ productId: A, qty: 1 }]);
    expect(isCouponStale(applied, changed)).toBe(true);
    expect(activeCoupon(applied, changed, 'PROMO10')).toBeNull();
    expect(isCouponStale(null, changed)).toBe(false);
  });

  it('frete válido e obsoleto', () => {
    const base = {
      itemsSig,
      couponCode: 'PROMO10',
      giftWrapProductId: C as string | null,
      cep: '49000000',
      addressType: 'urban',
    };
    const sig = shippingSignature(base);
    expect(isShippingCurrent(sig, shippingSignature({ ...base }))).toBe(true);
    expect(isShippingCurrent('', sig)).toBe(false);
    const changes = [
      { itemsSig: itemsSignature([{ productId: A, qty: 9 }]) },
      { couponCode: null },
      { giftWrapProductId: null },
      { cep: '49000001' },
      { addressType: 'rural' },
    ];
    for (const change of changes) {
      expect(isShippingCurrent(sig, shippingSignature({ ...base, ...change }))).toBe(false);
    }
  });

  it('maskCep', () => {
    expect(maskCep('')).toBe('');
    expect(maskCep('490')).toBe('490');
    expect(maskCep('49000')).toBe('49000');
    expect(maskCep('490001')).toBe('49000-1');
    expect(maskCep('49000-123456')).toBe('49000-123');
    expect(maskCep('ab49000123')).toBe('49000-123');
  });

  it('formatDays', () => {
    expect(formatDays(0, 0)).toBe('No mesmo dia');
    expect(formatDays(1, 1)).toBe('1 dia útil');
    expect(formatDays(0, 1)).toBe('Até 1 dia útil');
    expect(formatDays(3, 3)).toBe('3 dias úteis');
    expect(formatDays(3, 5)).toBe('3 a 5 dias úteis');
  });
});
