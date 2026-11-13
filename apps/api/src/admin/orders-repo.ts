// Pedidos no painel (T-019). Usa a chave de serviço do Worker (R3.2). Toda mudança passa por
// funções SQL (supabase/migrations/20261112000001_admin_orders.sql): a máquina de status, o
// estoque e o total são decididos no banco, nunca por leitura + escrita aqui (R4.2).
// Respostas do banco passam por Zod (R3.5). Erros não carregam texto do banco nem dado do cliente.
import {
  ORDER_STATUSES,
  PAYMENT_ALERT_RESULTS,
  PAYMENT_METHODS,
  adminOrderDetailSchema,
  adminOrderListSchema,
  adminPaymentAlertSchema,
  type AdminOrderDetail,
  type AdminOrderList,
  type AdminOrderListQuery,
  type AdminPaymentAlert,
  type AdminStatusTarget,
} from '@sparks/shared';
import { z } from 'zod';
import type { Config } from '../env';
import { getServiceClient } from '../lib/supabase';

export const ORDERS_PAGE_SIZE = 25;
const ALERT_DAYS = 30;
const ALERT_LIMIT = 20;

export type OrderMutation =
  'ok' | 'not_found' | 'invalid_transition' | 'invalid_tracking' | 'tracking_not_allowed';
export type TrackingMutation = 'ok' | 'not_found' | 'invalid_status' | 'invalid_tracking';
export type QuoteMutation = 'ok' | 'not_found' | 'invalid_status' | 'totals_changed';

/** O que a API precisa para recalcular o total do frete a combinar. */
export interface QuoteContext {
  code: string;
  status: (typeof ORDER_STATUSES)[number];
  subtotalCents: number;
  discountCents: number;
  giftWrapCents: number;
  items: { unitPriceCents: number; qty: number }[];
}

export interface ApplyQuote {
  shippingCents: number;
  daysMin: number;
  daysMax: number;
  label: string | null;
  carrier: string | null;
  expectedTotalCents: number;
  preferenceId: string;
  checkoutUrl: string;
  expiresAt: Date;
}

export interface AdminOrdersRepo {
  list(query: AdminOrderListQuery): Promise<AdminOrderList>;
  get(id: string): Promise<AdminOrderDetail | null>;
  quoteContext(id: string): Promise<QuoteContext | null>;
  setStatus(
    id: string,
    status: AdminStatusTarget,
    tracking: string | null,
    actor: string,
  ): Promise<OrderMutation>;
  setTracking(id: string, tracking: string | null, actor: string): Promise<TrackingMutation>;
  applyQuote(id: string, quote: ApplyQuote, actor: string): Promise<QuoteMutation>;
  paymentAlerts(): Promise<AdminPaymentAlert[]>;
}

const text = z.string().nullable();
const int = z.number().int();
const listRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    code: z.string(),
    status: z.enum(ORDER_STATUSES),
    created_at: z.string(),
    customer_name: z.string(),
    total_cents: int,
    gift_message: text,
    order_items: z.array(z.object({ qty: int })),
  }),
);
const detailRowSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  status: z.enum(ORDER_STATUSES),
  created_at: z.string(),
  paid_at: text,
  reserved_until: text,
  customer_name: z.string(),
  customer_whatsapp: z.string(),
  customer_email: text,
  address: z.looseObject({}),
  address_type: z.enum(['urban', 'rural', 'hard_access']),
  subtotal_cents: int,
  discount_cents: int,
  coupon_id: z.uuid().nullable(),
  gift_wrap_product_id: z.uuid().nullable(),
  gift_wrap_cents: int,
  gift_message: text,
  shipping_cents: int.nullable(),
  shipping_label: text,
  shipping_carrier: text,
  shipping_days_min: int.nullable(),
  shipping_days_max: int.nullable(),
  total_cents: int,
  payment_method: z.enum(PAYMENT_METHODS).nullable(),
  mp_payment_id: text,
  mp_checkout_url: text,
  tracking_code: text,
  order_items: z.array(z.object({ name_snapshot: z.string(), qty: int, unit_price_cents: int })),
  order_events: z.array(
    z.object({
      from_status: z.enum(ORDER_STATUSES).nullable(),
      to_status: z.enum(ORDER_STATUSES),
      actor: z.string(),
      created_at: z.string(),
    }),
  ),
});
const quoteRowSchema = z.object({
  code: z.string(),
  status: z.enum(ORDER_STATUSES),
  subtotal_cents: int,
  discount_cents: int,
  gift_wrap_cents: int,
  order_items: z.array(z.object({ unit_price_cents: int, qty: int })),
});
const alertRowsSchema = z.array(
  z.object({
    result: z.enum(PAYMENT_ALERT_RESULTS),
    order_id: z.uuid().nullable(),
    amount_cents: int.nullable(),
    provider_payment_id: text,
    processed_at: z.string(),
    orders: z.object({ code: z.string(), total_cents: int }).nullable(),
  }),
);
const mutationSchema = z.enum([
  'ok',
  'not_found',
  'invalid_transition',
  'invalid_status',
  'invalid_tracking',
  'tracking_not_allowed',
  'totals_changed',
]);

function fail(what: string): never {
  // Só o que falhou: a mensagem do banco pode trazer dados do cliente.
  throw new Error(`admin_orders_repo_${what}`);
}

// Brasília não tem horário de verão desde 2019.
const SP_OFFSET = '-03:00';
const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

function addressField(address: Record<string, unknown>, key: string): string | null {
  const value = address[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export function supabaseAdminOrdersRepo(config: Config): AdminOrdersRepo {
  const db = getServiceClient(config);

  async function rpc<T extends string>(fn: string, args: Record<string, unknown>, what: string) {
    const { data, error } = await db.rpc(fn, args);
    if (error) fail(what);
    return mutationSchema.parse(data) as T;
  }

  return {
    async list(query) {
      let q = db
        .from('orders')
        .select(
          'id, code, status, created_at, customer_name, total_cents, gift_message, order_items(qty)',
        )
        .order('created_at', { ascending: false })
        .range((query.page - 1) * ORDERS_PAGE_SIZE, query.page * ORDERS_PAGE_SIZE);
      if (query.status) q = q.eq('status', query.status);
      if (query.from) q = q.gte('created_at', `${query.from}T00:00:00${SP_OFFSET}`);
      if (query.to) q = q.lt('created_at', `${nextDay(query.to)}T00:00:00${SP_OFFSET}`);
      // `q` já passou pelo Zod (só letras, números e hífen): nada de filtro montado com texto livre.
      if (query.q) q = q.ilike('code', `%${query.q}%`);
      const { data, error } = await q;
      if (error) fail('list');
      const rows = listRowsSchema.parse(data);

      const count = async (status: string) => {
        const res = await db
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('status', status);
        if (res.error || res.count === null) fail('count');
        return res.count;
      };
      const [awaitingShippingQuote, paid] = await Promise.all([
        count('awaiting_shipping_quote'),
        count('paid'),
      ]);

      return adminOrderListSchema.parse({
        orders: rows.slice(0, ORDERS_PAGE_SIZE).map((r) => ({
          id: r.id,
          code: r.code,
          status: r.status,
          createdAt: r.created_at,
          customerName: r.customer_name,
          itemCount: r.order_items.reduce((sum, i) => sum + i.qty, 0),
          totalCents: r.total_cents,
          hasGiftMessage: Boolean(r.gift_message),
        })),
        page: query.page,
        hasMore: rows.length > ORDERS_PAGE_SIZE,
        pending: { awaitingShippingQuote, paid },
      });
    },

    async get(id) {
      const { data, error } = await db
        .from('orders')
        .select(
          [
            'id, code, status, created_at, paid_at, reserved_until, customer_name, customer_whatsapp',
            'customer_email, address, address_type, subtotal_cents, discount_cents, coupon_id',
            'gift_wrap_product_id, gift_wrap_cents, gift_message, shipping_cents, shipping_label',
            'shipping_carrier, shipping_days_min, shipping_days_max, total_cents',
            'payment_method, mp_payment_id, mp_checkout_url, tracking_code',
            'order_items(name_snapshot, qty, unit_price_cents)',
            'order_events(from_status, to_status, actor, created_at)',
          ].join(', '),
        )
        .eq('id', id)
        .limit(1);
      if (error) fail('get');
      const first = data?.[0];
      if (first === undefined) return null;
      const r = detailRowSchema.parse(first);

      let couponCode: string | null = null;
      if (r.coupon_id) {
        const res = await db.from('coupons').select('code').eq('id', r.coupon_id).limit(1);
        if (res.error) fail('coupon');
        couponCode = z.array(z.object({ code: z.string() })).parse(res.data)[0]?.code ?? null;
      }
      let giftName: string | null = null;
      if (r.gift_wrap_product_id) {
        const res = await db
          .from('products')
          .select('name')
          .eq('id', r.gift_wrap_product_id)
          .limit(1);
        if (res.error) fail('gift_wrap');
        giftName = z.array(z.object({ name: z.string() })).parse(res.data)[0]?.name ?? null;
      }
      const events = [...r.order_events].sort((a, b) => a.created_at.localeCompare(b.created_at));

      return adminOrderDetailSchema.parse({
        id: r.id,
        code: r.code,
        status: r.status,
        createdAt: r.created_at,
        paidAt: r.paid_at,
        reservedUntil: r.reserved_until,
        customer: { name: r.customer_name, whatsapp: r.customer_whatsapp, email: r.customer_email },
        address: {
          cep: addressField(r.address, 'cep'),
          street: addressField(r.address, 'street'),
          number: addressField(r.address, 'number'),
          complement: addressField(r.address, 'complement'),
          district: addressField(r.address, 'district'),
          city: addressField(r.address, 'city'),
          uf: addressField(r.address, 'uf'),
          reference: addressField(r.address, 'reference'),
        },
        addressType: r.address_type,
        items: r.order_items.map((i) => ({
          name: i.name_snapshot,
          qty: i.qty,
          unitPriceCents: i.unit_price_cents,
        })),
        subtotalCents: r.subtotal_cents,
        discountCents: r.discount_cents,
        couponCode,
        giftWrap:
          r.gift_wrap_product_id || r.gift_wrap_cents > 0 || r.gift_message
            ? { name: giftName, cents: r.gift_wrap_cents, message: r.gift_message }
            : null,
        shipping: {
          cents: r.shipping_cents,
          label: r.shipping_label,
          carrier: r.shipping_carrier,
          daysMin: r.shipping_days_min,
          daysMax: r.shipping_days_max,
        },
        totalCents: r.total_cents,
        paymentMethod: r.payment_method,
        paymentId: r.mp_payment_id,
        paymentUrl: r.mp_checkout_url,
        trackingCode: r.tracking_code,
        events: events.map((e) => ({
          from: e.from_status,
          to: e.to_status,
          actor: e.actor,
          at: e.created_at,
        })),
      });
    },

    async quoteContext(id) {
      const { data, error } = await db
        .from('orders')
        .select(
          'code, status, subtotal_cents, discount_cents, gift_wrap_cents, order_items(unit_price_cents, qty)',
        )
        .eq('id', id)
        .limit(1);
      if (error) fail('quote_context');
      const first = data?.[0];
      if (first === undefined) return null;
      const r = quoteRowSchema.parse(first);
      return {
        code: r.code,
        status: r.status,
        subtotalCents: r.subtotal_cents,
        discountCents: r.discount_cents,
        giftWrapCents: r.gift_wrap_cents,
        items: r.order_items.map((i) => ({ unitPriceCents: i.unit_price_cents, qty: i.qty })),
      };
    },

    async setStatus(id, status, tracking, actor) {
      return rpc<OrderMutation>(
        'admin_set_order_status',
        { p_order_id: id, p_status: status, p_actor: actor, p_tracking: tracking },
        'set_status',
      );
    },

    async setTracking(id, tracking, actor) {
      return rpc<TrackingMutation>(
        'admin_set_order_tracking',
        { p_order_id: id, p_tracking: tracking ?? '', p_actor: actor },
        'set_tracking',
      );
    },

    async applyQuote(id, quote, actor) {
      return rpc<QuoteMutation>(
        'admin_quote_order',
        {
          p_order_id: id,
          p_shipping_cents: quote.shippingCents,
          p_days_min: quote.daysMin,
          p_days_max: quote.daysMax,
          p_label: quote.label ?? '',
          p_carrier: quote.carrier ?? '',
          p_expected_total_cents: quote.expectedTotalCents,
          p_preference_id: quote.preferenceId,
          p_checkout_url: quote.checkoutUrl,
          p_expires_at: quote.expiresAt.toISOString(),
          p_actor: actor,
        },
        'quote',
      );
    },

    async paymentAlerts() {
      const since = new Date(Date.now() - ALERT_DAYS * 86_400_000).toISOString();
      const { data, error } = await db
        .from('payment_events')
        .select(
          'result, order_id, amount_cents, provider_payment_id, processed_at, orders(code, total_cents)',
        )
        .in('result', [...PAYMENT_ALERT_RESULTS])
        .gte('processed_at', since)
        .order('processed_at', { ascending: false })
        .limit(ALERT_LIMIT);
      if (error) fail('alerts');
      return alertRowsSchema.parse(data).map((r) =>
        adminPaymentAlertSchema.parse({
          result: r.result,
          orderId: r.order_id,
          orderCode: r.orders?.code ?? null,
          orderTotalCents: r.orders?.total_cents ?? null,
          paidCents: r.amount_cents,
          paymentId: r.provider_payment_id,
          at: r.processed_at,
        }),
      );
    },
  };
}
