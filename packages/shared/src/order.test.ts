import { describe, expect, it } from 'vitest';
import {
  ORDER_CODE_ALPHABET,
  ORDER_CODE_REGEX,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  canTransition,
  generateOrderCode,
} from './order';

describe('transições de status', () => {
  it('permite o fluxo normal', () => {
    expect(canTransition('awaiting_shipping_quote', 'awaiting_payment')).toBe(true);
    expect(canTransition('awaiting_payment', 'paid')).toBe(true);
    expect(canTransition('paid', 'preparing')).toBe(true);
    expect(canTransition('preparing', 'shipped')).toBe(true);
    expect(canTransition('shipped', 'delivered')).toBe(true);
  });

  it('bloqueia pular etapas e voltar', () => {
    expect(canTransition('awaiting_payment', 'shipped')).toBe(false);
    expect(canTransition('awaiting_shipping_quote', 'paid')).toBe(false);
    expect(canTransition('paid', 'awaiting_payment')).toBe(false);
    expect(canTransition('delivered', 'shipped')).toBe(false);
  });

  it('pedido rural só é cobrado depois de sair de "aguardando frete"', () => {
    expect(ORDER_TRANSITIONS.awaiting_shipping_quote).not.toContain('paid');
  });

  it('estados finais não têm saída', () => {
    for (const status of ['expired', 'canceled', 'returned'] as const) {
      expect(ORDER_TRANSITIONS[status]).toEqual([]);
    }
  });

  it('toda transição aponta para um status conhecido', () => {
    for (const targets of Object.values(ORDER_TRANSITIONS)) {
      for (const target of targets) expect(ORDER_STATUSES).toContain(target);
    }
  });
});

describe('código do pedido', () => {
  it('gera códigos no formato SPK-XXXXX', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateOrderCode()).toMatch(ORDER_CODE_REGEX);
    }
  });

  it('não usa caracteres ambíguos', () => {
    expect(ORDER_CODE_ALPHABET).not.toMatch(/[01ILO]/);
    expect('SPK-7F3K2').toMatch(ORDER_CODE_REGEX);
    expect('SPK-0F3K2').not.toMatch(ORDER_CODE_REGEX);
    expect('SPK-7F3K').not.toMatch(ORDER_CODE_REGEX);
  });

  it('descarta bytes que causariam viés', () => {
    // 248 é o limite (256 - 256 % 31); bytes >= 248 devem ser ignorados.
    let call = 0;
    const fake = (a: Uint8Array) => {
      a.fill(call++ === 0 ? 255 : 0);
      return a;
    };
    expect(generateOrderCode(fake)).toBe('SPK-22222');
  });
});
