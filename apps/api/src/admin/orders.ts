// Painel de pedidos (T-019). Protegido pelo guard de /admin/* (admin + aal2) montado em app.ts.
// A lojista escolhe o próximo status, digita o rastreio (a etiqueta é comprada no Melhor Envio,
// nunca por aqui: R2.5) e libera a cobrança do frete a combinar. Nenhum e-mail é enviado (R2.4):
// o aviso ao cliente é um link de WhatsApp montado no navegador da lojista.
import {
  QUOTE_LINK_HOURS,
  adminOrderDetailSchema,
  adminOrderListQuerySchema,
  adminOrderListSchema,
  adminOrderQuoteInputSchema,
  adminOrderStatusInputSchema,
  adminOrderTrackingInputSchema,
  adminPaymentAlertsSchema,
  computeSubtotal,
  sumCents,
  uuidSchema,
} from '@sparks/shared';
import { Hono } from 'hono';
import { loadCheckoutSecrets } from '../checkout/config';
import { createPreference } from '../checkout/mercadopago';
import { apiError } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

const writeLimit = rateLimit({ bucket: 'admin-orders', max: 60, windowSeconds: 600 });
const quoteLimit = rateLimit({ bucket: 'admin-orders-quote', max: 20, windowSeconds: 600 });

export const ORDER_MESSAGES = {
  invalidInput: 'Confira os dados informados.',
  notFound: 'Pedido não encontrado.',
  invalidTransition: 'Esse pedido não pode mudar para esse status agora. Atualize a página.',
  invalidTracking: 'O rastreio deve ter de 4 a 40 letras, números ou hífen.',
  trackingStatus:
    'O rastreio só pode ser informado com o pedido em separação, enviado ou entregue.',
  trackingWithStatus: 'O rastreio só pode ser informado ao marcar como enviado ou entregue.',
  quoteStatus: 'Esse pedido não está aguardando o frete. Atualize a página.',
  totalsChanged: 'Os valores do pedido mudaram. Atualize a página e confira antes de liberar.',
  paymentUnavailable:
    'Não foi possível gerar o link de pagamento agora. Nada foi alterado; tente de novo em instantes.',
} as const;

const idOf = (raw: string) => {
  const id = uuidSchema.safeParse(raw);
  if (!id.success) throw apiError(404, 'not_found', ORDER_MESSAGES.notFound);
  return id.data;
};
const invalid = (message?: string) =>
  apiError(400, 'invalid_input', message ?? ORDER_MESSAGES.invalidInput);
export const ordersAdminRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const parsed = adminOrderListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw invalid(parsed.error.issues[0]?.message);
    return c.json(
      adminOrderListSchema.parse(await c.var.deps.adminOrdersRepo(c.var.config).list(parsed.data)),
    );
  })
  // Pagamento duplicado, fora do prazo e valor diferente (antes só no log do webhook).
  .get('/payment-alerts', async (c) =>
    c.json(
      adminPaymentAlertsSchema.parse({
        alerts: await c.var.deps.adminOrdersRepo(c.var.config).paymentAlerts(),
      }),
    ),
  )
  .get('/:id', async (c) => {
    const order = await c.var.deps.adminOrdersRepo(c.var.config).get(idOf(c.req.param('id')));
    if (!order) throw apiError(404, 'not_found', ORDER_MESSAGES.notFound);
    return c.json(adminOrderDetailSchema.parse(order));
  })
  .post('/:id/status', writeLimit, async (c) => {
    const id = idOf(c.req.param('id'));
    const parsed = adminOrderStatusInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw invalid(parsed.error.issues[0]?.message);
    const repo = c.var.deps.adminOrdersRepo(c.var.config);
    const result = await repo.setStatus(
      id,
      parsed.data.status,
      parsed.data.trackingCode ?? null,
      `admin:${c.var.user.id}`,
    );
    if (result === 'not_found') throw apiError(404, 'not_found', ORDER_MESSAGES.notFound);
    if (result === 'invalid_transition') {
      throw apiError(409, 'invalid_transition', ORDER_MESSAGES.invalidTransition);
    }
    if (result === 'invalid_tracking') {
      throw apiError(400, 'invalid_input', ORDER_MESSAGES.invalidTracking);
    }
    if (result === 'tracking_not_allowed') {
      throw apiError(400, 'invalid_input', ORDER_MESSAGES.trackingWithStatus);
    }
    return c.json(adminOrderDetailSchema.parse(await repo.get(id)));
  })
  .put('/:id/tracking', writeLimit, async (c) => {
    const id = idOf(c.req.param('id'));
    const parsed = adminOrderTrackingInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw invalid(parsed.error.issues[0]?.message);
    const repo = c.var.deps.adminOrdersRepo(c.var.config);
    const result = await repo.setTracking(id, parsed.data.trackingCode, `admin:${c.var.user.id}`);
    if (result === 'not_found') throw apiError(404, 'not_found', ORDER_MESSAGES.notFound);
    if (result === 'invalid_status') {
      throw apiError(409, 'invalid_status', ORDER_MESSAGES.trackingStatus);
    }
    if (result === 'invalid_tracking') {
      throw apiError(400, 'invalid_input', ORDER_MESSAGES.invalidTracking);
    }
    return c.json(adminOrderDetailSchema.parse(await repo.get(id)));
  })
  // Frete a combinar (frete.md §7): a lojista informa valor e prazo; o servidor recalcula o total
  // com os dados gravados do pedido, cria o link de pagamento (48 h) e SÓ ENTÃO libera a cobrança.
  .post('/:id/quote', quoteLimit, async (c) => {
    const id = idOf(c.req.param('id'));
    const parsed = adminOrderQuoteInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw invalid(parsed.error.issues[0]?.message);
    const input = parsed.data;
    const repo = c.var.deps.adminOrdersRepo(c.var.config);

    const order = await repo.quoteContext(id);
    if (!order) throw apiError(404, 'not_found', ORDER_MESSAGES.notFound);
    if (order.status !== 'awaiting_shipping_quote') {
      throw apiError(409, 'invalid_status', ORDER_MESSAGES.quoteStatus);
    }
    // Preço sempre do servidor (R3.3): o subtotal gravado precisa bater com os itens (snapshot).
    if (
      computeSubtotal(order.items) !== order.subtotalCents ||
      order.discountCents > order.subtotalCents
    ) {
      throw apiError(409, 'totals_changed', ORDER_MESSAGES.totalsChanged);
    }
    const totalCents = sumCents([
      order.subtotalCents - order.discountCents,
      input.shippingCents,
      order.giftWrapCents,
    ]);

    const secrets = loadCheckoutSecrets(c.env ?? {});
    const site = c.var.config.siteOrigins[0];
    const expiresAt = new Date(Date.now() + QUOTE_LINK_HOURS * 3_600_000);
    let preference: Awaited<ReturnType<typeof createPreference>>;
    try {
      preference = await createPreference(c.var.deps.fetch, secrets.mpAccessToken, {
        orderId: id,
        orderCode: order.code,
        totalCents,
        // O token do link do pedido só existe no navegador de quem comprou: volta para a consulta.
        returnUrl: `${site}/consultar-pedido/`,
        notificationUrl: `${new URL(c.req.url).origin}/webhooks/mercadopago`,
        expiresAt,
        // Cada tentativa é uma preferência nova (o valor pode ter mudado entre as tentativas).
        idempotencyKey: crypto.randomUUID(),
      });
    } catch {
      throw apiError(503, 'payment_unavailable', ORDER_MESSAGES.paymentUnavailable);
    }

    const result = await repo.applyQuote(
      id,
      {
        shippingCents: input.shippingCents,
        daysMin: input.daysMin,
        daysMax: input.daysMax,
        label: input.label || null,
        carrier: input.carrier || null,
        expectedTotalCents: totalCents,
        preferenceId: preference.id,
        checkoutUrl: preference.init_point,
        expiresAt,
      },
      `admin:${c.var.user.id}`,
    );
    if (result === 'not_found') throw apiError(404, 'not_found', ORDER_MESSAGES.notFound);
    if (result === 'invalid_status')
      throw apiError(409, 'invalid_status', ORDER_MESSAGES.quoteStatus);
    if (result === 'totals_changed') {
      throw apiError(409, 'totals_changed', ORDER_MESSAGES.totalsChanged);
    }
    return c.json(adminOrderDetailSchema.parse(await repo.get(id)));
  });
