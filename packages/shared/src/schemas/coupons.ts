// Cupons: contrato do painel da lojista e da validação pública (R3.5, R4.1).
// Dinheiro em centavos inteiros. O desconto nunca inclui frete nem embalagem.
import { z } from 'zod';
import { cartItemsSchema, couponCodeSchema } from './order-input';
import { turnstileTokenSchema, uuidSchema } from './common';

const INT_MAX = 2147483647;
const timestamp = z.iso.datetime({ offset: true });

export const COUPON_TYPES = ['percent', 'fixed'] as const;
export const couponTypeSchema = z.enum(COUPON_TYPES, { error: 'Tipo de cupom inválido.' });
export type CouponType = z.infer<typeof couponTypeSchema>;

const couponFieldsBase = z.object({
  type: couponTypeSchema,
  value: z
    .number({ error: 'Informe o valor do cupom.' })
    .int({ error: 'O valor deve ser um número inteiro.' })
    .min(1, { error: 'O valor deve ser maior que zero.' })
    .max(INT_MAX, { error: 'Valor alto demais.' }),
  minOrderCents: z
    .number({ error: 'Pedido mínimo inválido.' })
    .int({ error: 'Pedido mínimo inválido.' })
    .min(0, { error: 'O pedido mínimo não pode ser negativo.' })
    .max(INT_MAX, { error: 'Pedido mínimo alto demais.' })
    .nullable(),
  maxUses: z
    .number({ error: 'Limite de usos inválido.' })
    .int({ error: 'Limite de usos inválido.' })
    .min(1, { error: 'O limite de usos deve ser pelo menos 1.' })
    .max(1000000, { error: 'Limite de usos alto demais.' })
    .nullable(),
  startsAt: timestamp.nullable(),
  endsAt: timestamp.nullable(),
  active: z.boolean({ error: 'Informe se o cupom está ativo.' }),
});

type CouponFields = z.infer<typeof couponFieldsBase>;

function refineCoupon(v: CouponFields, ctx: z.RefinementCtx): void {
  if (v.type === 'percent' && v.value > 100) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'Percentual deve ficar entre 1 e 100.',
    });
  }
  if (v.startsAt !== null && v.endsAt !== null && Date.parse(v.endsAt) <= Date.parse(v.startsAt)) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'O fim da validade deve ser depois do início.',
    });
  }
}

export const couponAdminFieldsSchema = couponFieldsBase.superRefine(refineCoupon);

export const couponAdminCreateSchema = couponFieldsBase
  .extend({ code: couponCodeSchema })
  .strict()
  .superRefine(refineCoupon);
export type CouponAdminCreate = z.infer<typeof couponAdminCreateSchema>;

/** O código não muda depois de criado: corpo completo, sem `code`. */
export const couponAdminUpdateSchema = couponFieldsBase.strict().superRefine(refineCoupon);
export type CouponAdminUpdate = z.infer<typeof couponAdminUpdateSchema>;

export const couponAdminRowSchema = z.object({
  id: uuidSchema,
  code: couponCodeSchema,
  type: couponTypeSchema,
  value: z.number().int(),
  minOrderCents: z.number().int().nullable(),
  maxUses: z.number().int().nullable(),
  usedCount: z.number().int().min(0),
  startsAt: timestamp.nullable(),
  endsAt: timestamp.nullable(),
  active: z.boolean(),
  createdAt: timestamp,
});
export type CouponAdminRow = z.infer<typeof couponAdminRowSchema>;

export const couponAdminListSchema = z.object({ coupons: z.array(couponAdminRowSchema) });
export type CouponAdminList = z.infer<typeof couponAdminListSchema>;

export type CouponState = 'active' | 'inactive' | 'scheduled' | 'expired' | 'exhausted';

export const couponStateLabel: Record<CouponState, string> = {
  active: 'Ativo',
  inactive: 'Desativado',
  scheduled: 'Agendado',
  expired: 'Expirado',
  exhausted: 'Esgotado',
};

export interface CouponStateInput {
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  maxUses: number | null;
  usedCount: number;
}

/** Mesma regra do SQL create_order: início inclusivo, fim exclusivo. */
export function getCouponState(coupon: CouponStateInput, now: Date = new Date()): CouponState {
  const t = now.getTime();
  if (!coupon.active) return 'inactive';
  if (coupon.startsAt !== null && Date.parse(coupon.startsAt) > t) return 'scheduled';
  if (coupon.endsAt !== null && Date.parse(coupon.endsAt) <= t) return 'expired';
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) return 'exhausted';
  return 'active';
}

export const couponValidateRequestSchema = z
  .object({
    couponCode: couponCodeSchema,
    items: cartItemsSchema,
    turnstileToken: turnstileTokenSchema,
  })
  .strict();
export type CouponValidateRequest = z.infer<typeof couponValidateRequestSchema>;

const cents = z.number().int().min(0);
export const couponValidateResponseSchema = z.object({
  couponCode: couponCodeSchema,
  type: couponTypeSchema,
  value: cents,
  subtotalCents: cents,
  discountCents: cents,
  discountedSubtotalCents: cents,
});
export type CouponValidateResponse = z.infer<typeof couponValidateResponseSchema>;
