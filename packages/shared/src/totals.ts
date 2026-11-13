// Cálculo dos totais do pedido. Usado pela API no checkout: o servidor sempre recalcula (R3.3).
// A elegibilidade do cupom (ativo, validade, limite de usos) é verificada antes, na regra de cupons;
// aqui entram só o tipo, o valor e a compra mínima.
import { assertCents, multiplyCents, percentOf, sumCents, type Cents } from './money';

export interface TotalsItem {
  unitPriceCents: Cents;
  qty: number;
}

export type CouponForTotals =
  | { type: 'percent'; value: number; minOrderCents: Cents | null }
  | { type: 'fixed'; value: Cents; minOrderCents: Cents | null };

export interface TotalsInput {
  items: readonly TotalsItem[];
  coupon?: CouponForTotals | null;
  shippingCents: Cents;
  giftWrapCents: Cents;
}

export type CouponStatus = 'none' | 'applied' | 'below_minimum';

export interface OrderTotals {
  subtotalCents: Cents;
  discountCents: Cents;
  couponStatus: CouponStatus;
  /** Subtotal já com desconto: é a base para o frete grátis. */
  discountedSubtotalCents: Cents;
  shippingCents: Cents;
  giftWrapCents: Cents;
  totalCents: Cents;
}

export function computeSubtotal(items: readonly TotalsItem[]): Cents {
  return sumCents(items.map((item) => multiplyCents(item.unitPriceCents, item.qty)));
}

/** Desconto do cupom sobre o subtotal dos produtos. Nunca desconta frete nem embalagem. */
export function computeDiscount(
  subtotalCents: Cents,
  coupon: CouponForTotals | null | undefined,
): { discountCents: Cents; couponStatus: CouponStatus } {
  assertCents(subtotalCents, 'subtotal');
  if (!coupon) return { discountCents: 0, couponStatus: 'none' };

  if (coupon.minOrderCents !== null && subtotalCents < coupon.minOrderCents) {
    return { discountCents: 0, couponStatus: 'below_minimum' };
  }

  let raw: Cents;
  if (coupon.type === 'percent') {
    raw = percentOf(subtotalCents, coupon.value);
  } else {
    assertCents(coupon.value, 'valor do cupom');
    raw = coupon.value;
  }

  return { discountCents: Math.min(raw, subtotalCents), couponStatus: 'applied' };
}

export function computeOrderTotals(input: TotalsInput): OrderTotals {
  assertCents(input.shippingCents, 'frete');
  assertCents(input.giftWrapCents, 'embalagem');

  const subtotalCents = computeSubtotal(input.items);
  const { discountCents, couponStatus } = computeDiscount(subtotalCents, input.coupon);
  const discountedSubtotalCents = subtotalCents - discountCents;

  return {
    subtotalCents,
    discountCents,
    couponStatus,
    discountedSubtotalCents,
    shippingCents: input.shippingCents,
    giftWrapCents: input.giftWrapCents,
    totalCents: sumCents([discountedSubtotalCents, input.shippingCents, input.giftWrapCents]),
  };
}
