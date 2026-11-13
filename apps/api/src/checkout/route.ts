// POST /checkout (docs/arquitetura.md §5 e §7).
// O navegador manda só IDs, quantidades, dados de entrega, cupom e embalagem (R3.3). Aqui o servidor
// recalcula preço, frete, desconto, embalagem e total; o banco (create_order) recalcula de novo e
// reserva estoque e cupom na mesma transação. Depois cria a preferência no Mercado Pago.
import {
  type CheckoutInput,
  type CouponForTotals,
  type HybridShippingInput,
  type HybridShippingItem,
  type HybridShippingQuote,
  type MelhorEnvioResult,
  checkoutInputSchema,
  finishHybridQuote,
  computeOrderTotals,
  formatBRL,
  generateOrderCode,
  prepareHybridQuote,
} from '@sparks/shared';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { requireUser } from '../middleware/auth';
import { checkoutEnabled } from '../middleware/checkout-enabled';
import { rateLimit } from '../middleware/rate-limit';
import { assertTurnstile } from '../middleware/turnstile';
import type { AppEnv } from '../types';
import { PAYMENT_WINDOW_MINUTES, loadCheckoutSecrets } from './config';
import { createPreference } from './mercadopago';
import {
  CheckoutDbError,
  type CheckoutCoupon,
  type CheckoutProduct,
  type CreateOrderPayload,
  type CreatedOrder,
} from './repo';
import { generateOrderToken, hashOrderToken } from './token';

export const CHECKOUT_MESSAGES = {
  invalidJson: 'Não foi possível ler o pedido. Recarregue a página e tente de novo.',
  productUnavailable: 'Um produto da sacola não está mais disponível. Confira a sacola.',
  outOfStock: 'Um produto da sacola não tem mais estoque suficiente. Confira a sacola.',
  giftWrapUnavailable: 'A embalagem de presente escolhida não está disponível agora.',
  couponInvalid: 'Cupom inválido ou expirado.',
  couponMinOrder: (min: number) => `Este cupom vale para compras a partir de ${formatBRL(min)}.`,
  invalidCep: 'CEP não encontrado, confira o número.',
  blocked: 'Ainda não entregamos neste CEP.',
  serviceRequired: 'Escolha uma opção de frete.',
  shippingChanged: 'O frete mudou desde a cotação. Escolha a opção de entrega de novo.',
  totalsChanged: 'Os valores da sacola mudaram. Confira e tente de novo.',
  tooManyPending:
    'Você já tem pedidos aguardando pagamento. Conclua o pagamento ou aguarde alguns minutos.',
  paymentUnavailable:
    'Não foi possível abrir o pagamento agora. Nenhum valor foi cobrado; tente de novo em instantes.',
  awaitingQuote:
    'Recebemos seu pedido. A loja vai confirmar o frete pelo WhatsApp antes de qualquer cobrança.',
};

/** Erro do checkout: mesmo formato da API, com `details` opcional (ex.: qual produto). */
function checkoutError(
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: Record<string, string>,
): HTTPException {
  return new HTTPException(status, {
    res: new Response(JSON.stringify({ error: { code, message, ...(details && { details }) } }), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }),
  });
}

function couponIsUsable(coupon: CheckoutCoupon, now = Date.now()): boolean {
  if (!coupon.active) return false;
  if (coupon.startsAt && new Date(coupon.startsAt).getTime() > now) return false;
  if (coupon.endsAt && new Date(coupon.endsAt).getTime() <= now) return false;
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) return false;
  return true;
}

function toShippingItem(product: CheckoutProduct, qty: number): HybridShippingItem {
  return {
    id: product.id,
    unitPriceCents: product.priceCents,
    weightG: product.weightG,
    packageSize: product.packageSize,
    qty,
    lengthCm: product.lengthCm,
    widthCm: product.widthCm,
    heightCm: product.heightCm,
  };
}

/** Traduz os erros de negócio do banco para respostas em português. */
function fromDbError(err: CheckoutDbError, minOrderCents: number | null): HTTPException {
  const product = err.detail ? { productId: err.detail } : undefined;
  switch (err.code) {
    case 'product_unavailable':
      return checkoutError(409, err.code, CHECKOUT_MESSAGES.productUnavailable, product);
    case 'out_of_stock':
      return checkoutError(409, err.code, CHECKOUT_MESSAGES.outOfStock, product);
    case 'gift_wrap_unavailable':
      return checkoutError(409, err.code, CHECKOUT_MESSAGES.giftWrapUnavailable);
    case 'coupon_invalid':
      return checkoutError(422, err.code, CHECKOUT_MESSAGES.couponInvalid);
    case 'coupon_min_order':
      return checkoutError(
        422,
        err.code,
        minOrderCents === null
          ? CHECKOUT_MESSAGES.couponInvalid
          : CHECKOUT_MESSAGES.couponMinOrder(minOrderCents),
      );
    case 'totals_changed':
      return checkoutError(409, err.code, CHECKOUT_MESSAGES.totalsChanged);
    case 'too_many_pending':
      return checkoutError(429, err.code, CHECKOUT_MESSAGES.tooManyPending);
    default:
      return checkoutError(400, 'invalid_input', CHECKOUT_MESSAGES.invalidJson);
  }
}

export const checkoutRoutes = new Hono<AppEnv>().post(
  '/',
  rateLimit({ bucket: 'checkout', max: 10, windowSeconds: 600 }),
  checkoutEnabled,
  async (c) => {
    // 1. Entrada validada com Zod (campos extras, como preços, são descartados).
    const raw: unknown = await c.req.json().catch(() => {
      throw checkoutError(400, 'invalid_input', CHECKOUT_MESSAGES.invalidJson);
    });
    const parsed = checkoutInputSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw checkoutError(400, 'invalid_input', issue?.message ?? CHECKOUT_MESSAGES.invalidJson, {
        field: issue?.path.join('.') ?? '',
      });
    }
    const input: CheckoutInput = parsed.data;

    // 2. Turnstile e login opcional (cliente com conta Google tem o pedido ligado à conta).
    await assertTurnstile(c, input.turnstileToken);
    if (c.req.header('Authorization')) await requireUser(c, async () => {});
    const userId = c.get('user')?.id ?? null;

    const secrets = loadCheckoutSecrets(c.env ?? {});
    const repo = c.var.deps.checkoutRepo(c.var.config);

    // 3. Produtos e embalagem, com os preços do banco.
    const ids = input.items.map((i) => i.productId);
    const giftId = input.giftWrap?.productId ?? null;
    const [products, context] = await Promise.all([
      repo.loadProducts(giftId ? [...ids, giftId] : ids),
      repo.loadContext(),
    ]);
    const byId = new Map(products.map((p) => [p.id, p]));

    const lines = input.items.map((item) => {
      const product = byId.get(item.productId);
      if (!product || !product.active || product.deleted || product.kind !== 'regular') {
        throw checkoutError(409, 'product_unavailable', CHECKOUT_MESSAGES.productUnavailable, {
          productId: item.productId,
        });
      }
      if (product.stock < item.qty) {
        throw checkoutError(409, 'out_of_stock', CHECKOUT_MESSAGES.outOfStock, {
          productId: item.productId,
        });
      }
      return { product, qty: item.qty };
    });

    let gift: CheckoutProduct | null = null;
    if (giftId) {
      gift = byId.get(giftId) ?? null;
      if (
        !context.giftWrapEnabled ||
        !gift ||
        !gift.active ||
        gift.deleted ||
        gift.kind !== 'gift_wrap' ||
        gift.stock < 1
      ) {
        throw checkoutError(409, 'gift_wrap_unavailable', CHECKOUT_MESSAGES.giftWrapUnavailable);
      }
    }

    // 4. Cupom (o banco confere de novo, de forma atômica).
    let coupon: CouponForTotals | null = null;
    if (input.couponCode) {
      const found = await repo.loadCoupon(input.couponCode);
      if (!found || !couponIsUsable(found)) {
        throw checkoutError(422, 'coupon_invalid', CHECKOUT_MESSAGES.couponInvalid);
      }
      coupon =
        found.type === 'percent'
          ? { type: 'percent', value: found.value, minOrderCents: found.minOrderCents }
          : { type: 'fixed', value: found.value, minOrderCents: found.minOrderCents };
    }

    const items = lines.map((l) => ({ unitPriceCents: l.product.priceCents, qty: l.qty }));
    const preview = computeOrderTotals({
      items,
      coupon,
      shippingCents: 0,
      giftWrapCents: gift?.priceCents ?? 0,
    });
    if (preview.couponStatus === 'below_minimum') {
      throw checkoutError(
        422,
        'coupon_min_order',
        CHECKOUT_MESSAGES.couponMinOrder(coupon?.minOrderCents ?? 0),
      );
    }

    // 5. Frete híbrido (T-028): recalcula no servidor, chamando o Melhor Envio de novo, sobre o
    // subtotal já com desconto. O preço que o navegador mostrou só serve para comparar (R3.3).
    const hybridInput: HybridShippingInput = {
      cep: input.address.cep,
      items: lines.map((l) => toShippingItem(l.product, l.qty)),
      giftWrap: gift ? toShippingItem(gift, 1) : null,
      addressType: input.address.addressType,
      discountedSubtotalCents: preview.discountedSubtotalCents,
    };
    const prepared = prepareHybridQuote(hybridInput, context.shipping);
    let quote: HybridShippingQuote;
    if (prepared.mode === 'final') {
      quote = prepared.quote;
    } else {
      const client = c.var.deps.melhorEnvio(c.var.config, c.var.deps.fetch);
      const result: MelhorEnvioResult | null =
        prepared.melhorEnvioRequest && client
          ? await client.calculate(prepared.melhorEnvioRequest)
          : null;
      quote = finishHybridQuote(prepared, result, hybridInput, context.shipping);
    }
    if (quote.mode === 'invalid') {
      throw checkoutError(422, 'invalid_cep', CHECKOUT_MESSAGES.invalidCep);
    }
    if (quote.mode === 'blocked') {
      throw checkoutError(422, 'shipping_blocked', CHECKOUT_MESSAGES.blocked);
    }
    let shipping: CreateOrderPayload['shipping'] = null;
    if (quote.mode === 'options') {
      if (!input.shippingService) {
        throw checkoutError(422, 'shipping_service_required', CHECKOUT_MESSAGES.serviceRequired);
      }
      const option = quote.options.find((o) => o.service === input.shippingService);
      if (!option || option.priceCents !== input.shippingQuotedCents) {
        throw checkoutError(409, 'shipping_changed', CHECKOUT_MESSAGES.shippingChanged);
      }
      shipping = {
        service: option.service,
        cents: option.priceCents,
        days_min: option.daysMin,
        days_max: option.daysMax,
        label: option.label,
        carrier: option.carrier,
      };
    } else if (input.shippingService) {
      // consult: a situação mudou desde a cotação; a cliente precisa ver o "a combinar" antes.
      throw checkoutError(409, 'shipping_changed', CHECKOUT_MESSAGES.shippingChanged);
    }
    // quote.mode === 'consult' sem opção: frete a combinar, sem cobrança (shipping = null).

    // 6. Grava o pedido (código único; repete com outro código em caso de colisão).
    const token = generateOrderToken();
    const tokenHash = await hashOrderToken(token, secrets.orderTokenPepper);
    let created: CreatedOrder | null = null;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await repo.createOrder({
          code: generateOrderCode(),
          token_hash: tokenHash,
          customer_user_id: userId,
          customer_name: input.customer.name,
          customer_whatsapp: input.customer.whatsapp,
          customer_email: input.customer.email ?? null,
          address: {
            cep: input.address.cep,
            street: input.address.street,
            number: input.address.number,
            complement: input.address.complement ?? null,
            district: input.address.district,
            city: input.address.city,
            uf: input.address.uf,
            reference: input.address.reference ?? null,
          },
          address_type: input.address.addressType,
          items: input.items.map((i) => ({ product_id: i.productId, qty: i.qty })),
          coupon_code: input.couponCode ?? null,
          gift_wrap_product_id: giftId,
          gift_message: input.giftWrap?.message || null,
          shipping,
          expected_subtotal_cents: preview.subtotalCents,
          expected_discount_cents: preview.discountCents,
          reserve_minutes: PAYMENT_WINDOW_MINUTES,
        });
      } catch (err) {
        if (err instanceof CheckoutDbError && err.code === 'duplicate_code') continue;
        if (err instanceof CheckoutDbError) throw fromDbError(err, coupon?.minOrderCents ?? null);
        throw err;
      }
    }
    if (!created) throw new Error('checkout_code_collision');

    const site = c.var.config.siteOrigins[0];
    const orderUrl = `${site}/pedido/${token}/`;

    // 7a. Frete a combinar: nada é cobrado agora.
    if (created.status === 'awaiting_shipping_quote') {
      return c.json(
        {
          code: created.code,
          token,
          status: created.status,
          totalCents: created.total_cents,
          orderUrl,
          message: CHECKOUT_MESSAGES.awaitingQuote,
        },
        201,
      );
    }

    // 7b. Pagamento no Mercado Pago. Se falhar, cancela e devolve a reserva na hora.
    let preference: Awaited<ReturnType<typeof createPreference>>;
    try {
      preference = await createPreference(c.var.deps.fetch, secrets.mpAccessToken, {
        orderId: created.order_id,
        orderCode: created.code,
        totalCents: created.total_cents,
        returnUrl: orderUrl,
        notificationUrl: `${new URL(c.req.url).origin}/webhooks/mercadopago`,
        expiresAt: new Date(created.reserved_until ?? Date.now() + PAYMENT_WINDOW_MINUTES * 60000),
      });
    } catch {
      await repo.releaseOrder(created.order_id, 'canceled', 'checkout');
      throw checkoutError(503, 'payment_unavailable', CHECKOUT_MESSAGES.paymentUnavailable);
    }
    // A preferência já existe no Mercado Pago: não cancela o pedido se só a gravação falhar,
    // porque o link continua válido e a cliente poderia pagar um pedido cancelado.
    try {
      await repo.attachPreference(created.order_id, preference.id);
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'checkout_attach_preference_failed',
          orderId: created.order_id,
          errorCode: err instanceof Error ? err.name : 'unknown',
        }),
      );
    }
    return c.json(
      {
        code: created.code,
        token,
        status: created.status,
        totalCents: created.total_cents,
        orderUrl,
        checkoutUrl: preference.init_point,
      },
      201,
    );
  },
);
