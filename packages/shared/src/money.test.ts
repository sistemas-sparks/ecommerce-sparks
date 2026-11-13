import { describe, expect, it } from 'vitest';
import {
  assertCents,
  formatBRL,
  isCents,
  multiplyCents,
  parseBRLToCents,
  percentOf,
  sumCents,
} from './money';

// O Intl usa espaço não separável entre "R$" e o número.
const nbsp = (s: string) => s.replace(/\s/g, ' ');

describe('isCents / assertCents', () => {
  it('aceita inteiros >= 0', () => {
    expect(isCents(0)).toBe(true);
    expect(isCents(1250)).toBe(true);
    expect(isCents(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('rejeita negativos, frações, NaN, infinitos e não números', () => {
    for (const v of [-1, 12.5, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '100', null]) {
      expect(isCents(v)).toBe(false);
    }
    expect(() => assertCents(12.5)).toThrow(RangeError);
  });
});

describe('sumCents / multiplyCents', () => {
  it('soma centavos sem erro de float', () => {
    expect(sumCents([10, 20])).toBe(30);
    expect(sumCents([])).toBe(0);
  });

  it('multiplica preço por quantidade', () => {
    expect(multiplyCents(1990, 3)).toBe(5970);
    expect(multiplyCents(1990, 0)).toBe(0);
  });

  it('rejeita quantidade fracionada ou negativa', () => {
    expect(() => multiplyCents(100, 1.5)).toThrow(RangeError);
    expect(() => multiplyCents(100, -1)).toThrow(RangeError);
  });

  it('rejeita estouro de inteiro seguro', () => {
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
  });
});

describe('percentOf (arredonda sempre para baixo)', () => {
  it('calcula porcentagens exatas', () => {
    expect(percentOf(10000, 10)).toBe(1000);
    expect(percentOf(10000, 100)).toBe(10000);
    expect(percentOf(10000, 0)).toBe(0);
  });

  it('arredonda frações de centavo para baixo', () => {
    expect(percentOf(99, 10)).toBe(9); // 9,9
    expect(percentOf(1999, 15)).toBe(299); // 299,85
    expect(percentOf(1, 50)).toBe(0); // 0,5
  });

  it('rejeita porcentagem fora de 0 a 100 ou fracionada', () => {
    expect(() => percentOf(100, 101)).toThrow(RangeError);
    expect(() => percentOf(100, -1)).toThrow(RangeError);
    expect(() => percentOf(100, 12.5)).toThrow(RangeError);
  });
});

describe('formatBRL', () => {
  it('formata em reais no padrão brasileiro', () => {
    expect(nbsp(formatBRL(1250))).toBe('R$ 12,50');
    expect(nbsp(formatBRL(0))).toBe('R$ 0,00');
    expect(nbsp(formatBRL(123456))).toBe('R$ 1.234,56');
    expect(nbsp(formatBRL(5))).toBe('R$ 0,05');
  });
});

describe('parseBRLToCents', () => {
  it.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12,50', 1250],
    ['0,05', 5],
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['R$ 12,50', 1250],
    ['  7,00 ', 700],
  ])('"%s" → %i', (input, expected) => {
    expect(parseBRLToCents(input)).toBe(expected);
  });

  it.each(['', 'abc', '-5', '12,505', '12.50', '1.23,45', '12,', ',50', '1,2,3'])(
    'rejeita "%s"',
    (input) => {
      expect(parseBRLToCents(input)).toBeNull();
    },
  );
});
