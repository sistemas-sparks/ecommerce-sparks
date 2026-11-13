import {
  computeOrderTotals,
  shippingQuoteRequestSchema,
  finishHybridQuote,
  hybridShippingQuoteResponseSchema,
  prepareHybridQuote,
  type HybridShippingItem,
  type MelhorEnvioResult,
  type ShippingProductRow,
} from '@sparks/shared';
import { Hono } from 'hono';
import { apiError } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import { assertTurnstile } from '../middleware/turnstile';
import type { AppEnv } from '../types';
import { toHybridShippingConfig } from './config';

const item = (product: ShippingProductRow, qty: number): HybridShippingItem => ({
  id: product.id,
  unitPriceCents: product.price_cents,
  weightG: product.weight_g,
  packageSize: product.package_size,
  qty,
  lengthCm: product.length_cm,
  widthCm: product.width_cm,
  heightCm: product.height_cm,
});
const couponError = () => apiError(422, 'coupon_invalid', 'Cupom inválido ou expirado.');

export const shippingRoutes = new Hono<AppEnv>().post(
  '/quote',
  rateLimit({ bucket: 'shipping', max: 30, windowSeconds: 60 }),
  async (c) => {
    const raw: unknown = await c.req.json().catch(() => null);
    const input = shippingQuoteRequestSchema.safeParse(raw);
    if (!input.success)
      throw apiError(
        400,
        'invalid_input',
        input.error.issues[0]?.message ?? 'Confira os dados da cotação.',
      );
    await assertTurnstile(c, input.data.turnstileToken);
    const repo = c.var.deps.shippingRepo(c.var.config);
    const { items, cep, addressType, couponCode, giftWrapProductId } = input.data;
    const [context, rows, coupon] = await Promise.all([
      repo.loadHybrid(),
      repo.products([
        ...items.map((i) => i.productId),
        ...(giftWrapProductId ? [giftWrapProductId] : []),
      ]),
      couponCode ? repo.coupon(couponCode) : null,
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
      return { product, qty: line.qty };
    });
    const gift = giftWrapProductId ? products.get(giftWrapProductId) : null;
    if (
      giftWrapProductId &&
      (!gift ||
        !gift.active ||
        gift.deleted_at ||
        gift.kind !== 'gift_wrap' ||
        gift.stock < 1 ||
        !context.settings.gift_wrap_enabled)
    )
      throw apiError(409, 'gift_wrap_unavailable', 'A embalagem escolhida não está disponível.');
    if (
      couponCode &&
      (!coupon ||
        !coupon.active ||
        (coupon.starts_at && Date.parse(coupon.starts_at) > Date.now()) ||
        (coupon.ends_at && Date.parse(coupon.ends_at) <= Date.now()) ||
        (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses))
    )
      throw couponError();
    const totals = computeOrderTotals({
      items: lines.map((line) => ({ unitPriceCents: line.product.price_cents, qty: line.qty })),
      coupon: coupon
        ? { type: coupon.type, value: coupon.value, minOrderCents: coupon.min_order_cents }
        : null,
      shippingCents: 0,
      giftWrapCents: gift?.price_cents ?? 0,
    });
    if (totals.couponStatus === 'below_minimum') throw couponError();
    const hybridInput = {
      cep,
      addressType,
      items: lines.map((line) => item(line.product, line.qty)),
      giftWrap: gift ? item(gift, 1) : null,
      discountedSubtotalCents: totals.discountedSubtotalCents,
    };
    const hybridConfig = toHybridShippingConfig(context);
    const prepared = prepareHybridQuote(hybridInput, hybridConfig);
    if (prepared.mode === 'final')
      return c.json(hybridShippingQuoteResponseSchema.parse(prepared.quote));
    const client = c.var.deps.melhorEnvio(c.var.config, c.var.deps.fetch);
    const result: MelhorEnvioResult | null =
      prepared.melhorEnvioRequest && client
        ? await client.calculate(prepared.melhorEnvioRequest)
        : null;
    const quote = finishHybridQuote(prepared, result, hybridInput, hybridConfig);
    return c.json(hybridShippingQuoteResponseSchema.parse(quote));
  },
);
