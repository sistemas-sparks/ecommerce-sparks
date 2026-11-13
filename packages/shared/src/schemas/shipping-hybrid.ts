// Contrato público da cotação de frete híbrida (resposta). A requisição continua em ./shipping.
import { z } from 'zod';
import { cepSchema, uuidSchema } from './common';
import {
  packageSizeInputSchema,
  shippingExceptionInputSchema,
  shippingSettingsInputSchema,
} from './shipping';

const INVALID_SERVICE = 'Opção de frete inválida.';
const ME_ID = /^me:[1-9]\d{0,5}$/;

function isServiceId(value: string): boolean {
  if (value.startsWith('own:')) return uuidSchema.safeParse(value.slice(4)).success;
  return ME_ID.test(value);
}

export const shippingServiceIdSchema = z
  .string({ error: INVALID_SERVICE })
  .refine(isServiceId, { message: INVALID_SERVICE });

const days = z.number().int().min(0).max(365);

export const hybridShippingOptionSchema = z
  .object({
    service: shippingServiceIdSchema,
    carrier: z.string().min(1).max(100).nullable(),
    label: z.string().min(1).max(200),
    priceCents: z.number().int().min(0).max(2147483647),
    daysMin: days,
    daysMax: days,
  })
  .refine((o) => o.daysMin <= o.daysMax, { message: 'Prazo inválido.', path: ['daysMax'] });

const message = z.string().min(1).max(500);

export const hybridShippingQuoteResponseSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('options'),
    options: z.array(hybridShippingOptionSchema).min(1).max(30),
  }),
  z.object({
    mode: z.literal('consult'),
    reason: z.enum(['cep_exception', 'address_type', 'too_heavy', 'too_many_items', 'no_option']),
    message,
  }),
  z.object({ mode: z.literal('blocked'), message }),
  z.object({ mode: z.literal('invalid'), message }),
]);

const hybridAmount = z.number().int().min(0).max(2147483647);

/** Linhas do banco (snake_case) que o motor híbrido lê: só ativos/habilitados. */
export const shippingHybridDataSchema = z.object({
  exceptions: z.array(shippingExceptionInputSchema.safeExtend({ id: uuidSchema })).max(5000),
  package_sizes: z
    .array(packageSizeInputSchema)
    .length(3)
    .refine(
      (rows) => new Set(rows.map((row) => row.size)).size === 3,
      'Configure os tamanhos P, M e G.',
    ),
  settings: shippingSettingsInputSchema.extend({
    gift_wrap_enabled: z.boolean(),
    melhor_envio_margin_cents: hybridAmount,
  }),
  own_types: z
    .array(
      z.object({
        id: uuidSchema,
        name: z.string().min(1).max(100),
        active: z.boolean(),
        sort_order: hybridAmount,
      }),
    )
    .max(200),
  own_areas: z
    .array(
      z.object({
        id: uuidSchema,
        type_id: uuidSchema,
        label: z.string().max(100),
        cep_start: cepSchema,
        cep_end: cepSchema,
        price_cents: hybridAmount,
        days_min: z.number().int().min(0).max(365),
        days_max: z.number().int().min(0).max(365),
        active: z.boolean(),
      }),
    )
    .max(5000),
  melhor_envio_services: z
    .array(
      z.object({
        service_id: z.number().int().min(1).max(999999),
        name: z.string().min(1).max(100),
        carrier: z.string().min(1).max(100),
        enabled: z.literal(true),
        sort_order: hybridAmount,
      }),
    )
    .max(50),
});
export type ShippingHybridData = z.infer<typeof shippingHybridDataSchema>;
