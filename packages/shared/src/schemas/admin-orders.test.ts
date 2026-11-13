import { describe, expect, it } from 'vitest';
import { ORDER_TRANSITIONS } from '../order';
import {
  ADMIN_STATUS_TARGETS,
  MAX_QUOTE_SHIPPING_CENTS,
  adminOrderListQuerySchema,
  adminOrderQuoteInputSchema,
  adminOrderStatusInputSchema,
  trackingCodeSchema,
} from './admin-orders';

describe('rastreio digitado pela lojista', () => {
  it('normaliza para maiúsculas e aceita vazio como "apagar"', () => {
    expect(trackingCodeSchema.parse(' ab123456789br ')).toBe('AB123456789BR');
    expect(trackingCodeSchema.parse('   ')).toBeNull();
  });
  it('recusa espaço, símbolo, link e tamanho fora de 4 a 40', () => {
    for (const bad of ['abc', 'AB 123456', 'AB123;DROP', 'https://x.test/a', 'A'.repeat(41)]) {
      expect(trackingCodeSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('status escolhidos pela lojista', () => {
  it('são sempre destinos válidos da máquina de transições', () => {
    const reachable = new Set(Object.values(ORDER_TRANSITIONS).flat());
    for (const status of ADMIN_STATUS_TARGETS) expect(reachable.has(status)).toBe(true);
  });
  it('não aceita pago, expirado nem aguardando pagamento', () => {
    for (const status of ['paid', 'expired', 'awaiting_payment', 'awaiting_shipping_quote']) {
      expect(adminOrderStatusInputSchema.safeParse({ status }).success).toBe(false);
    }
    expect(adminOrderStatusInputSchema.parse({ status: 'shipped', trackingCode: 'abcd' })).toEqual({
      status: 'shipped',
      trackingCode: 'ABCD',
    });
  });
});

describe('frete a combinar informado pela lojista', () => {
  const ok = { shippingCents: 4000, daysMin: 5, daysMax: 9 };
  it('aceita centavos inteiros, inclusive frete zero', () => {
    expect(adminOrderQuoteInputSchema.safeParse(ok).success).toBe(true);
    expect(adminOrderQuoteInputSchema.safeParse({ ...ok, shippingCents: 0 }).success).toBe(true);
  });
  it('recusa decimal, negativo, acima do teto e prazo invertido', () => {
    for (const bad of [
      { ...ok, shippingCents: 40.5 },
      { ...ok, shippingCents: -1 },
      { ...ok, shippingCents: MAX_QUOTE_SHIPPING_CENTS + 1 },
      { ...ok, daysMin: 9, daysMax: 5 },
      { ...ok, daysMax: 61 },
      { ...ok, shippingCents: '4000' },
    ]) {
      expect(adminOrderQuoteInputSchema.safeParse(bad).success).toBe(false);
    }
  });
  it('recusa quebra de linha no serviço', () => {
    expect(adminOrderQuoteInputSchema.safeParse({ ...ok, label: 'a\nb' }).success).toBe(false);
  });
});

describe('filtros da lista', () => {
  it('busca por código em maiúsculas e página 1 por padrão', () => {
    expect(adminOrderListQuerySchema.parse({ q: ' spk-7f' })).toEqual({ q: 'SPK-7F', page: 1 });
  });
  it('recusa caracteres que não existem em código (não vão para o filtro do banco)', () => {
    for (const q of ['spk,or(', 'a%b', "x'y", 'a b', 'SPK-7F3K2ZZZZZ']) {
      expect(adminOrderListQuerySchema.safeParse({ q }).success).toBe(false);
    }
    expect(adminOrderListQuerySchema.safeParse({ status: 'qualquer' }).success).toBe(false);
    for (const from of ['12/11/2026', '2026-13-45', '2026-02-31']) {
      expect(adminOrderListQuerySchema.safeParse({ from }).success).toBe(false);
    }
    expect(adminOrderListQuerySchema.safeParse({ from: '2026-11-12' }).success).toBe(true);
  });
});
