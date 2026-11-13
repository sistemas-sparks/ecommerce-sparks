// Pedido visto pelo cliente (página do pedido, "Consultar pedido" e "Minha conta") e dados da conta.
// A resposta pública é enxuta de propósito (R3.7): só o primeiro nome, cidade e UF do destino,
// sem WhatsApp, e-mail, CPF nem endereço completo. O mesmo formato serve ao site e à API.
import { z } from 'zod';
import { ORDER_CODE_REGEX, ORDER_STATUSES, PAYMENT_METHODS } from '../order';
import { addressSchema } from './order-input';
import { singleLineText, uuidSchema, whatsappSchema } from './common';

const cents = z.number().int().min(0);

export const orderViewItemSchema = z.object({
  name: z.string(),
  qty: z.number().int().min(1),
  unitPriceCents: cents,
});

export const orderViewSchema = z.object({
  code: z.string().regex(ORDER_CODE_REGEX),
  status: z.enum(ORDER_STATUSES),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
  /** Só enquanto aguarda pagamento: até quando os itens ficam reservados. */
  reservedUntil: z.string().nullable(),
  customerFirstName: z.string(),
  destination: z.object({ city: z.string(), uf: z.string() }).nullable(),
  items: z.array(orderViewItemSchema),
  subtotalCents: cents,
  discountCents: cents,
  /** null = frete ainda a combinar. */
  shippingCents: cents.nullable(),
  giftWrapCents: cents,
  totalCents: cents,
  shipping: z
    .object({
      label: z.string().nullable(),
      carrier: z.string().nullable(),
      daysMin: z.number().int().nullable(),
      daysMax: z.number().int().nullable(),
    })
    .nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
  trackingCode: z.string().nullable(),
  events: z.array(z.object({ status: z.enum(ORDER_STATUSES), at: z.string() })),
  /** O pedido já está guardado em alguma conta (não diz qual). */
  linkedToAccount: z.boolean(),
});
export type OrderView = z.infer<typeof orderViewSchema>;

export const orderSummarySchema = z.object({
  code: z.string().regex(ORDER_CODE_REGEX),
  status: z.enum(ORDER_STATUSES),
  createdAt: z.string(),
  totalCents: cents,
  itemCount: z.number().int().min(0),
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;
export const orderSummaryListSchema = z.object({ orders: z.array(orderSummarySchema) });

/** Link exclusivo do pedido: 256 bits aleatórios em base64url (ver apps/api/src/checkout/token.ts). */
export const ORDER_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;
export const orderTokenSchema = z.string().regex(ORDER_TOKEN_REGEX);

/** Guardar na conta um pedido feito sem login (quem tem o link exclusivo pode guardá-lo). */
export const orderClaimInputSchema = z.object({ token: orderTokenSchema });

// ---- Linhas do banco (validadas antes de usar, R3.5) ----
export const orderRowSchema = z.object({
  code: z.string().regex(ORDER_CODE_REGEX),
  status: z.enum(ORDER_STATUSES),
  customer_user_id: z.uuid().nullable(),
  customer_name: z.string(),
  address: z.looseObject({ city: z.string().optional(), uf: z.string().optional() }),
  shipping_service: z.string().nullable(),
  shipping_label: z.string().nullable(),
  shipping_carrier: z.string().nullable(),
  shipping_cents: cents.nullable(),
  shipping_days_min: z.number().int().nullable(),
  shipping_days_max: z.number().int().nullable(),
  tracking_code: z.string().nullable(),
  subtotal_cents: cents,
  discount_cents: cents,
  gift_wrap_cents: cents,
  total_cents: cents,
  payment_method: z.enum(PAYMENT_METHODS).nullable(),
  paid_at: z.string().nullable(),
  reserved_until: z.string().nullable(),
  created_at: z.string(),
  order_items: z.array(
    z.object({
      name_snapshot: z.string(),
      unit_price_cents: cents,
      qty: z.number().int().min(1),
    }),
  ),
  order_events: z.array(z.object({ to_status: z.enum(ORDER_STATUSES), created_at: z.string() })),
});
export type OrderRow = z.infer<typeof orderRowSchema>;
export const orderRowsSchema = z.array(orderRowSchema);

// ---- Conta do cliente (endereço salvo e favoritos) ----
const optionalName = singleLineText(0, 80, 'Nome').transform((v) => (v === '' ? null : v));
const optionalWhatsapp = z
  .string({ error: 'Informe o WhatsApp.' })
  .trim()
  .transform((v) => (v === '' ? null : v))
  .pipe(z.union([z.null(), whatsappSchema]));

/** Substitui o perfil inteiro: campo vazio apaga o dado salvo. */
export const profileInputSchema = z.object({
  name: optionalName,
  whatsapp: optionalWhatsapp,
  defaultAddress: addressSchema.nullable(),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export const profileSchema = z.object({
  name: z.string().nullable(),
  whatsapp: z.string().nullable(),
  defaultAddress: addressSchema.nullable(),
});
export type Profile = z.infer<typeof profileSchema>;

export const profileRowSchema = z.object({
  name: z.string().nullable(),
  whatsapp: z.string().nullable(),
  default_address: z.unknown(),
});

export const accountFavoritesInputSchema = z.object({
  ids: z
    .array(uuidSchema)
    .max(200, { error: 'Favoritos demais.' })
    .refine((ids) => new Set(ids).size === ids.length, { error: 'Favorito repetido.' }),
});
export const accountFavoritesSchema = accountFavoritesInputSchema;
export type AccountFavorites = z.infer<typeof accountFavoritesSchema>;
