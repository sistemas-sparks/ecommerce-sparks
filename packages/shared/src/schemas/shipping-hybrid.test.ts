import { describe, expect, it } from 'vitest';
import {
  hybridShippingQuoteResponseSchema,
  shippingHybridDataSchema,
  shippingServiceIdSchema,
} from './shipping-hybrid';
import {
  MELHOR_ENVIO_MARGIN_MAX_CENTS,
  ownAreaInputSchema,
  shippingHybridSettingsInputSchema,
} from './shipping-admin-hybrid';

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const option = {
  service: `own:${uuid}`,
  carrier: null,
  label: 'Entrega local',
  priceCents: 800,
  daysMin: 1,
  daysMax: 2,
};

describe('shippingServiceIdSchema', () => {
  it.each([`own:${uuid}`, 'me:1'])('aceita %s', (v) => {
    expect(shippingServiceIdSchema.safeParse(v).success).toBe(true);
  });
  it.each(['me:0', 'me:abc', 'own:xyz', 'local'])('recusa %s', (v) => {
    const r = shippingServiceIdSchema.safeParse(v);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('Opção de frete inválida.');
  });
});

describe('hybridShippingQuoteResponseSchema', () => {
  const ok = (v: unknown) => hybridShippingQuoteResponseSchema.safeParse(v).success;
  it('aceita cada mode', () => {
    const me = { ...option, service: 'me:1', carrier: 'Correios' };
    expect(ok({ mode: 'options', options: [option, me] })).toBe(true);
    expect(ok({ mode: 'consult', reason: 'too_heavy', message: 'Consulte.' })).toBe(true);
    expect(ok({ mode: 'blocked', message: 'Bloqueado.' })).toBe(true);
    expect(ok({ mode: 'invalid', message: 'CEP inválido.' })).toBe(true);
  });
  it('rótulo: 200 caracteres aceito, 201 recusado', () => {
    const q = (n: number) => ({ mode: 'options', options: [{ ...option, label: 'x'.repeat(n) }] });
    expect(ok(q(200))).toBe(true);
    expect(ok(q(201))).toBe(false);
  });
  it('recusa options vazio e daysMin > daysMax', () => {
    expect(ok({ mode: 'options', options: [] })).toBe(false);
    expect(ok({ mode: 'options', options: [{ ...option, daysMin: 5, daysMax: 2 }] })).toBe(false);
  });
});

describe('shippingHybridDataSchema', () => {
  const size = { weight_g: 100, length_cm: 16, width_cm: 11, height_cm: 4 };
  const base = {
    exceptions: [],
    package_sizes: (['P', 'M', 'G'] as const).map((s) => ({ size: s, ...size })),
    settings: {
      origin_cep: null,
      origin_uf: null,
      handling_days: 1,
      free_shipping_min_cents: null,
      max_items_auto_shipping: null,
      max_weight_auto_g: null,
      package_tare_g: 0,
      cubic_divisor: null,
      gift_wrap_enabled: false,
      melhor_envio_margin_cents: 0,
    },
    own_types: [],
    own_areas: [],
    melhor_envio_services: [
      { service_id: 1, name: 'PAC', carrier: 'Correios', enabled: true, sort_order: 0 },
    ],
  };
  it('aceita dados válidos e recusa serviço desligado ou margem fracionária', () => {
    expect(shippingHybridDataSchema.safeParse(base).success).toBe(true);
    const off = {
      ...base,
      melhor_envio_services: [{ ...base.melhor_envio_services[0]!, enabled: false }],
    };
    expect(shippingHybridDataSchema.safeParse(off).success).toBe(false);
    const frac = { ...base, settings: { ...base.settings, melhor_envio_margin_cents: 1.5 } };
    expect(shippingHybridDataSchema.safeParse(frac).success).toBe(false);
  });
});

describe('schemas admin do frete híbrido', () => {
  const area = {
    type_id: uuid,
    label: '',
    cep_start: '49000-000',
    cep_end: '49009999',
    price_cents: 0,
    days_min: 0,
    days_max: 0,
    active: true,
  };
  it('aceita área com preço zero e prazo no mesmo dia', () => {
    const r = ownAreaInputSchema.safeParse(area);
    expect(r.success && r.data.cep_start).toBe('49000000');
  });
  it.each([
    { cep_start: '1' },
    { cep_start: '49010000' },
    { price_cents: -1 },
    { price_cents: 1.5 },
    { days_min: 2, days_max: 1 },
  ])('recusa área %j', (patch) => {
    expect(ownAreaInputSchema.safeParse({ ...area, ...patch }).success).toBe(false);
  });
  it('limita a folga', () => {
    const base = {
      origin_cep: null,
      origin_uf: null,
      handling_days: 1,
      free_shipping_min_cents: null,
      max_items_auto_shipping: null,
      max_weight_auto_g: null,
      package_tare_g: 0,
      cubic_divisor: null,
    };
    const ok = (v: number) =>
      shippingHybridSettingsInputSchema.safeParse({ ...base, melhor_envio_margin_cents: v })
        .success;
    expect(ok(0)).toBe(true);
    expect(ok(MELHOR_ENVIO_MARGIN_MAX_CENTS)).toBe(true);
    expect(ok(-1)).toBe(false);
    expect(ok(MELHOR_ENVIO_MARGIN_MAX_CENTS + 1)).toBe(false);
    expect(ok(1.5)).toBe(false);
  });
});
