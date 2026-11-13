import {
  computeOrderTotals,
  couponValidateRequestSchema,
  couponValidateResponseSchema,
  formatBRL,
  getCouponState,
} from '@sparks/shared';
import { Hono } from 'hono';
import { apiError } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import { assertTurnstile } from '../middleware/turnstile';
import type { AppEnv } from '../types';

// Valida o cupom e devolve o desconto. Não consome: o uso é gravado pelo create_order.
export const couponsRoutes = new Hono<AppEnv>().post(
  '/validate',
  rateLimit({ bucket: 'coupon', max: 20, windowSeconds: 60 }),
  async (c) => {
    const input = couponValidateRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      throw apiError(
        400,
        'invalid_input',
        input.error.issues[0]?.message ?? 'Confira os dados do cupom.',
      );
    await assertTurnstile(c, input.data.turnstileToken);
    const repo = c.var.deps.shippingRepo(c.var.config);
    const { items, couponCode } = input.data;
    const [rows, coupon] = await Promise.all([
      repo.products(items.map((i) => i.productId)),
      repo.coupon(couponCode),
    ]);
    const products = new Map(rows.map((product) => [product.id, product]));
    const lines = items.map((line) => {
      const product = products.get(line.productId);
      if (
        !product ||
        !product.active ||
        product.deleted_at ||
        product.kind !== 'regular' ||
        product.stock < line.qty
      )
        throw apiError(
          409,
          'product_unavailable',
          'Confira os produtos e as quantidades da sacola.',
        );
      return { unitPriceCents: product.price_cents, qty: line.qty };
    });
    // Mesma resposta para qualquer motivo, para não revelar o estado do código.
    if (
      !coupon ||
      getCouponState({
        active: coupon.active,
        startsAt: coupon.starts_at,
        endsAt: coupon.ends_at,
        maxUses: coupon.max_uses,
        usedCount: coupon.used_count,
      }) !== 'active'
    )
      throw apiError(422, 'coupon_invalid', 'Cupom inválido ou expirado.');
    const totals = computeOrderTotals({
      items: lines,
      coupon: { type: coupon.type, value: coupon.value, minOrderCents: coupon.min_order_cents },
      shippingCents: 0,
      giftWrapCents: 0,
    });
    if (totals.couponStatus === 'below_minimum')
      throw apiError(
        422,
        'coupon_min_order',
        `Este cupom vale para compras a partir de ${formatBRL(coupon.min_order_cents ?? 0)}.`,
      );
    return c.json(
      couponValidateResponseSchema.parse({
        couponCode,
        type: coupon.type,
        value: coupon.value,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        discountedSubtotalCents: totals.discountedSubtotalCents,
      }),
    );
  },
);
