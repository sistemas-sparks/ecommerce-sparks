import { describe, expect, it } from 'vitest';
import { cepSchema, optionalEmailSchema, whatsappSchema } from './common';
import { shippingServiceIdSchema } from './shipping-hybrid';
import {
  checkoutInputSchema,
  shippingServiceSchema,
  couponCodeSchema,
  giftMessageSchema,
  orderLookupInputSchema,
  shippingQuoteInputSchema,
} from './order-input';

const PRODUCT_A = '7b0b4c39-2d0e-4c55-9a43-5d1f8f1f6a01';
const PRODUCT_B = '1c9e2f6a-8b1d-4c3e-9f2a-0d6b7e8f9a02';

const validCheckout = {
  items: [{ productId: PRODUCT_A, qty: 2 }],
  customer: { name: 'Maria Silva', whatsapp: '(79) 99999-1234', email: '' },
  address: {
    cep: '49000-000',
    street: 'Rua Exemplo',
    number: '10',
    district: 'Centro',
    city: 'Cidade Exemplo',
    uf: 'SE',
    addressType: 'urban',
  },
  turnstileToken: 'token',
};

describe('cepSchema', () => {
  it.each(['49000-000', '49000000', '49.000-000', ' 49000-000 '])('aceita "%s"', (v) => {
    expect(cepSchema.parse(v)).toBe('49000000');
  });

  it.each(['4900-000', '490000000', 'abcde-fgh', ''])('rejeita "%s"', (v) => {
    expect(cepSchema.safeParse(v).success).toBe(false);
  });
});

describe('whatsappSchema', () => {
  it.each([
    ['(79) 99999-1234', '79999991234'],
    ['79999991234', '79999991234'],
    ['+55 79 99999-1234', '79999991234'],
    ['(79) 3211-1234', '7932111234'],
    ['55 99123-4567', '55991234567'], // DDD 55 (RS) não é confundido com o +55
  ])('normaliza "%s"', (input, expected) => {
    expect(whatsappSchema.parse(input)).toBe(expected);
  });

  it.each(['12345', '(79) 89999-1234', '(00) 99999-1234', ''])('rejeita "%s"', (v) => {
    expect(whatsappSchema.safeParse(v).success).toBe(false);
  });
});

describe('optionalEmailSchema', () => {
  it('string vazia vira undefined', () => {
    expect(optionalEmailSchema.parse('')).toBeUndefined();
    expect(optionalEmailSchema.parse(undefined)).toBeUndefined();
  });

  it('normaliza e valida', () => {
    expect(optionalEmailSchema.parse(' Ana@Exemplo.com ')).toBe('ana@exemplo.com');
    expect(optionalEmailSchema.safeParse('nao-e-email').success).toBe(false);
  });
});

describe('couponCodeSchema', () => {
  it('converte para maiúsculas', () => {
    expect(couponCodeSchema.parse(' volta10 ')).toBe('VOLTA10');
  });

  it.each(['AB', 'A'.repeat(21), 'COM ESPACO', 'COM-HIFEN'])('rejeita "%s"', (v) => {
    expect(couponCodeSchema.safeParse(v).success).toBe(false);
  });
});

describe('giftMessageSchema', () => {
  it('aceita exatamente 140 caracteres', () => {
    expect(giftMessageSchema.safeParse('a'.repeat(140)).success).toBe(true);
  });

  it('rejeita 141 caracteres', () => {
    expect(giftMessageSchema.safeParse('a'.repeat(141)).success).toBe(false);
  });

  it('conta emoji como 1 caractere', () => {
    expect(giftMessageSchema.safeParse('💖'.repeat(140)).success).toBe(true);
  });

  it('permite quebra de linha e normaliza \\r\\n', () => {
    expect(giftMessageSchema.parse('Feliz\r\naniversário!')).toBe('Feliz\naniversário!');
  });

  it('rejeita caracteres de controle', () => {
    expect(giftMessageSchema.safeParse('oi\u0000').success).toBe(false);
  });
});

describe('checkoutInputSchema', () => {
  it('aceita um checkout válido e normaliza os campos', () => {
    const parsed = checkoutInputSchema.parse(validCheckout);
    expect(parsed.customer.whatsapp).toBe('79999991234');
    expect(parsed.customer.email).toBeUndefined();
    expect(parsed.address.cep).toBe('49000000');
  });

  it('descarta preço, frete e total enviados pelo navegador (R3.3)', () => {
    const parsed = checkoutInputSchema.parse({
      ...validCheckout,
      totalCents: 1,
      shippingCents: 0,
      items: [{ productId: PRODUCT_A, qty: 1, unitPriceCents: 1 }],
    });
    expect(parsed).not.toHaveProperty('totalCents');
    expect(parsed).not.toHaveProperty('shippingCents');
    expect(parsed.items[0]).not.toHaveProperty('unitPriceCents');
  });

  it('rejeita quantidade 0, fracionada ou acima de 99', () => {
    for (const qty of [0, 1.5, 100]) {
      const r = checkoutInputSchema.safeParse({
        ...validCheckout,
        items: [{ productId: PRODUCT_A, qty }],
      });
      expect(r.success).toBe(false);
    }
  });

  it('rejeita sacola vazia e produto repetido', () => {
    expect(checkoutInputSchema.safeParse({ ...validCheckout, items: [] }).success).toBe(false);
    expect(
      checkoutInputSchema.safeParse({
        ...validCheckout,
        items: [
          { productId: PRODUCT_A, qty: 1 },
          { productId: PRODUCT_A, qty: 1 },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejeita id de produto inválido e UF inexistente', () => {
    expect(
      checkoutInputSchema.safeParse({ ...validCheckout, items: [{ productId: '1', qty: 1 }] })
        .success,
    ).toBe(false);
    expect(
      checkoutInputSchema.safeParse({
        ...validCheckout,
        address: { ...validCheckout.address, uf: 'XX' },
      }).success,
    ).toBe(false);
  });

  it('exige shippingService e shippingQuotedCents juntos', () => {
    const own = 'own:3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b';
    expect(
      checkoutInputSchema.safeParse({
        ...validCheckout,
        shippingService: own,
        shippingQuotedCents: 800,
      }).success,
    ).toBe(true);
    expect(
      checkoutInputSchema.safeParse({ ...validCheckout, shippingService: 'me:2' }).success,
    ).toBe(false);
    const only = checkoutInputSchema.safeParse({ ...validCheckout, shippingQuotedCents: 800 });
    expect(only.success).toBe(false);
    expect(only.error?.issues[0]?.message).toBe('Escolha a opção de entrega de novo.');
    expect(
      checkoutInputSchema.safeParse({
        ...validCheckout,
        shippingService: 'economy',
        shippingQuotedCents: 800,
      }).success,
    ).toBe(false);
    expect(
      checkoutInputSchema.safeParse({
        ...validCheckout,
        shippingService: 'me:2',
        shippingQuotedCents: -1,
      }).success,
    ).toBe(false);
  });

  it('exige o token do Turnstile', () => {
    expect(checkoutInputSchema.safeParse({ ...validCheckout, turnstileToken: '' }).success).toBe(
      false,
    );
  });
});

describe('shippingQuoteInputSchema', () => {
  it('usa endereço urbano por padrão', () => {
    const parsed = shippingQuoteInputSchema.parse({
      cep: '49000-000',
      items: [
        { productId: PRODUCT_A, qty: 1 },
        { productId: PRODUCT_B, qty: 3 },
      ],
    });
    expect(parsed.addressType).toBe('urban');
  });
});

describe('orderLookupInputSchema', () => {
  it('normaliza o código do pedido', () => {
    const parsed = orderLookupInputSchema.parse({
      code: ' spk-7f3k2 ',
      whatsapp: '79999991234',
      turnstileToken: 't',
    });
    expect(parsed.code).toBe('SPK-7F3K2');
  });

  it('rejeita código fora do formato', () => {
    expect(
      orderLookupInputSchema.safeParse({
        code: 'ABC',
        whatsapp: '79999991234',
        turnstileToken: 't',
      }).success,
    ).toBe(false);
  });
});

describe('shippingServiceSchema', () => {
  it('aceita e recusa os mesmos valores que shippingServiceIdSchema', () => {
    const values = [
      'own:3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b',
      'own:abc',
      'me:1',
      'me:999999',
      'me:0',
      'me:1000000',
      'economy',
      'local',
      '',
    ];
    for (const v of values) {
      expect(shippingServiceSchema.safeParse(v).success, v).toBe(
        shippingServiceIdSchema.safeParse(v).success,
      );
    }
  });
});
