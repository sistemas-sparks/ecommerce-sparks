// Contrato da API admin do frete híbrido (docs/frete.md §3 e §4): fretes próprios, serviços do
// Melhor Envio e folga. Dinheiro sempre em centavos inteiros (R4.1). Valores espelham a migration
// 20261020000001_shipping_hybrid.sql.
import { z } from 'zod';
import { cepSchema, uuidSchema } from './common';
import {
  packageSizeInputSchema,
  shippingExceptionInputSchema,
  shippingSettingsInputSchema,
} from './shipping';

const amount = z.number().int().min(0).max(2147483647);
const days = z.number().int().min(0).max(365);
const sortOrder = z.number().int().min(0).max(9999);

/** Teto da folga do Melhor Envio: R$ 1.000,00 por cotação (100000 centavos). Evita erro de digitação. */
export const MELHOR_ENVIO_MARGIN_MAX_CENTS = 100000;

export const ownTypeInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  active: z.boolean(),
  sort_order: sortOrder,
});

export const ownAreaInputSchema = z
  .object({
    type_id: uuidSchema,
    label: z.string().trim().max(60),
    cep_start: cepSchema,
    cep_end: cepSchema,
    price_cents: amount,
    days_min: days,
    days_max: days,
    active: z.boolean(),
  })
  .refine((row) => row.cep_start <= row.cep_end, {
    message: 'O CEP inicial deve ser menor ou igual ao final.',
    path: ['cep_end'],
  })
  .refine((row) => row.days_min <= row.days_max, {
    message: 'O prazo máximo deve ser maior ou igual ao mínimo.',
    path: ['days_max'],
  });

/** Serviços do Melhor Envio só são ligados/desligados e renomeados; a lista vem da migration. */
export const meServiceInputSchema = z.object({
  enabled: z.boolean(),
  name: z.string().trim().min(1).max(100).optional(),
  sort_order: sortOrder.optional(),
});

/** PATCH /settings: os campos de antes, mais a folga (opcional; ausente = não altera). */
export const shippingHybridSettingsInputSchema = shippingSettingsInputSchema.extend({
  melhor_envio_margin_cents: z.number().int().min(0).max(MELHOR_ENVIO_MARGIN_MAX_CENTS).optional(),
});

export const shippingAdminEntitySchema = z.enum([
  'own-types',
  'own-areas',
  'me-services',
  'exceptions',
  'package-sizes',
]);

export const shippingHybridAdminDataSchema = z.object({
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
    melhor_envio_margin_cents: z.number().int().min(0).max(2147483647),
  }),
  own_types: z.array(ownTypeInputSchema.extend({ id: uuidSchema })).max(200),
  own_areas: z.array(ownAreaInputSchema.safeExtend({ id: uuidSchema })).max(5000),
  me_services: z
    .array(
      z.object({
        service_id: z.number().int().min(1).max(999999),
        name: z.string().min(1).max(100),
        carrier: z.string().min(1).max(100),
        enabled: z.boolean(),
        sort_order: z.number().int().min(0).max(2147483647),
      }),
    )
    .max(50),
});

export const shippingMeServiceWriteResultSchema = z.object({
  service_id: z.number().int().min(1).max(999999),
});

export type ShippingAdminEntity = z.infer<typeof shippingAdminEntitySchema>;
export type ShippingHybridAdminData = z.infer<typeof shippingHybridAdminDataSchema>;
export type ShippingHybridSettingsInput = z.infer<typeof shippingHybridSettingsInputSchema>;
