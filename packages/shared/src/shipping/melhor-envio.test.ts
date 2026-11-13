import { describe, expect, it } from 'vitest';
import {
  melhorEnvioCalculateRequestSchema,
  melhorEnvioErrorItemSchema,
  melhorEnvioQuoteItemSchema,
  melhorEnvioQuotePriceCents,
  melhorEnvioQuoteRange,
  parseMelhorEnvioPriceToCents,
} from './melhor-envio';

describe('parseMelhorEnvioPriceToCents', () => {
  it.each([
    ['23.5', 2350],
    ['23.50', 2350],
    ['0.99', 99],
    ['23', 2300],
    ['1234.56', 123456],
  ])('aceita %s', (text, cents) => {
    expect(parseMelhorEnvioPriceToCents(text)).toBe(cents);
  });
  it.each(['23,50', '-1', '1e3', '', ' 23.50', '23.505', 'NaN', 'Infinity', '12345678.00'])(
    'recusa %j',
    (text) => {
      expect(parseMelhorEnvioPriceToCents(text)).toBeNull();
    },
  );
});

const quote = {
  id: 1,
  name: 'PAC',
  price: '20.00',
  delivery_range: { min: 3, max: 6 },
  company: { id: 1, name: 'Correios' },
};

describe('preço e prazo da cotação', () => {
  it('usa custom_price e custom_delivery_range quando existem', () => {
    const item = { ...quote, custom_price: '18.10', custom_delivery_range: { min: 2, max: 4 } };
    expect(melhorEnvioQuotePriceCents(item)).toBe(1810);
    expect(melhorEnvioQuoteRange(item)).toEqual({ min: 2, max: 4 });
  });
  it('usa price e delivery_range sem os campos custom', () => {
    expect(melhorEnvioQuotePriceCents(quote)).toBe(2000);
    expect(melhorEnvioQuoteRange(quote)).toEqual({ min: 3, max: 6 });
  });
  it('devolve null com min > max', () => {
    expect(melhorEnvioQuoteRange({ ...quote, delivery_range: { min: 7, max: 2 } })).toBeNull();
  });
});

describe('schemas do Melhor Envio', () => {
  it('aceita cotação e descarta chaves extras', () => {
    const r = melhorEnvioQuoteItemSchema.parse({ ...quote, currency: 'R$', extra: 1 });
    expect(r).not.toHaveProperty('extra');
    expect(r).not.toHaveProperty('currency');
  });
  it('aceita item de erro', () => {
    const item = { id: 3, name: 'Jadlog', error: 'Fora da área' };
    expect(melhorEnvioErrorItemSchema.safeParse(item).success).toBe(true);
  });
  it('recusa cotação sem company', () => {
    const rest: Partial<typeof quote> = { ...quote };
    delete rest.company;
    expect(melhorEnvioQuoteItemSchema.safeParse(rest).success).toBe(false);
  });
  it('recusa peso 0 e medida decimal', () => {
    const base = {
      from: { postal_code: '49000000' },
      to: { postal_code: '01000000' },
      services: '1,2',
    };
    const product = {
      id: 'p',
      width: 10,
      height: 10,
      length: 10,
      weight: 0.3,
      insurance_value: 10,
      quantity: 1,
    };
    const ok = (p: object) =>
      melhorEnvioCalculateRequestSchema.safeParse({ ...base, products: [p] }).success;
    expect(ok(product)).toBe(true);
    expect(ok({ ...product, weight: 0 })).toBe(false);
    expect(ok({ ...product, width: 10.5 })).toBe(false);
  });
});
