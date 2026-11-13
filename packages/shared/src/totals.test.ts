import { describe, expect, it } from 'vitest';
import { computeDiscount, computeOrderTotals } from './totals';

const items = [
  { unitPriceCents: 1990, qty: 2 }, // 39,80
  { unitPriceCents: 1500, qty: 1 }, // 15,00
];

describe('computeOrderTotals', () => {
  it('soma itens, frete e embalagem sem cupom', () => {
    expect(computeOrderTotals({ items, shippingCents: 1200, giftWrapCents: 800 })).toEqual({
      subtotalCents: 5480,
      discountCents: 0,
      couponStatus: 'none',
      discountedSubtotalCents: 5480,
      shippingCents: 1200,
      giftWrapCents: 800,
      totalCents: 7480,
    });
  });

  it('cupom percentual desconta só os produtos, não frete nem embalagem', () => {
    const t = computeOrderTotals({
      items,
      coupon: { type: 'percent', value: 10, minOrderCents: null },
      shippingCents: 1200,
      giftWrapCents: 800,
    });
    expect(t.discountCents).toBe(548);
    expect(t.totalCents).toBe(5480 - 548 + 1200 + 800);
  });

  it('cupom fixo maior que o subtotal zera só os produtos', () => {
    const t = computeOrderTotals({
      items,
      coupon: { type: 'fixed', value: 10000, minOrderCents: null },
      shippingCents: 1200,
      giftWrapCents: 0,
    });
    expect(t.discountCents).toBe(5480);
    expect(t.discountedSubtotalCents).toBe(0);
    expect(t.totalCents).toBe(1200);
  });

  it('rejeita preço ou frete inválido', () => {
    expect(() =>
      computeOrderTotals({
        items: [{ unitPriceCents: 10.5, qty: 1 }],
        shippingCents: 0,
        giftWrapCents: 0,
      }),
    ).toThrow(RangeError);
    expect(() => computeOrderTotals({ items, shippingCents: -1, giftWrapCents: 0 })).toThrow(
      RangeError,
    );
  });
});

describe('computeDiscount — compra mínima', () => {
  const coupon = { type: 'fixed' as const, value: 500, minOrderCents: 5000 };

  it('aplica no limite exato da compra mínima', () => {
    expect(computeDiscount(5000, coupon)).toEqual({ discountCents: 500, couponStatus: 'applied' });
  });

  it('não aplica 1 centavo abaixo do mínimo', () => {
    expect(computeDiscount(4999, coupon)).toEqual({
      discountCents: 0,
      couponStatus: 'below_minimum',
    });
  });

  it('percentual arredonda para baixo', () => {
    expect(computeDiscount(1999, { type: 'percent', value: 15, minOrderCents: null })).toEqual({
      discountCents: 299,
      couponStatus: 'applied',
    });
  });

  it('rejeita percentual acima de 100', () => {
    expect(() =>
      computeDiscount(1000, { type: 'percent', value: 150, minOrderCents: null }),
    ).toThrow(RangeError);
  });
});
