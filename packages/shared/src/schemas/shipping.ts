import { z } from 'zod';
import { cepSchema, turnstileTokenSchema, ufSchema, uuidSchema } from './common';
import { shippingQuoteInputSchema } from './order-input';

const amount = z.number().int().min(0).max(2147483647);
const positive = z.number().int().min(1).max(2147483647);
const days = z.number().int().min(0).max(365);
const range = { cep_start: cepSchema, cep_end: cepSchema };
const duration = { days_min: days, days_max: days };

export const shippingQuoteRequestSchema = shippingQuoteInputSchema.extend({
  turnstileToken: turnstileTokenSchema,
});
export const shippingZoneInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  ufs: z
    .array(ufSchema)
    .min(1)
    .max(27)
    .refine((ufs) => new Set(ufs).size === ufs.length, 'Estado repetido.'),
  active: z.boolean(),
});
export const shippingRateInputSchema = z
  .object({
    zone_id: uuidSchema,
    service: z.enum(['economy', 'express']),
    max_weight_g: positive,
    price_cents: amount,
    ...duration,
  })
  .refine((row) => row.days_max >= row.days_min, 'Prazo máximo deve ser maior ou igual ao mínimo.');
export const shippingLocalInputSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    ...range,
    price_cents: amount,
    ...duration,
    active: z.boolean(),
  })
  .refine(
    (row) => row.cep_start <= row.cep_end && row.days_max >= row.days_min,
    'Confira faixa de CEP e prazos.',
  );
export const shippingExceptionInputSchema = z
  .object({
    ...range,
    action: z.enum(['block', 'consult', 'extra_days', 'extra_cents']),
    value: positive.nullable(),
    note: z.string().trim().max(300).nullable(),
  })
  .refine(
    (row) =>
      row.cep_start <= row.cep_end &&
      (row.action === 'block' || row.action === 'consult' || row.value !== null) &&
      (row.action !== 'extra_days' || (row.value !== null && row.value <= 365)),
    'Confira faixa de CEP e valor do acréscimo.',
  );
export const packageSizeInputSchema = z.object({
  size: z.enum(['P', 'M', 'G']),
  weight_g: positive,
  length_cm: positive,
  width_cm: positive,
  height_cm: positive,
});
export const shippingSettingsInputSchema = z.object({
  origin_cep: cepSchema.nullable(),
  origin_uf: ufSchema.nullable(),
  handling_days: days,
  free_shipping_min_cents: amount.nullable(),
  max_items_auto_shipping: positive.nullable(),
  max_weight_auto_g: positive.nullable(),
  package_tare_g: amount,
  cubic_divisor: z.null(),
});

export const shippingAdminDataSchema = z.object({
  uf_ranges: z.array(z.object({ uf: ufSchema, ...range })).max(100),
  zones: z.array(shippingZoneInputSchema.extend({ id: uuidSchema })).max(100),
  rates: z.array(shippingRateInputSchema.safeExtend({ id: uuidSchema })).max(5000),
  local_rules: z.array(shippingLocalInputSchema.safeExtend({ id: uuidSchema })).max(5000),
  exceptions: z.array(shippingExceptionInputSchema.safeExtend({ id: uuidSchema })).max(5000),
  package_sizes: z
    .array(packageSizeInputSchema)
    .length(3)
    .refine(
      (rows) => new Set(rows.map((row) => row.size)).size === 3,
      'Configure os tamanhos P, M e G.',
    ),
  settings: shippingSettingsInputSchema.extend({ gift_wrap_enabled: z.boolean() }),
});
export const shippingProductRowsSchema = z
  .array(
    z.object({
      id: uuidSchema,
      price_cents: amount,
      stock: amount,
      active: z.boolean(),
      kind: z.enum(['regular', 'gift_wrap']),
      deleted_at: z.string().nullable(),
      weight_g: positive.nullable(),
      package_size: z.enum(['P', 'M', 'G']),
      length_cm: positive.nullable(),
      width_cm: positive.nullable(),
      height_cm: positive.nullable(),
    }),
  )
  .max(51);
export const shippingCouponRowSchema = z
  .object({
    type: z.enum(['percent', 'fixed']),
    value: positive,
    min_order_cents: amount.nullable(),
    max_uses: positive.nullable(),
    used_count: amount,
    active: z.boolean(),
    starts_at: z.iso.datetime({ offset: true }).nullable(),
    ends_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .refine((coupon) => coupon.type !== 'percent' || coupon.value <= 100);
export const shippingQuoteResponseSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('options'),
    options: z
      .array(
        z.object({
          service: z.enum(['local', 'economy', 'express']),
          label: z.string(),
          priceCents: amount,
          daysMin: amount,
          daysMax: amount,
        }),
      )
      .min(1),
    chargeableWeightG: amount.nullable(),
  }),
  z.object({
    mode: z.literal('consult'),
    reason: z.enum([
      'cep_exception',
      'address_type',
      'no_zone',
      'too_heavy',
      'too_many_items',
      'no_rate',
    ]),
    message: z.string(),
  }),
  z.object({ mode: z.literal('blocked'), message: z.string() }),
  z.object({ mode: z.literal('invalid'), message: z.string() }),
]);
export const shippingEntitySchema = z.enum([
  'zones',
  'rates',
  'local-rules',
  'exceptions',
  'package-sizes',
]);
export const shippingWriteResultSchema = z.object({ id: uuidSchema });
export const shippingPackageWriteResultSchema = packageSizeInputSchema.pick({ size: true });
export const shippingSettingsWriteResultSchema = z.object({ id: z.literal(1) });
export type ShippingAdminData = z.infer<typeof shippingAdminDataSchema>;
export type ShippingEntity = z.infer<typeof shippingEntitySchema>;
export type ShippingSettingsInput = z.infer<typeof shippingSettingsInputSchema>;
export type ShippingProductRow = z.infer<typeof shippingProductRowsSchema>[number];
export type ShippingCouponRow = z.infer<typeof shippingCouponRowSchema>;
