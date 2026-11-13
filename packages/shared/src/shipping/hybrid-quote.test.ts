// Testes do motor híbrido (docs/frete.md §8). Valores fictícios, só para teste.
import { describe, expect, it } from 'vitest';
import {
  HYBRID_SHIPPING_MESSAGES,
  buildMelhorEnvioRequest,
  finishHybridQuote,
  prepareHybridQuote,
  totalWeightG,
  type PreparedHybridQuote,
} from './hybrid-quote';
import { hybridShippingQuoteResponseSchema } from '../schemas/shipping-hybrid';
import type {
  HybridShippingConfig,
  HybridShippingInput,
  HybridShippingQuote,
  MelhorEnvioResult,
} from './hybrid-types';

const config: HybridShippingConfig = {
  exceptions: [],
  packageSizes: {
    P: { weightG: 100, lengthCm: 16, widthCm: 11, heightCm: 2 },
    M: { weightG: 300, lengthCm: 25, widthCm: 20, heightCm: 8 },
    G: { weightG: 800, lengthCm: 35, widthCm: 30, heightCm: 15 },
  },
  settings: {
    handlingDays: 1,
    freeShippingMinCents: null,
    maxItemsAutoShipping: null,
    maxWeightAutoG: null,
    packageTareG: 0,
    cubicDivisor: null,
  },
  ownTypes: [
    { id: 'fast', name: 'Entrega rápida', active: true, sortOrder: 1 },
    { id: 'local', name: 'Entrega local', active: true, sortOrder: 2 },
  ],
  ownAreas: [
    {
      id: 'a1',
      typeId: 'fast',
      label: 'Região ampla',
      cepStart: '49000000',
      cepEnd: '49999999',
      priceCents: 2000,
      daysMin: 1,
      daysMax: 2,
      active: true,
    },
    {
      id: 'a2',
      typeId: 'fast',
      label: 'Centro',
      cepStart: '49010000',
      cepEnd: '49019999',
      priceCents: 1000,
      daysMin: 0,
      daysMax: 1,
      active: true,
    },
    {
      id: 'a3',
      typeId: 'local',
      label: '',
      cepStart: '49010000',
      cepEnd: '49010999',
      priceCents: 500,
      daysMin: 0,
      daysMax: 0,
      active: true,
    },
  ],
  melhorEnvio: { originCep: '49000000', enabledServiceIds: [1, 2], marginCents: 150 },
};

const input: HybridShippingInput = {
  cep: '49010-100',
  items: [{ id: 'p1', qty: 1, packageSize: 'P', weightG: null, unitPriceCents: 1990 }],
  addressType: 'urban',
  discountedSubtotalCents: 1990,
};

const OUTSIDE = '01310100'; // fora das áreas próprias

const meItem = (id: number, price: string, min = 2, max = 4, extra: object = {}): unknown => ({
  id,
  name: id === 1 ? 'PAC' : 'SEDEX',
  price,
  delivery_range: { min, max },
  company: { id: 1, name: 'Correios' },
  ...extra,
});

function run(
  inp: HybridShippingInput,
  me: MelhorEnvioResult | null,
  cfg: HybridShippingConfig = config,
): HybridShippingQuote {
  const prepared: PreparedHybridQuote = prepareHybridQuote(inp, cfg);
  if (prepared.mode === 'final') return prepared.quote;
  return finishHybridQuote(prepared, me, inp, cfg);
}

const okMe = (...items: unknown[]): MelhorEnvioResult => ({ ok: true, items });

function options(q: HybridShippingQuote) {
  if (q.mode !== 'options') throw new Error(`esperava options, veio ${q.mode}`);
  return q.options;
}

const withSettings = (s: Partial<HybridShippingConfig['settings']>): HybridShippingConfig => ({
  ...config,
  settings: { ...config.settings, ...s },
});

describe('prepareHybridQuote: bloqueios e consulta', () => {
  it('CEP inválido', () => {
    expect(run({ ...input, cep: '123' }, null)).toEqual({
      mode: 'invalid',
      message: HYBRID_SHIPPING_MESSAGES.invalidCep,
    });
  });

  it('exceção block', () => {
    const cfg = {
      ...config,
      exceptions: [
        { cepStart: '49000000', cepEnd: '49999999', action: 'block' as const, value: null },
      ],
    };
    expect(run(input, null, cfg).mode).toBe('blocked');
  });

  it('exceção consult', () => {
    const cfg = {
      ...config,
      exceptions: [
        { cepStart: '49000000', cepEnd: '49999999', action: 'consult' as const, value: null },
      ],
    };
    expect(run(input, null, cfg)).toMatchObject({ mode: 'consult', reason: 'cep_exception' });
  });

  it('block vence consult', () => {
    const range = { cepStart: '49000000', cepEnd: '49999999', value: null };
    const cfg = {
      ...config,
      exceptions: [
        { ...range, action: 'consult' as const },
        { ...range, action: 'block' as const },
      ],
    };
    expect(run(input, null, cfg).mode).toBe('blocked');
  });

  it('extra_days e extra_cents somam em próprias e Melhor Envio', () => {
    const r = { cepStart: '49000000', cepEnd: '49999999' };
    const cfg = {
      ...config,
      exceptions: [
        { ...r, action: 'extra_days' as const, value: 2 },
        { ...r, action: 'extra_days' as const, value: 1 },
        { ...r, action: 'extra_cents' as const, value: 300 },
        { ...r, action: 'extra_cents' as const, value: 200 },
      ],
    };
    const opts = options(run(input, okMe(meItem(1, '10.00')), cfg));
    // próprias: Centro 1000 + 500, dias 0/1 + 1 + 3; Local 500 + 500
    expect(opts[0]).toMatchObject({
      service: 'own:fast',
      priceCents: 1500,
      daysMin: 4,
      daysMax: 5,
    });
    expect(opts[1]).toMatchObject({
      service: 'own:local',
      priceCents: 1000,
      daysMin: 4,
      daysMax: 4,
    });
    expect(opts[2]).toMatchObject({
      service: 'me:1',
      priceCents: 1000 + 150 + 500,
      daysMin: 6,
      daysMax: 8,
    });
  });

  it('valor de exceção inválido lança RangeError', () => {
    const cfg = {
      ...config,
      exceptions: [
        { cepStart: '49000000', cepEnd: '49999999', action: 'extra_cents' as const, value: -1 },
      ],
    };
    expect(() => prepareHybridQuote(input, cfg)).toThrow(RangeError);
  });

  it('endereço rural e difícil acesso viram consult', () => {
    for (const addressType of ['rural', 'hard_access'] as const) {
      expect(run({ ...input, addressType }, null)).toMatchObject({
        mode: 'consult',
        reason: 'address_type',
      });
    }
  });

  it('peso cubado preenchido é rejeitado', () => {
    expect(() => prepareHybridQuote(input, withSettings({ cubicDivisor: 6000 }))).toThrow(
      RangeError,
    );
  });
});

describe('limites de itens e peso', () => {
  const two = { ...input, items: [{ ...input.items[0]!, qty: 2 }] };

  it('acima do limite de itens: consult', () => {
    expect(run(two, null, withSettings({ maxItemsAutoShipping: 1 }))).toMatchObject({
      reason: 'too_many_items',
    });
  });

  it('limite exato de itens passa', () => {
    expect(run(two, null, withSettings({ maxItemsAutoShipping: 2 })).mode).toBe('options');
  });

  it('acima do limite de peso: consult (tara e presente entram)', () => {
    // 2 × 100 + tara 50 = 250
    expect(run(two, null, withSettings({ packageTareG: 50, maxWeightAutoG: 249 }))).toMatchObject({
      reason: 'too_heavy',
    });
    const gift = {
      ...two,
      giftWrap: { id: 'g', weightG: 20, packageSize: 'P' as const, unitPriceCents: 300 },
    };
    expect(run(gift, null, withSettings({ maxWeightAutoG: 219 }))).toMatchObject({
      reason: 'too_heavy',
    });
  });

  it('limite exato de peso passa', () => {
    expect(run(two, null, withSettings({ packageTareG: 50, maxWeightAutoG: 250 })).mode).toBe(
      'options',
    );
  });

  it('totalWeightG soma tara, itens e embalagem', () => {
    const w = totalWeightG(
      {
        items: [
          { id: 'a', qty: 2, packageSize: 'M', weightG: null, unitPriceCents: 1 },
          { id: 'b', qty: 3, packageSize: 'P', weightG: 40, unitPriceCents: 1 },
        ],
        giftWrap: { id: 'g', packageSize: 'P', weightG: null, unitPriceCents: 1 },
      },
      withSettings({ packageTareG: 10 }),
    );
    expect(w).toBe(10 + 600 + 120 + 100);
  });
});

describe('fretes próprios', () => {
  it('área mais específica vence e vários tipos geram várias opções', () => {
    const opts = options(run(input, null));
    expect(opts).toEqual([
      {
        service: 'own:fast',
        carrier: null,
        label: 'Entrega rápida · Centro',
        priceCents: 1000,
        daysMin: 1,
        daysMax: 2,
      },
      {
        service: 'own:local',
        carrier: null,
        label: 'Entrega local',
        priceCents: 500,
        daysMin: 1,
        daysMax: 1,
      },
    ]);
  });

  it('área ampla quando o CEP não está na menor', () => {
    const opts = options(run({ ...input, cep: '49500000' }, null));
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({ label: 'Entrega rápida · Região ampla', priceCents: 2000 });
  });

  it('nome e rótulo no tamanho máximo (123 caracteres) passam pelo schema da resposta', () => {
    const cfg: HybridShippingConfig = {
      ...config,
      ownTypes: [
        {
          id: '123e4567-e89b-42d3-a456-426614174000',
          name: 'N'.repeat(60),
          active: true,
          sortOrder: 1,
        },
      ],
      ownAreas: [
        {
          ...config.ownAreas[1]!,
          typeId: '123e4567-e89b-42d3-a456-426614174000',
          label: 'R'.repeat(60),
        },
      ],
    };
    const q = run(input, null, cfg);
    expect(options(q)[0]!.label).toHaveLength(123);
    expect(hybridShippingQuoteResponseSchema.safeParse(q).success).toBe(true);
  });

  it('prazo acima de 365 é limitado a 365 e a opção continua na lista', () => {
    const cfg: HybridShippingConfig = {
      ...config,
      settings: { ...config.settings, handlingDays: 365 },
      ownTypes: [
        { id: '123e4567-e89b-42d3-a456-426614174000', name: 'Rápida', active: true, sortOrder: 1 },
      ],
      ownAreas: [
        {
          ...config.ownAreas[1]!,
          typeId: '123e4567-e89b-42d3-a456-426614174000',
          daysMin: 300,
          daysMax: 365,
        },
      ],
      exceptions: [{ cepStart: '49000000', cepEnd: '49999999', action: 'extra_days', value: 365 }],
    };
    const q = run(input, null, cfg);
    expect(options(q)[0]).toMatchObject({
      service: 'own:123e4567-e89b-42d3-a456-426614174000',
      daysMin: 365,
      daysMax: 365,
    });
    expect(hybridShippingQuoteResponseSchema.safeParse(q).success).toBe(true);
  });

  it('tipo inativo e área inativa são ignorados', () => {
    const cfg: HybridShippingConfig = {
      ...config,
      ownTypes: [
        { id: 'fast', name: 'Entrega rápida', active: false, sortOrder: 1 },
        { id: 'local', name: 'Entrega local', active: true, sortOrder: 2 },
      ],
      ownAreas: config.ownAreas.map((a) => (a.id === 'a3' ? { ...a, active: false } : a)),
    };
    expect(run(input, null, cfg)).toMatchObject({ mode: 'consult', reason: 'no_option' });
    const cfg2 = {
      ...config,
      ownAreas: config.ownAreas.map((a) => (a.id === 'a2' ? { ...a, active: false } : a)),
    };
    expect(options(run(input, null, cfg2))[0]).toMatchObject({
      label: 'Entrega rápida · Região ampla',
    });
  });

  it('ordena tipos por sortOrder e depois nome', () => {
    const cfg: HybridShippingConfig = {
      ...config,
      ownTypes: [
        { id: 'local', name: 'Entrega local', active: true, sortOrder: 1 },
        { id: 'fast', name: 'Entrega rápida', active: true, sortOrder: 1 },
      ],
    };
    expect(options(run(input, null, cfg)).map((o) => o.service)).toEqual(['own:local', 'own:fast']);
  });
});

describe('Melhor Envio', () => {
  const at = { ...input, cep: OUTSIDE };

  it('resposta válida: custom_price + folga, prazo + preparo', () => {
    const opts = options(
      run(
        at,
        okMe(
          meItem(1, '30.00', 3, 6, {
            custom_price: '23.50',
            custom_delivery_range: { min: 4, max: 7 },
          }),
        ),
      ),
    );
    expect(opts).toEqual([
      {
        service: 'me:1',
        carrier: 'Correios',
        label: 'PAC',
        priceCents: 2350 + 150,
        daysMin: 5,
        daysMax: 8,
      },
    ]);
  });

  it('serviço fora da lista habilitada é descartado', () => {
    const opts = options(run(at, okMe(meItem(1, '10.00'), meItem(7, '5.00'))));
    expect(opts.map((o) => o.service)).toEqual(['me:1']);
  });

  it('item com error é descartado', () => {
    const q = run(at, okMe({ id: 1, name: 'PAC', error: 'Indisponível' }, meItem(2, '12.00')));
    expect(options(q).map((o) => o.service)).toEqual(['me:2']);
  });

  it('item fora do schema, preço ou prazo inválido são descartados', () => {
    const q = run(
      at,
      okMe({ foo: 1 }, meItem(1, 'abc'), meItem(2, '12.00', 5, 2), meItem(1, '9.00'), null),
    );
    expect(options(q).map((o) => o.service)).toEqual(['me:1']);
    expect(options(q)[0]!.priceCents).toBe(900 + 150);
  });

  it('ids repetidos: fica o primeiro', () => {
    const opts = options(run(at, okMe(meItem(1, '10.00'), meItem(1, '5.00'))));
    expect(opts).toHaveLength(1);
    expect(opts[0]!.priceCents).toBe(1150);
  });

  it.each(['timeout', 'network', 'unauthorized', 'http_error', 'invalid_response'] as const)(
    'falha %s: só fretes próprios',
    (reason) => {
      const opts = options(run(input, { ok: false, reason }));
      expect(opts.map((o) => o.service)).toEqual(['own:fast', 'own:local']);
    },
  );

  it('falha sem frete próprio, ou não chamado: no_option', () => {
    const expected = {
      mode: 'consult',
      reason: 'no_option',
      message: HYBRID_SHIPPING_MESSAGES.noOption,
    };
    expect(run(at, { ok: false, reason: 'timeout' })).toEqual(expected);
    expect(run(at, null)).toEqual(expected);
  });
});

describe('frete grátis', () => {
  const cfg = withSettings({ freeShippingMinCents: 5000 });
  const me = okMe(meItem(1, '20.00', 3, 5), meItem(2, '30.00', 1, 2));

  it('subtotal igual ao mínimo: a mais barata do Melhor Envio vira 0; frete próprio não', () => {
    const opts = options(run({ ...input, discountedSubtotalCents: 5000 }, me, cfg));
    expect(opts.find((o) => o.service === 'own:fast')!.priceCents).toBe(1000);
    expect(opts.find((o) => o.service === 'me:1')!.priceCents).toBe(0);
    expect(opts.find((o) => o.service === 'me:2')!.priceCents).toBe(3150);
  });

  it('um centavo abaixo: nada grátis', () => {
    const opts = options(run({ ...input, discountedSubtotalCents: 4999 }, me, cfg));
    expect(opts.every((o) => o.priceCents > 0)).toBe(true);
  });

  it('empate de preço: vence o menor prazo', () => {
    const tie = okMe(meItem(1, '20.00', 3, 5), meItem(2, '20.00', 1, 2));
    const opts = options(run({ ...input, discountedSubtotalCents: 5000 }, tie, cfg));
    expect(opts.find((o) => o.service === 'me:2')!.priceCents).toBe(0);
    expect(opts.find((o) => o.service === 'me:1')!.priceCents).toBe(2150);
  });

  it('só frete próprio disponível: nunca grátis', () => {
    const opts = options(run({ ...input, discountedSubtotalCents: 99999 }, null, cfg));
    expect(opts.every((o) => o.priceCents > 0)).toBe(true);
  });
});

describe('ordem de saída', () => {
  it('próprias primeiro, Melhor Envio por preço, prazo e service', () => {
    const q = run(
      input,
      okMe(meItem(2, '20.00', 1, 3), meItem(1, '20.00', 1, 2), meItem(1, '5.00')),
    );
    expect(options(q).map((o) => o.service)).toEqual(['own:fast', 'own:local', 'me:1', 'me:2']);
    const q2 = run(input, okMe(meItem(2, '10.00', 1, 3), meItem(1, '20.00', 1, 2)));
    expect(options(q2).map((o) => o.service)).toEqual(['own:fast', 'own:local', 'me:2', 'me:1']);
  });
});

describe('buildMelhorEnvioRequest', () => {
  const build = (inp: HybridShippingInput, cfg = config) =>
    buildMelhorEnvioRequest('49010100', inp, cfg);

  it('unidades: g para kg, cm, centavos para reais, services e CEPs', () => {
    const req = build({
      ...input,
      items: [
        { id: 'p1', qty: 2, packageSize: 'M', weightG: 450, unitPriceCents: 1990 },
        { id: 'p2', qty: 1, packageSize: 'P', weightG: null, unitPriceCents: 5 },
      ],
    });
    expect(req).toEqual({
      from: { postal_code: '49000000' },
      to: { postal_code: '49010100' },
      products: [
        {
          id: 'p1',
          width: 20,
          height: 8,
          length: 25,
          weight: 0.45,
          insurance_value: 19.9,
          quantity: 2,
        },
        {
          id: 'p2',
          width: 11,
          height: 2,
          length: 16,
          weight: 0.1,
          insurance_value: 0.05,
          quantity: 1,
        },
      ],
      services: '1,2',
    });
  });

  it('medidas do item valem só se as três existirem; peso mínimo 0,001', () => {
    const req = build({
      ...input,
      items: [
        {
          id: 'a',
          qty: 1,
          packageSize: 'P',
          weightG: 0,
          unitPriceCents: 100,
          widthCm: 10,
          heightCm: 5,
          lengthCm: 30,
        },
        {
          id: 'b',
          qty: 1,
          packageSize: 'P',
          weightG: 100,
          unitPriceCents: 100,
          widthCm: 10,
          heightCm: null,
          lengthCm: 30,
        },
      ],
    });
    expect(req!.products[0]).toMatchObject({ width: 10, height: 5, length: 30, weight: 0.001 });
    expect(req!.products[1]).toMatchObject({ width: 11, height: 2, length: 16 });
  });

  it('embalagem de presente vira product e tara vira linha tare', () => {
    const req = build(
      { ...input, giftWrap: { id: 'gift', packageSize: 'P', weightG: 30, unitPriceCents: 450 } },
      withSettings({ packageTareG: 250 }),
    );
    expect(req!.products.slice(1)).toEqual([
      {
        id: 'gift',
        width: 11,
        height: 2,
        length: 16,
        weight: 0.03,
        insurance_value: 4.5,
        quantity: 1,
      },
      { id: 'tare', width: 1, height: 1, length: 1, weight: 0.25, insurance_value: 0, quantity: 1 },
    ]);
  });

  it('sem tara não há linha tare', () => {
    expect(build(input)!.products.some((p) => p.id === 'tare')).toBe(false);
  });

  it('lista de serviços vazia: null (e a cotação segue só com próprias)', () => {
    const cfg = { ...config, melhorEnvio: { ...config.melhorEnvio, enabledServiceIds: [] } };
    expect(build(input, cfg)).toBeNull();
    const prepared = prepareHybridQuote(input, cfg);
    expect(prepared).toMatchObject({ mode: 'ready', melhorEnvioRequest: null });
  });

  it('medida acima de 200 cm: null', () => {
    const req = build({
      ...input,
      items: [
        {
          id: 'a',
          qty: 1,
          packageSize: 'P',
          weightG: 100,
          unitPriceCents: 100,
          widthCm: 201,
          heightCm: 5,
          lengthCm: 30,
        },
      ],
    });
    expect(req).toBeNull();
    const prepared = prepareHybridQuote(
      {
        ...input,
        items: [
          {
            id: 'a',
            qty: 1,
            packageSize: 'P',
            weightG: 100,
            unitPriceCents: 100,
            widthCm: 201,
            heightCm: 5,
            lengthCm: 30,
          },
        ],
      },
      config,
    );
    expect(prepared).toMatchObject({ mode: 'ready', melhorEnvioRequest: null });
  });
});
