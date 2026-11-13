// Testes obrigatórios de docs/frete.md §10. Tabelas fictícias, só para teste (não são preços da cliente).
import { describe, expect, it } from 'vitest';
import { SHIPPING_MESSAGES, chargeableWeightG, normalizeCep, quoteShipping } from './quote';
import type { ShippingConfig, ShippingInput, ShippingRate, ShippingZone } from './types';

const zones: ShippingZone[] = [
  { id: 'z1', name: 'Mesmo estado', ufs: ['SE'], active: true },
  { id: 'z2', name: 'Nordeste próximo', ufs: ['AL', 'BA', 'PE', 'PB', 'RN'], active: true },
  { id: 'z3', name: 'Nordeste demais', ufs: ['CE', 'PI', 'MA'], active: true },
  {
    id: 'z4',
    name: 'Sudeste e Centro-Oeste',
    ufs: ['SP', 'RJ', 'ES', 'MG', 'DF', 'GO', 'MT', 'MS'],
    active: true,
  },
  { id: 'z5', name: 'Sul', ufs: ['PR', 'SC', 'RS'], active: true },
  { id: 'z6', name: 'Norte', ufs: ['PA', 'AP', 'AM', 'RR', 'AC', 'RO', 'TO'], active: false },
];

// Preço base por zona; cada faixa de peso soma R$ 5 e o Expresso soma R$ 10.
const BASE: Record<string, number> = { z1: 1500, z2: 2000, z3: 2500, z4: 3000, z5: 3500 };
const BANDS = [300, 1000, 2000, 5000];
const rates: ShippingRate[] = Object.entries(BASE).flatMap(([zoneId, base]) =>
  BANDS.flatMap((maxWeightG, i) => [
    {
      zoneId,
      service: 'economy' as const,
      maxWeightG,
      priceCents: base + i * 500,
      daysMin: 3,
      daysMax: 6,
    },
    {
      zoneId,
      service: 'express' as const,
      maxWeightG,
      priceCents: base + i * 500 + 1000,
      daysMin: 1,
      daysMax: 3,
    },
  ]),
);

function makeConfig(overrides: Partial<ShippingConfig> = {}): ShippingConfig {
  return {
    ufCepRanges: [
      { uf: 'SP', cepStart: '01000000', cepEnd: '19999999' },
      { uf: 'BA', cepStart: '40000000', cepEnd: '48999999' },
      { uf: 'SE', cepStart: '49000000', cepEnd: '49999999' },
      { uf: 'CE', cepStart: '60000000', cepEnd: '63999999' },
      { uf: 'PA', cepStart: '66000000', cepEnd: '68899999' },
      { uf: 'PR', cepStart: '80000000', cepEnd: '87999999' },
    ],
    zones,
    rates,
    localRules: [
      {
        label: 'Entrega local',
        cepStart: '49000000',
        cepEnd: '49099999',
        priceCents: 1200,
        daysMin: 1,
        daysMax: 2,
        active: true,
      },
    ],
    exceptions: [],
    packageSizes: {
      P: { weightG: 100, lengthCm: 16, widthCm: 11, heightCm: 4 },
      M: { weightG: 400, lengthCm: 30, widthCm: 22, heightCm: 5 },
      G: { weightG: 1000, lengthCm: 35, widthCm: 25, heightCm: 12 },
    },
    settings: {
      handlingDays: 2,
      freeShippingMinCents: 20000,
      maxItemsAutoShipping: 30,
      maxWeightAutoG: 5000,
      packageTareG: 0,
      cubicDivisor: null,
    },
    ...overrides,
  };
}

function input(overrides: Partial<ShippingInput> = {}): ShippingInput {
  return {
    cep: '01310-100', // SP → z4
    items: [{ weightG: 200, packageSize: 'P', qty: 1 }],
    addressType: 'urban',
    discountedSubtotalCents: 5000,
    ...overrides,
  };
}

function options(quote: ReturnType<typeof quoteShipping>) {
  if (quote.mode !== 'options') throw new Error(`esperava opções, veio ${quote.mode}`);
  return quote.options;
}

describe('CEP', () => {
  it.each(['123', '0131010', '013101000', 'abcdefgh', ''])('CEP inválido "%s"', (cep) => {
    expect(quoteShipping(input({ cep }), makeConfig())).toEqual({
      mode: 'invalid',
      message: SHIPPING_MESSAGES.invalidCep,
    });
  });

  it('CEP com formato válido mas fora das faixas de UF é inválido', () => {
    expect(quoteShipping(input({ cep: '99999-999' }), makeConfig()).mode).toBe('invalid');
  });

  it('normaliza máscara', () => {
    expect(normalizeCep('01.310-100')).toBe('01310100');
    expect(normalizeCep('0131-0100')).toBe('01310100');
  });
});

describe('zonas', () => {
  it.each([
    ['49200-000', 'z1', 1500], // SE fora da regra local
    ['40000-000', 'z2', 2000], // BA
    ['60000-000', 'z3', 2500], // CE
    ['01310-100', 'z4', 3000], // SP
    ['80000-000', 'z5', 3500], // PR
  ])('CEP %s cai na zona %s', (cep, _zone, price) => {
    const [economy, express] = options(quoteShipping(input({ cep }), makeConfig()));
    expect(economy).toMatchObject({ service: 'economy', label: 'Econômico', priceCents: price });
    expect(express).toMatchObject({
      service: 'express',
      label: 'Expresso',
      priceCents: price + 1000,
    });
  });

  it('zona inativa vira frete a combinar', () => {
    expect(quoteShipping(input({ cep: '66000-000' }), makeConfig())).toMatchObject({
      mode: 'consult',
      reason: 'no_zone',
    });
  });

  it('soma o tempo de preparo ao prazo', () => {
    const [economy] = options(quoteShipping(input(), makeConfig()));
    expect(economy).toMatchObject({ daysMin: 3 + 2, daysMax: 6 + 2 });
  });
});

describe('faixas de peso', () => {
  it('300 g fica na faixa até 300 g', () => {
    const quote = quoteShipping(
      input({ items: [{ weightG: 300, packageSize: 'P', qty: 1 }] }),
      makeConfig(),
    );
    expect(options(quote)[0]?.priceCents).toBe(3000);
  });

  it('301 g sobe para a faixa até 1 kg', () => {
    const quote = quoteShipping(
      input({ items: [{ weightG: 301, packageSize: 'P', qty: 1 }] }),
      makeConfig(),
    );
    expect(options(quote)[0]?.priceCents).toBe(3500);
  });

  it('usa o peso do tamanho quando o produto não tem peso, e multiplica pela quantidade', () => {
    const config = makeConfig();
    expect(
      chargeableWeightG({ items: [{ weightG: null, packageSize: 'M', qty: 2 }] }, config),
    ).toBe(800);
  });

  it('soma embalagem de presente e tara da caixa', () => {
    const config = makeConfig({ settings: { ...makeConfig().settings, packageTareG: 50 } });
    const weight = chargeableWeightG(
      {
        items: [{ weightG: 200, packageSize: 'P', qty: 1 }],
        giftWrap: { weightG: 60, packageSize: 'P' },
      },
      config,
    );
    expect(weight).toBe(310);
    const quote = quoteShipping(input({ giftWrap: { weightG: 60, packageSize: 'P' } }), config);
    expect(quote).toMatchObject({ mode: 'options', chargeableWeightG: 310 });
  });

  it('não calcula peso cubado antes de a fórmula ser confirmada', () => {
    const item = { weightG: 100, packageSize: 'G' as const, qty: 1 };
    expect(chargeableWeightG({ items: [item] }, makeConfig())).toBe(100);
    const withCubic = makeConfig({ settings: { ...makeConfig().settings, cubicDivisor: 6000 } });
    expect(() => chargeableWeightG({ items: [item] }, withCubic)).toThrow(/confirmação da fórmula/);
  });
});

describe('frete grátis', () => {
  it('no limite exato zera só o Econômico', () => {
    const [economy, express] = options(
      quoteShipping(input({ discountedSubtotalCents: 20000 }), makeConfig()),
    );
    expect(economy?.priceCents).toBe(0);
    expect(express?.priceCents).toBe(4000);
  });

  it('1 centavo abaixo do limite cobra normalmente', () => {
    const [economy] = options(
      quoteShipping(input({ discountedSubtotalCents: 19999 }), makeConfig()),
    );
    expect(economy?.priceCents).toBe(3000);
  });

  it('desligado quando o valor mínimo é nulo', () => {
    const config = makeConfig({
      settings: { ...makeConfig().settings, freeShippingMinCents: null },
    });
    const [economy] = options(quoteShipping(input({ discountedSubtotalCents: 999999 }), config));
    expect(economy?.priceCents).toBe(3000);
  });
});

describe('regra local × zona', () => {
  it('CEP da regra local devolve só a entrega local', () => {
    const quote = quoteShipping(input({ cep: '49010-000' }), makeConfig());
    expect(options(quote)).toEqual([
      { service: 'local', label: 'Entrega local', priceCents: 1200, daysMin: 3, daysMax: 4 },
    ]);
    expect(quote).toMatchObject({ chargeableWeightG: null });
  });

  it('CEP do mesmo estado fora da regra local usa a zona', () => {
    expect(options(quoteShipping(input({ cep: '49100-000' }), makeConfig()))[0]?.service).toBe(
      'economy',
    );
  });

  it('regra local inativa é ignorada', () => {
    const config = makeConfig({
      localRules: makeConfig().localRules.map((r) => ({ ...r, active: false })),
    });
    expect(options(quoteShipping(input({ cep: '49010-000' }), config))[0]?.service).toBe('economy');
  });

  it('a faixa mais específica vence', () => {
    const config = makeConfig({
      localRules: [
        ...makeConfig().localRules,
        {
          label: 'Bairro X',
          cepStart: '49010000',
          cepEnd: '49010999',
          priceCents: 1700,
          daysMin: 1,
          daysMax: 1,
          active: true,
        },
      ],
    });
    expect(options(quoteShipping(input({ cep: '49010-500' }), config))[0]).toMatchObject({
      label: 'Bairro X',
      priceCents: 1700,
    });
  });
});

describe('exceções de CEP', () => {
  const range = { cepStart: '01310000', cepEnd: '01310999' };

  it('block: sem entrega', () => {
    const config = makeConfig({ exceptions: [{ ...range, action: 'block', value: null }] });
    expect(quoteShipping(input(), config)).toEqual({
      mode: 'blocked',
      message: SHIPPING_MESSAGES.blocked,
    });
  });

  it('consult: frete a combinar', () => {
    const config = makeConfig({ exceptions: [{ ...range, action: 'consult', value: null }] });
    expect(quoteShipping(input(), config)).toMatchObject({
      mode: 'consult',
      reason: 'cep_exception',
    });
  });

  it('extra_days: soma dias em todas as opções', () => {
    const config = makeConfig({ exceptions: [{ ...range, action: 'extra_days', value: 4 }] });
    const [economy, express] = options(quoteShipping(input(), config));
    expect(economy).toMatchObject({ daysMin: 3 + 2 + 4, daysMax: 6 + 2 + 4 });
    expect(express).toMatchObject({ daysMin: 1 + 2 + 4, daysMax: 3 + 2 + 4 });
  });

  it('extra_cents: soma valor em todas as opções', () => {
    const config = makeConfig({ exceptions: [{ ...range, action: 'extra_cents', value: 700 }] });
    const [economy, express] = options(quoteShipping(input(), config));
    expect(economy?.priceCents).toBe(3700);
    expect(express?.priceCents).toBe(4700);
  });

  it('block vence consult e extras', () => {
    const config = makeConfig({
      exceptions: [
        { ...range, action: 'extra_cents', value: 700 },
        { ...range, action: 'consult', value: null },
        { ...range, action: 'block', value: null },
      ],
    });
    expect(quoteShipping(input(), config).mode).toBe('blocked');
  });

  it('exceção também vale para a entrega local', () => {
    const config = makeConfig({
      exceptions: [{ cepStart: '49010000', cepEnd: '49010999', action: 'extra_cents', value: 300 }],
    });
    expect(options(quoteShipping(input({ cep: '49010-000' }), config))[0]?.priceCents).toBe(1500);
  });

  it('frete grátis continua R$ 0,00 mesmo com acréscimo', () => {
    const config = makeConfig({ exceptions: [{ ...range, action: 'extra_cents', value: 700 }] });
    const [economy] = options(quoteShipping(input({ discountedSubtotalCents: 20000 }), config));
    expect(economy?.priceCents).toBe(0);
  });
});

describe('endereço rural e de difícil acesso', () => {
  it.each(['rural', 'hard_access'] as const)(
    '%s vira frete a combinar, mesmo em CEP local',
    (addressType) => {
      for (const cep of ['01310-100', '49010-000']) {
        expect(quoteShipping(input({ cep, addressType }), makeConfig())).toMatchObject({
          mode: 'consult',
          reason: 'address_type',
        });
      }
    },
  );
});

describe('pedido grande', () => {
  it('acima do peso máximo vira frete a combinar', () => {
    const quote = quoteShipping(
      input({ items: [{ weightG: 5001, packageSize: 'G', qty: 1 }] }),
      makeConfig(),
    );
    expect(quote).toMatchObject({ mode: 'consult', reason: 'too_heavy' });
  });

  it('no peso máximo exato ainda cota', () => {
    const quote = quoteShipping(
      input({ items: [{ weightG: 5000, packageSize: 'G', qty: 1 }] }),
      makeConfig(),
    );
    expect(options(quote)[0]?.priceCents).toBe(4500);
  });

  it('acima da quantidade máxima de itens vira frete a combinar', () => {
    const quote = quoteShipping(
      input({ items: [{ weightG: 10, packageSize: 'P', qty: 31 }] }),
      makeConfig(),
    );
    expect(quote).toMatchObject({ mode: 'consult', reason: 'too_many_items' });
  });

  it('sem tarifa que comporte o peso vira frete a combinar', () => {
    const config = makeConfig({ settings: { ...makeConfig().settings, maxWeightAutoG: null } });
    const quote = quoteShipping(
      input({ items: [{ weightG: 9000, packageSize: 'G', qty: 1 }] }),
      config,
    );
    expect(quote).toMatchObject({ mode: 'consult', reason: 'no_rate' });
  });
});

describe('entradas inválidas', () => {
  it('rejeita subtotal, peso ou quantidade inválidos', () => {
    expect(() => quoteShipping(input({ discountedSubtotalCents: -1 }), makeConfig())).toThrow(
      RangeError,
    );
    expect(() =>
      quoteShipping(input({ items: [{ weightG: 10.5, packageSize: 'P', qty: 1 }] }), makeConfig()),
    ).toThrow(RangeError);
    expect(() =>
      quoteShipping(input({ items: [{ weightG: 10, packageSize: 'P', qty: -1 }] }), makeConfig()),
    ).toThrow(RangeError);
  });
});
