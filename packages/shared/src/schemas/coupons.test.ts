import { describe, expect, it } from 'vitest';
import {
  couponAdminCreateSchema,
  couponAdminUpdateSchema,
  couponValidateRequestSchema,
  getCouponState,
} from './coupons';

const base = {
  code: 'PAPEL10',
  type: 'percent' as const,
  value: 10,
  minOrderCents: null,
  maxUses: null,
  startsAt: null,
  endsAt: null,
  active: true,
};
const fields = {
  type: base.type,
  value: base.value,
  minOrderCents: null,
  maxUses: null,
  startsAt: null,
  endsAt: null,
  active: true,
};

describe('couponAdminCreateSchema', () => {
  it('aceita cupom válido', () => {
    expect(couponAdminCreateSchema.safeParse(base).success).toBe(true);
    expect(
      couponAdminCreateSchema.safeParse({
        ...base,
        type: 'fixed',
        value: 500,
        minOrderCents: 0,
        maxUses: 5,
        startsAt: '2026-10-01T00:00:00Z',
        endsAt: '2026-11-01T00:00:00-03:00',
      }).success,
    ).toBe(true);
  });
  it('recusa percentual 0 e 101 e fixo 0', () => {
    expect(couponAdminCreateSchema.safeParse({ ...base, value: 0 }).success).toBe(false);
    const r = couponAdminCreateSchema.safeParse({ ...base, value: 101 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('Percentual deve ficar entre 1 e 100.');
    expect(couponAdminCreateSchema.safeParse({ ...base, type: 'fixed', value: 0 }).success).toBe(
      false,
    );
  });
  it('normaliza código e recusa símbolo', () => {
    const r = couponAdminCreateSchema.parse({ ...base, code: 'papel10' });
    expect(r.code).toBe('PAPEL10');
    expect(couponAdminCreateSchema.safeParse({ ...base, code: 'PAPEL-10' }).success).toBe(false);
  });
  it('recusa fim <= início', () => {
    const s = '2026-10-01T00:00:00Z';
    expect(couponAdminCreateSchema.safeParse({ ...base, startsAt: s, endsAt: s }).success).toBe(
      false,
    );
    expect(
      couponAdminCreateSchema.safeParse({ ...base, startsAt: s, endsAt: '2026-09-30T00:00:00Z' })
        .success,
    ).toBe(false);
  });
  it('recusa campo extra, data sem offset, mínimo negativo e maxUses 0', () => {
    expect(couponAdminCreateSchema.safeParse({ ...base, usedCount: 3 }).success).toBe(false);
    expect(
      couponAdminCreateSchema.safeParse({ ...base, startsAt: '2026-10-01T00:00:00' }).success,
    ).toBe(false);
    expect(couponAdminCreateSchema.safeParse({ ...base, minOrderCents: -1 }).success).toBe(false);
    expect(couponAdminCreateSchema.safeParse({ ...base, maxUses: 0 }).success).toBe(false);
  });
});

describe('couponAdminUpdateSchema', () => {
  it('aceita sem code e recusa com code', () => {
    expect(couponAdminUpdateSchema.safeParse(fields).success).toBe(true);
    expect(couponAdminUpdateSchema.safeParse({ ...fields, code: 'ABC' }).success).toBe(false);
  });
});

describe('getCouponState', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const iso = now.toISOString();
  const c = { active: true, startsAt: null, endsAt: null, maxUses: null, usedCount: 0 };
  it('cada estado', () => {
    expect(getCouponState(c, now)).toBe('active');
    expect(getCouponState({ ...c, active: false }, now)).toBe('inactive');
    expect(getCouponState({ ...c, startsAt: '2026-10-21T00:00:00Z' }, now)).toBe('scheduled');
    expect(getCouponState({ ...c, endsAt: '2026-10-19T00:00:00Z' }, now)).toBe('expired');
    expect(getCouponState({ ...c, maxUses: 2, usedCount: 3 }, now)).toBe('exhausted');
  });
  it('bordas', () => {
    expect(getCouponState({ ...c, startsAt: iso }, now)).toBe('active');
    expect(getCouponState({ ...c, endsAt: iso }, now)).toBe('expired');
    expect(getCouponState({ ...c, maxUses: 2, usedCount: 2 }, now)).toBe('exhausted');
    expect(getCouponState({ ...c, maxUses: null, usedCount: 999999 }, now)).toBe('active');
  });
  it('inactive vence os outros', () => {
    expect(
      getCouponState(
        {
          active: false,
          startsAt: '2026-12-01T00:00:00Z',
          endsAt: '2026-01-01T00:00:00Z',
          maxUses: 1,
          usedCount: 1,
        },
        now,
      ),
    ).toBe('inactive');
  });
});

describe('couponValidateRequestSchema', () => {
  const ok = {
    couponCode: 'abc',
    items: [{ productId: '3f2b8c1e-5a4d-4e6f-8a1b-2c3d4e5f6a7b', qty: 1 }],
    turnstileToken: 'token-valido',
  };
  it('recusa itens vazios e cupom inválido', () => {
    expect(couponValidateRequestSchema.safeParse({ ...ok, items: [] }).success).toBe(false);
    expect(couponValidateRequestSchema.safeParse({ ...ok, couponCode: '!!' }).success).toBe(false);
  });
  it('aceita válido', () => {
    expect(couponValidateRequestSchema.safeParse(ok).success).toBe(true);
  });
});
