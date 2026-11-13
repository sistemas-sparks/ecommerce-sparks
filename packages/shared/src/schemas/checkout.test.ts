import { describe, expect, it } from 'vitest';
import {
  checkoutProductRowsSchema,
  createOrderResultSchema,
  markOrderPaidResultSchema,
  mpPaymentSchema,
  mpPreferenceResponseSchema,
} from './checkout';

const ORDER_ID = '99999999-9999-4999-8999-999999999999';

describe('createOrderResultSchema', () => {
  const valid = {
    order_id: ORDER_ID,
    code: 'SPK-7F3K2',
    status: 'awaiting_payment',
    subtotal_cents: 7480,
    discount_cents: 0,
    shipping_cents: 1500,
    gift_wrap_cents: 0,
    total_cents: 8980,
    reserved_until: '2026-10-07T12:30:00+00:00',
  };

  it('aceita o retorno do banco', () => {
    expect(createOrderResultSchema.parse(valid)).toEqual(valid);
  });

  it('recusa status inesperado, centavos fracionados e código fora do padrão', () => {
    expect(createOrderResultSchema.safeParse({ ...valid, status: 'paid' }).success).toBe(false);
    expect(createOrderResultSchema.safeParse({ ...valid, total_cents: 89.8 }).success).toBe(false);
    expect(createOrderResultSchema.safeParse({ ...valid, code: 'SPK-0000' }).success).toBe(false);
  });
});

describe('mpPreferenceResponseSchema', () => {
  it('exige link de pagamento HTTPS', () => {
    expect(
      mpPreferenceResponseSchema.safeParse({ id: 'p', init_point: 'https://mercadopago.com.br/x' })
        .success,
    ).toBe(true);
    expect(
      mpPreferenceResponseSchema.safeParse({ id: 'p', init_point: 'http://mercadopago.com.br/x' })
        .success,
    ).toBe(false);
    expect(
      mpPreferenceResponseSchema.safeParse({ id: 'p', init_point: 'javascript:alert(1)' }).success,
    ).toBe(false);
  });
});

describe('mpPaymentSchema', () => {
  it('normaliza o id para texto', () => {
    const parsed = mpPaymentSchema.parse({
      id: 123,
      status: 'approved',
      transaction_amount: 10.5,
      currency_id: 'BRL',
      external_reference: ORDER_ID,
    });
    expect(parsed.id).toBe('123');
  });

  it('recusa valor negativo ou não numérico', () => {
    const base = { id: 1, status: 'approved', currency_id: 'BRL' };
    expect(mpPaymentSchema.safeParse({ ...base, transaction_amount: -1 }).success).toBe(false);
    expect(mpPaymentSchema.safeParse({ ...base, transaction_amount: '10' }).success).toBe(false);
  });
});

describe('markOrderPaidResultSchema', () => {
  it('só aceita os resultados conhecidos', () => {
    expect(markOrderPaidResultSchema.safeParse('paid').success).toBe(true);
    expect(markOrderPaidResultSchema.safeParse('ok').success).toBe(false);
  });
});

describe('checkoutProductRowsSchema', () => {
  it('exige o nome além dos campos do frete', () => {
    const row = {
      id: ORDER_ID,
      price_cents: 100,
      stock: 1,
      active: true,
      kind: 'regular',
      deleted_at: null,
      weight_g: null,
      package_size: 'P',
      length_cm: null,
      width_cm: null,
      height_cm: null,
    };
    expect(checkoutProductRowsSchema.safeParse([row]).success).toBe(false);
    expect(checkoutProductRowsSchema.safeParse([{ ...row, name: 'Caneta' }]).success).toBe(true);
  });
});
