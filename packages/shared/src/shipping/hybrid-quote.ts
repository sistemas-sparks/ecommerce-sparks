// Motor de frete híbrido (docs/frete.md §2). Funções puras, sem rede: a API chama o Melhor Envio
// entre prepareHybridQuote e finishHybridQuote. Melhor Envio só cota (R2.5).
import { assertCents, sumCents, type Cents } from '../money';
import type {
  HybridConsultReason,
  HybridShippingConfig,
  HybridShippingInput,
  HybridShippingItem,
  HybridShippingOption,
  HybridShippingQuote,
  MelhorEnvioResult,
} from './hybrid-types';
import {
  melhorEnvioCalculateRequestSchema,
  melhorEnvioErrorItemSchema,
  melhorEnvioQuoteItemSchema,
  melhorEnvioQuotePriceCents,
  melhorEnvioQuoteRange,
  type MelhorEnvioCalculateRequest,
} from './melhor-envio';
import { SHIPPING_MESSAGES, cepInRange, normalizeCep } from './quote';
import type { ShippingItem } from './types';

export const HYBRID_SHIPPING_MESSAGES = {
  ...SHIPPING_MESSAGES,
  noOption:
    'Não conseguimos calcular o frete agora. Você pode finalizar e a loja confirma o valor pelo WhatsApp, sem cobrança antes disso.',
} as const;

export type PreparedHybridQuote =
  | { mode: 'final'; quote: HybridShippingQuote }
  | {
      mode: 'ready';
      cep: string;
      extraDays: number;
      extraCents: number;
      ownOptions: HybridShippingOption[];
      melhorEnvioRequest: MelhorEnvioCalculateRequest | null;
    };

type ConfigForWeight = Pick<HybridShippingConfig, 'packageSizes' | 'settings'>;

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} deve ser um inteiro >= 0`);
  }
}

function consult(reason: HybridConsultReason): HybridShippingQuote {
  return { mode: 'consult', reason, message: HYBRID_SHIPPING_MESSAGES.consult };
}

/** Peso real ou padrão do tamanho. Peso cubado aguarda confirmação (docs/frete.md). */
function unitWeightG(item: Omit<ShippingItem, 'qty'>, config: ConfigForWeight): number {
  if (config.settings.cubicDivisor !== null) {
    throw new RangeError('O peso cubado aguarda a confirmação da fórmula pela loja.');
  }
  const real = item.weightG ?? config.packageSizes[item.packageSize].weightG;
  assertNonNegativeInt(real, 'peso');
  return real;
}

/** Peso total: tara + itens × quantidade + embalagem de presente (1 unidade). */
export function totalWeightG(
  input: Pick<HybridShippingInput, 'items' | 'giftWrap'>,
  config: ConfigForWeight,
): number {
  let total = config.settings.packageTareG;
  assertNonNegativeInt(total, 'tara');
  for (const item of input.items) {
    assertNonNegativeInt(item.qty, 'quantidade');
    total += unitWeightG(item, config) * item.qty;
  }
  if (input.giftWrap) total += unitWeightG(input.giftWrap, config);
  return total;
}

/** Centavos inteiros em reais com 2 casas (1990 vira 19.9), sem conta em float. */
function centsToReais(cents: Cents): number {
  assertCents(cents, 'valor segurado');
  return Number(`${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`);
}

type MeProduct = MelhorEnvioCalculateRequest['products'][number];

function toProduct(
  item: Omit<HybridShippingItem, 'qty'>,
  quantity: number,
  config: ConfigForWeight,
): MeProduct {
  const size = config.packageSizes[item.packageSize];
  const hasOwn = item.widthCm != null && item.heightCm != null && item.lengthCm != null;
  return {
    id: item.id,
    width: hasOwn ? item.widthCm! : size.widthCm,
    height: hasOwn ? item.heightCm! : size.heightCm,
    length: hasOwn ? item.lengthCm! : size.lengthCm,
    weight: Math.max(unitWeightG(item, config) / 1000, 0.001),
    insurance_value: centsToReais(item.unitPriceCents),
    quantity,
  };
}

export function buildMelhorEnvioRequest(
  cep: string,
  input: HybridShippingInput,
  config: HybridShippingConfig,
): MelhorEnvioCalculateRequest | null {
  const { enabledServiceIds, originCep } = config.melhorEnvio;
  if (enabledServiceIds.length === 0) return null;

  const products = input.items.map((item) => toProduct(item, item.qty, config));
  if (input.giftWrap) products.push(toProduct(input.giftWrap, 1, config));
  const tare = config.settings.packageTareG;
  if (tare > 0) {
    // O Melhor Envio monta as caixas pelos products; a tara entra como linha à parte
    // para somar o peso da caixa.
    products.push({
      id: 'tare',
      width: 1,
      height: 1,
      length: 1,
      weight: tare / 1000,
      insurance_value: 0,
      quantity: 1,
    });
  }

  const parsed = melhorEnvioCalculateRequestSchema.safeParse({
    from: { postal_code: originCep },
    to: { postal_code: cep },
    products,
    services: enabledServiceIds.join(','),
  });
  return parsed.success ? parsed.data : null;
}

export function prepareHybridQuote(
  input: HybridShippingInput,
  config: HybridShippingConfig,
): PreparedHybridQuote {
  assertCents(input.discountedSubtotalCents, 'subtotal');
  const final = (quote: HybridShippingQuote): PreparedHybridQuote => ({ mode: 'final', quote });
  const { settings } = config;

  const cep = normalizeCep(input.cep);
  if (!cep) return final({ mode: 'invalid', message: HYBRID_SHIPPING_MESSAGES.invalidCep });

  const exceptions = config.exceptions.filter((e) => cepInRange(cep, e));
  if (exceptions.some((e) => e.action === 'block')) {
    return final({ mode: 'blocked', message: HYBRID_SHIPPING_MESSAGES.blocked });
  }
  if (exceptions.some((e) => e.action === 'consult')) return final(consult('cep_exception'));
  let extraDays = 0;
  let extraCents = 0;
  for (const e of exceptions) {
    const value = e.value ?? 0;
    assertNonNegativeInt(value, 'valor da exceção');
    if (e.action === 'extra_days') extraDays += value;
    if (e.action === 'extra_cents') extraCents += value;
  }

  if (input.addressType !== 'urban') return final(consult('address_type'));

  const weight = totalWeightG(input, config);
  const totalQty = input.items.reduce((sum, item) => sum + item.qty, 0);
  if (settings.maxItemsAutoShipping !== null && totalQty > settings.maxItemsAutoShipping) {
    return final(consult('too_many_items'));
  }
  if (settings.maxWeightAutoG !== null && weight > settings.maxWeightAutoG) {
    return final(consult('too_heavy'));
  }

  const rangeSize = (r: { cepStart: string; cepEnd: string }): number =>
    Number(r.cepEnd) - Number(r.cepStart);
  const ownOptions: HybridShippingOption[] = [];
  const types = config.ownTypes
    .filter((t) => t.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  for (const type of types) {
    const area = config.ownAreas
      .filter((a) => a.active && a.typeId === type.id && cepInRange(cep, a))
      .sort((a, b) => rangeSize(a) - rangeSize(b))[0];
    if (!area) continue;
    ownOptions.push({
      service: `own:${type.id}`,
      carrier: null,
      label: area.label ? `${type.name} · ${area.label}` : type.name,
      priceCents: area.priceCents,
      daysMin: area.daysMin,
      daysMax: area.daysMax,
    });
  }

  return {
    mode: 'ready',
    cep,
    extraDays,
    extraCents,
    ownOptions,
    melhorEnvioRequest: buildMelhorEnvioRequest(cep, input, config),
  };
}

function meOptions(
  result: MelhorEnvioResult | null,
  config: HybridShippingConfig,
): HybridShippingOption[] {
  if (!result?.ok) return [];
  const { enabledServiceIds, marginCents } = config.melhorEnvio;
  const options: HybridShippingOption[] = [];
  const seen = new Set<number>();
  for (const raw of result.items) {
    if (melhorEnvioErrorItemSchema.safeParse(raw).success) continue;
    const parsed = melhorEnvioQuoteItemSchema.safeParse(raw);
    if (!parsed.success) continue;
    const item = parsed.data;
    if (!enabledServiceIds.includes(item.id) || seen.has(item.id)) continue;
    const price = melhorEnvioQuotePriceCents(item);
    const range = melhorEnvioQuoteRange(item);
    if (price === null || range === null) continue;
    seen.add(item.id);
    options.push({
      service: `me:${item.id}`,
      carrier: item.company.name,
      label: item.name,
      priceCents: sumCents([price, marginCents]),
      daysMin: range.min,
      daysMax: range.max,
    });
  }
  return options;
}

export function finishHybridQuote(
  prepared: Extract<PreparedHybridQuote, { mode: 'ready' }>,
  melhorEnvio: MelhorEnvioResult | null,
  input: HybridShippingInput,
  config: HybridShippingConfig,
): HybridShippingQuote {
  const { handlingDays, freeShippingMinCents } = config.settings;
  const { extraCents, extraDays } = prepared;
  const adjust = (o: HybridShippingOption): HybridShippingOption => ({
    ...o,
    priceCents: sumCents([o.priceCents, extraCents]),
    // O teto de 365 dias espelha o schema da resposta (hybridShippingOptionSchema).
    daysMin: Math.min(o.daysMin + handlingDays + extraDays, 365),
    daysMax: Math.min(o.daysMax + handlingDays + extraDays, 365),
  });

  const own = prepared.ownOptions.map(adjust);
  const me = meOptions(melhorEnvio, config).map(adjust);
  me.sort(
    (a, b) =>
      a.priceCents - b.priceCents || a.daysMax - b.daysMax || a.service.localeCompare(b.service),
  );

  // Frete grátis: só a opção mais barata do Melhor Envio (a primeira após ordenar).
  // Fretes próprios não ficam grátis (pendência com a cliente, docs/frete.md passo 10).
  const first = me[0];
  if (
    first &&
    freeShippingMinCents !== null &&
    input.discountedSubtotalCents >= freeShippingMinCents
  ) {
    me[0] = { ...first, priceCents: 0 };
  }

  const options = [...own, ...me];
  if (options.length === 0) {
    return { mode: 'consult', reason: 'no_option', message: HYBRID_SHIPPING_MESSAGES.noOption };
  }
  return { mode: 'options', options };
}
