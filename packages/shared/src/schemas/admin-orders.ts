// Painel de pedidos (T-019): entradas e respostas da API /admin/orders.
// A resposta do painel traz WhatsApp e endereço completo (só a lojista, atrás de admin + aal2);
// a lista não traz nenhum dado de contato (R3.7).
import { z } from 'zod';
import { ORDER_CODE_REGEX, ORDER_STATUSES, PAYMENT_METHODS } from '../order';
import { singleLineText, uuidSchema } from './common';

const cents = z.number().int().min(0);

/** Status que a lojista escolhe. Pago vem do webhook, expirado do cron e "aguardando pagamento" da confirmação do frete. */
export const ADMIN_STATUS_TARGETS = [
  'preparing',
  'shipped',
  'delivered',
  'returned',
  'canceled',
] as const;
export type AdminStatusTarget = (typeof ADMIN_STATUS_TARGETS)[number];

/** Teto de sanidade contra erro de digitação (R$ 2.000,00); não é regra comercial. */
export const MAX_QUOTE_SHIPPING_CENTS = 200_000;
export const MAX_QUOTE_DAYS = 60;
/** Validade do link de pagamento do frete a combinar (frete.md §7). */
export const QUOTE_LINK_HOURS = 48;

/** Rastreio digitado: letras, números e hífen (4 a 40), sempre em maiúsculas. Vazio = apagar. */
export const trackingCodeSchema = z
  .string({ error: 'Informe o código de rastreio.' })
  .trim()
  .transform((v) => (v === '' ? null : v.toUpperCase()))
  .pipe(
    z.union([
      z.null(),
      z.string().regex(/^[A-Z0-9-]{4,40}$/, {
        error: 'O rastreio deve ter de 4 a 40 letras, números ou hífen.',
      }),
    ]),
  );

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Data inválida.' })
  .refine(
    (v) => {
      const d = new Date(`${v}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
    },
    { error: 'Data inválida.' },
  );

export const adminOrderListQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  /** Parte do código do pedido. Só letras, números e hífen. */
  q: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,10}$/, { error: 'Busque pelo código do pedido, ex.: SPK-7F3K2.' })
    .optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;

/** Status em que o rastreio pode vir junto com a mudança (nos demais, use o campo de rastreio). */
export const TRACKING_STATUS_TARGETS: readonly AdminStatusTarget[] = ['shipped', 'delivered'];

export const adminOrderStatusInputSchema = z
  .object({
    status: z.enum(ADMIN_STATUS_TARGETS, { error: 'Status inválido.' }),
    trackingCode: trackingCodeSchema.optional(),
  })
  .refine((v) => !v.trackingCode || TRACKING_STATUS_TARGETS.includes(v.status), {
    error: 'O rastreio só pode ser informado ao marcar como enviado ou entregue.',
    path: ['trackingCode'],
  });
export type AdminOrderStatusInput = z.infer<typeof adminOrderStatusInputSchema>;

export const adminOrderTrackingInputSchema = z.object({ trackingCode: trackingCodeSchema });

export const adminOrderQuoteInputSchema = z
  .object({
    shippingCents: z
      .number({ error: 'Informe o valor do frete.' })
      .int({ error: 'Informe o valor do frete.' })
      .min(0, { error: 'O frete não pode ser negativo.' })
      .max(MAX_QUOTE_SHIPPING_CENTS, { error: 'Esse valor de frete parece alto demais. Confira.' }),
    daysMin: z.number().int().min(0).max(MAX_QUOTE_DAYS, { error: 'Prazo longo demais.' }),
    daysMax: z.number().int().min(0).max(MAX_QUOTE_DAYS, { error: 'Prazo longo demais.' }),
    label: singleLineText(0, 60, 'Serviço').optional(),
    carrier: singleLineText(0, 100, 'Transportadora').optional(),
  })
  .refine((v) => v.daysMax >= v.daysMin, {
    error: 'O prazo máximo não pode ser menor que o mínimo.',
    path: ['daysMax'],
  });
export type AdminOrderQuoteInput = z.infer<typeof adminOrderQuoteInputSchema>;

// ---- Respostas ----
export const adminOrderListItemSchema = z.object({
  id: uuidSchema,
  code: z.string().regex(ORDER_CODE_REGEX),
  status: z.enum(ORDER_STATUSES),
  createdAt: z.string(),
  customerName: z.string(),
  itemCount: z.number().int().min(0),
  totalCents: cents,
  /** Mensagem de presente a imprimir. */
  hasGiftMessage: z.boolean(),
});
export type AdminOrderListItem = z.infer<typeof adminOrderListItemSchema>;

export const adminOrderListSchema = z.object({
  orders: z.array(adminOrderListItemSchema),
  page: z.number().int().min(1),
  hasMore: z.boolean(),
  /** Pedidos que esperam a lojista: frete a combinar e pagos para separar. */
  pending: z.object({
    awaitingShippingQuote: z.number().int().min(0),
    paid: z.number().int().min(0),
  }),
});
export type AdminOrderList = z.infer<typeof adminOrderListSchema>;

const nullableText = z.string().nullable();

export const adminOrderDetailSchema = z.object({
  id: uuidSchema,
  code: z.string().regex(ORDER_CODE_REGEX),
  status: z.enum(ORDER_STATUSES),
  createdAt: z.string(),
  paidAt: nullableText,
  /** Fim da reserva do estoque (e do link de pagamento) enquanto aguarda pagamento. */
  reservedUntil: nullableText,
  customer: z.object({ name: z.string(), whatsapp: z.string(), email: nullableText }),
  address: z.object({
    cep: nullableText,
    street: nullableText,
    number: nullableText,
    complement: nullableText,
    district: nullableText,
    city: nullableText,
    uf: nullableText,
    reference: nullableText,
  }),
  addressType: z.enum(['urban', 'rural', 'hard_access']),
  items: z.array(
    z.object({ name: z.string(), qty: z.number().int().min(1), unitPriceCents: cents }),
  ),
  subtotalCents: cents,
  discountCents: cents,
  couponCode: nullableText,
  giftWrap: z.object({ name: nullableText, cents, message: nullableText }).nullable(),
  shipping: z.object({
    cents: cents.nullable(),
    label: nullableText,
    carrier: nullableText,
    daysMin: z.number().int().nullable(),
    daysMax: z.number().int().nullable(),
  }),
  totalCents: cents,
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  /** Número do pagamento no Mercado Pago (para o estorno manual ao cancelar pedido pago). */
  paymentId: nullableText,
  /** Link de pagamento liberado (só depois do frete a combinar). */
  paymentUrl: z.url({ protocol: /^https$/ }).nullable(),
  trackingCode: nullableText,
  events: z.array(
    z.object({
      from: z.enum(ORDER_STATUSES).nullable(),
      to: z.enum(ORDER_STATUSES),
      actor: z.string(),
      at: z.string(),
    }),
  ),
});
export type AdminOrderDetail = z.infer<typeof adminOrderDetailSchema>;

export const PAYMENT_ALERT_RESULTS = ['double_payment', 'late_payment', 'amount_mismatch'] as const;
export type PaymentAlertResult = (typeof PAYMENT_ALERT_RESULTS)[number];

export const PAYMENT_ALERT_LABELS: Record<PaymentAlertResult, string> = {
  double_payment: 'Pagamento em duplicidade',
  late_payment: 'Pagamento fora do prazo',
  amount_mismatch: 'Valor pago diferente do pedido',
};

export const adminPaymentAlertSchema = z.object({
  result: z.enum(PAYMENT_ALERT_RESULTS),
  orderId: uuidSchema.nullable(),
  orderCode: z.string().nullable(),
  orderTotalCents: cents.nullable(),
  paidCents: cents.nullable(),
  /** Número do pagamento no Mercado Pago, para localizar e estornar lá. */
  paymentId: nullableText,
  at: z.string(),
});
export type AdminPaymentAlert = z.infer<typeof adminPaymentAlertSchema>;
export const adminPaymentAlertsSchema = z.object({ alerts: z.array(adminPaymentAlertSchema) });
