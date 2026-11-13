// Respostas externas do checkout, do webhook e do cron (R3.5): banco (Supabase) e Mercado Pago.
// Nada que chega de fora é usado sem passar por aqui.
import { z } from 'zod';
import { ORDER_CODE_REGEX } from '../order';
import { uuidSchema } from './common';
import { shippingProductRowsSchema } from './shipping';

const cents = z.number().int().min(0).max(2147483647);
const timestamp = z.iso.datetime({ offset: true });

/** Produtos lidos no checkout: os campos do frete (T-012) mais o nome. */
export const checkoutProductRowsSchema = z
  .array(shippingProductRowsSchema.element.extend({ name: z.string().min(1).max(120) }))
  .max(51);
export type CheckoutProductRow = z.infer<typeof checkoutProductRowsSchema>[number];

/** Resultado de public.create_order. */
export const createOrderResultSchema = z.object({
  order_id: uuidSchema,
  code: z.string().regex(ORDER_CODE_REGEX),
  status: z.enum(['awaiting_payment', 'awaiting_shipping_quote']),
  subtotal_cents: cents,
  discount_cents: cents,
  shipping_cents: cents.nullable(),
  gift_wrap_cents: cents,
  total_cents: cents,
  reserved_until: timestamp.nullable(),
});
export type CreateOrderResult = z.infer<typeof createOrderResultSchema>;

/** Resposta da criação de preferência do Mercado Pago: o link de pagamento precisa ser HTTPS. */
export const mpPreferenceResponseSchema = z.object({
  id: z.string().min(1).max(200),
  init_point: z.url({ protocol: /^https$/ }),
});
export type MpPreferenceResponse = z.infer<typeof mpPreferenceResponseSchema>;

/** Pagamento consultado em GET /v1/payments/:id do Mercado Pago. */
export const mpPaymentSchema = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,30}$/)]).transform(String),
  status: z.string().min(1).max(40),
  transaction_amount: z.number().nonnegative().finite(),
  currency_id: z.string().min(3).max(3),
  external_reference: z.string().max(200).nullable().optional(),
  payment_type_id: z.string().max(40).nullable().optional(),
  payment_method_id: z.string().max(40).nullable().optional(),
});
export type MpPayment = z.infer<typeof mpPaymentSchema>;

/** Resultado de public.mark_order_paid. */
export const markOrderPaidResultSchema = z.enum([
  'paid',
  'duplicate',
  'already_paid',
  'double_payment',
  'late_payment',
  'amount_mismatch',
  'order_not_found',
]);
export type MarkOrderPaidResult = z.infer<typeof markOrderPaidResultSchema>;

/** Contagens devolvidas pelas funções do cron (expire_unpaid_orders, rate_limit_cleanup). */
export const cronCountSchema = z.number().int().min(0);
