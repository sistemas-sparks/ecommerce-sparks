// Entradas externas da loja. O navegador envia só IDs, quantidades, CEP, cupom e dados de entrega (R3.3):
// nenhum preço, frete, desconto ou total é aceito do cliente.
import { z } from 'zod';
import { ADDRESS_TYPES, ORDER_CODE_REGEX } from '../order';
import {
  CONTROL_CHARS,
  cepSchema,
  optionalEmailSchema,
  singleLineText,
  textLength,
  turnstileTokenSchema,
  ufSchema,
  uuidSchema,
  whatsappSchema,
} from './common';

export const MAX_ITEM_QTY = 99;
export const MAX_CART_LINES = 50;
export const GIFT_MESSAGE_MAX = 140;

export const addressTypeSchema = z.enum(ADDRESS_TYPES, { error: 'Tipo de endereço inválido.' });
// Mesmo formato de shippingServiceIdSchema (./shipping-hybrid): own:<uuid> e me:<id>. Não importa
// aquele módulo porque shipping-hybrid -> shipping -> order-input formaria um ciclo de carga.
// O teste de schemas confere que os dois aceitam e recusam os mesmos valores.
const SHIPPING_SERVICE_ERROR = 'Opção de frete inválida.';
export const shippingServiceSchema = z
  .string({ error: SHIPPING_SERVICE_ERROR })
  .refine(
    (v) =>
      v.startsWith('own:') ? uuidSchema.safeParse(v.slice(4)).success : /^me:[1-9]\d{0,5}$/.test(v),
    { message: SHIPPING_SERVICE_ERROR },
  );

/** Cupom: maiúsculas, letras e números, 3 a 20 caracteres. */
export const couponCodeSchema = z
  .string({ error: 'Informe o cupom.' })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{3,20}$/, { error: 'Cupom inválido.' });

/** Mensagem do cartão de presente: até 140 caracteres, quebras de linha permitidas. */
export const giftMessageSchema = z
  .string()
  .transform((v) => v.replace(/\r\n?/g, '\n').trim())
  .refine((v) => !CONTROL_CHARS.test(v), { error: 'A mensagem tem caracteres inválidos.' })
  .refine((v) => textLength(v) <= GIFT_MESSAGE_MAX, {
    error: `A mensagem pode ter no máximo ${GIFT_MESSAGE_MAX} caracteres.`,
  });

export const cartItemSchema = z.object({
  productId: uuidSchema,
  qty: z
    .number({ error: 'Quantidade inválida.' })
    .int({ error: 'Quantidade inválida.' })
    .min(1, { error: 'Quantidade mínima é 1.' })
    .max(MAX_ITEM_QTY, { error: `Quantidade máxima é ${MAX_ITEM_QTY}.` }),
});
export type CartItemInput = z.infer<typeof cartItemSchema>;

export const cartItemsSchema = z
  .array(cartItemSchema)
  .min(1, { error: 'A sacola está vazia.' })
  .max(MAX_CART_LINES, { error: 'Itens demais na sacola.' })
  .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, {
    error: 'Produto repetido na sacola.',
  });

export const giftWrapInputSchema = z.object({
  productId: uuidSchema,
  message: giftMessageSchema,
});

export const addressSchema = z.object({
  cep: cepSchema,
  street: singleLineText(2, 120, 'Rua'),
  number: singleLineText(1, 20, 'Número'),
  complement: singleLineText(0, 60, 'Complemento').optional(),
  district: singleLineText(2, 80, 'Bairro'),
  city: singleLineText(2, 80, 'Cidade'),
  uf: ufSchema,
  reference: singleLineText(0, 120, 'Ponto de referência').optional(),
  addressType: addressTypeSchema,
});
export type AddressInput = z.infer<typeof addressSchema>;

export const customerSchema = z.object({
  name: singleLineText(2, 80, 'Nome'),
  whatsapp: whatsappSchema,
  email: optionalEmailSchema,
});

export const shippingQuoteInputSchema = z.object({
  cep: cepSchema,
  items: cartItemsSchema,
  addressType: addressTypeSchema.default('urban'),
  couponCode: couponCodeSchema.optional(),
  giftWrapProductId: uuidSchema.optional(),
});
export type ShippingQuoteInput = z.infer<typeof shippingQuoteInputSchema>;

// `shippingQuotedCents` é o preço que o navegador mostrou: serve só para comparar com o recálculo
// do servidor, nunca para cobrar (R3.3).
export const checkoutInputSchema = z
  .object({
    items: cartItemsSchema,
    customer: customerSchema,
    address: addressSchema,
    shippingService: shippingServiceSchema.optional(),
    shippingQuotedCents: z.number().int().min(0).max(2147483647).optional(),
    couponCode: couponCodeSchema.optional(),
    giftWrap: giftWrapInputSchema.optional(),
    turnstileToken: turnstileTokenSchema,
  })
  .refine((v) => (v.shippingService === undefined) === (v.shippingQuotedCents === undefined), {
    error: 'Escolha a opção de entrega de novo.',
    path: ['shippingService'],
  });
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

export const orderCodeSchema = z
  .string({ error: 'Informe o código do pedido.' })
  .trim()
  .toUpperCase()
  .regex(ORDER_CODE_REGEX, { error: 'Código do pedido inválido.' });

export const orderLookupInputSchema = z.object({
  code: orderCodeSchema,
  whatsapp: whatsappSchema,
  turnstileToken: turnstileTokenSchema,
});
export type OrderLookupInput = z.infer<typeof orderLookupInputSchema>;
