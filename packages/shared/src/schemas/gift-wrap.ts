import { z } from 'zod';
import { uuidSchema } from './common';
import { catalogImageSchema } from './catalog';

/** Corpo do PATCH /admin/settings: só o interruptor, sem campos extras. */
export const giftWrapSettingsInputSchema = z.strictObject({ gift_wrap_enabled: z.boolean() });

/** Resposta do GET /admin/settings. */
export const giftWrapAdminSettingsSchema = z.strictObject({
  gift_wrap_enabled: z.boolean(),
  gift_wrap_models: z.strictObject({
    total: z.number().int().min(0),
    available: z.number().int().min(0),
  }),
});

export const GIFT_WRAP_MODELS_MAX = 20;

/** Modelo de embalagem visível na sacola (nunca custo nem estoque). */
export const giftWrapModelSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(10000),
  priceCents: z.number().int().min(0).max(2147483647),
  photo: catalogImageSchema.nullable(),
});

/** Resposta do GET /gift-wrap. */
export const giftWrapPublicSchema = z.strictObject({
  enabled: z.boolean(),
  models: z.array(giftWrapModelSchema).max(GIFT_WRAP_MODELS_MAX),
});

export type GiftWrapSettingsInput = z.infer<typeof giftWrapSettingsInputSchema>;
export type GiftWrapAdminSettings = z.infer<typeof giftWrapAdminSettingsSchema>;
export type GiftWrapModel = z.infer<typeof giftWrapModelSchema>;
export type GiftWrapPublic = z.infer<typeof giftWrapPublicSchema>;
