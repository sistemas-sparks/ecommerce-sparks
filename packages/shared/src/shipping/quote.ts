// Motor de frete próprio (docs/frete.md). Função pura: recebe as tabelas e devolve as opções.
// Nenhuma cotação de terceiros (R2.5). A API recalcula no checkout; o valor do navegador nunca é usado.
import { assertCents, sumCents, type Cents } from '../money';
import { SHIPPING_SERVICE_LABELS } from '../order';
import type {
  CepRange,
  ConsultReason,
  ShippingConfig,
  ShippingInput,
  ShippingItem,
  ShippingOption,
  ShippingQuote,
} from './types';
import { RATE_SERVICES } from './types';

export const SHIPPING_MESSAGES = {
  invalidCep: 'CEP não encontrado, confira o número.',
  blocked: 'Ainda não entregamos neste CEP.',
  consult:
    'Frete a combinar: a loja confirma o valor e o prazo pelo WhatsApp antes de qualquer cobrança.',
} as const;

/** Remove a máscara e devolve os 8 dígitos do CEP, ou null se for inválido. */
export function normalizeCep(cep: string): string | null {
  const digits = cep.replace(/[.\-\s]/g, '');
  return /^\d{8}$/.test(digits) ? digits : null;
}

export function cepInRange(cep: string, range: CepRange): boolean {
  const value = Number(cep);
  return value >= Number(range.cepStart) && value <= Number(range.cepEnd);
}

function rangeSize(range: CepRange): number {
  return Number(range.cepEnd) - Number(range.cepStart);
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} deve ser um inteiro >= 0`);
  }
}

/** Peso real ou padrão. Peso cubado aguarda confirmação (docs/frete.md §2, passo 5). */
function unitWeightG(item: Omit<ShippingItem, 'qty'>, config: ShippingConfig): number {
  if (config.settings.cubicDivisor !== null) {
    throw new RangeError('O peso cubado aguarda a confirmação da fórmula pela loja.');
  }
  const size = config.packageSizes[item.packageSize];
  const real = item.weightG ?? size.weightG;
  assertNonNegativeInt(real, 'peso');
  return real;
}

/** Peso a cobrar: itens × quantidade + embalagem de presente + tara da caixa. */
export function chargeableWeightG(
  input: Pick<ShippingInput, 'items' | 'giftWrap'>,
  config: ShippingConfig,
): number {
  let total = config.settings.packageTareG;
  for (const item of input.items) {
    assertNonNegativeInt(item.qty, 'quantidade');
    total += unitWeightG(item, config) * item.qty;
  }
  if (input.giftWrap) total += unitWeightG(input.giftWrap, config);
  return total;
}

function consult(reason: ConsultReason): ShippingQuote {
  return { mode: 'consult', reason, message: SHIPPING_MESSAGES.consult };
}

export function quoteShipping(input: ShippingInput, config: ShippingConfig): ShippingQuote {
  assertCents(input.discountedSubtotalCents, 'subtotal');
  const { settings } = config;

  // 1. CEP válido
  const cep = normalizeCep(input.cep);
  if (!cep) return { mode: 'invalid', message: SHIPPING_MESSAGES.invalidCep };

  // 2. Exceções por faixa de CEP: block > consult > extras somados
  const exceptions = config.exceptions.filter((e) => cepInRange(cep, e));
  if (exceptions.some((e) => e.action === 'block')) {
    return { mode: 'blocked', message: SHIPPING_MESSAGES.blocked };
  }
  if (exceptions.some((e) => e.action === 'consult')) return consult('cep_exception');
  let extraDays = 0;
  let extraCents = 0;
  for (const e of exceptions) {
    const value = e.value ?? 0;
    assertNonNegativeInt(value, 'valor da exceção');
    if (e.action === 'extra_days') extraDays += value;
    if (e.action === 'extra_cents') extraCents += value;
  }

  // 10. Endereço rural ou de difícil acesso: sempre frete a combinar
  if (input.addressType !== 'urban') return consult('address_type');

  const finish = (options: ShippingOption[], weight: number | null): ShippingQuote => ({
    mode: 'options',
    chargeableWeightG: weight,
    options: options.map((o) => ({
      ...o,
      priceCents: sumCents([o.priceCents, extraCents]),
      daysMin: o.daysMin + settings.handlingDays + extraDays,
      daysMax: o.daysMax + settings.handlingDays + extraDays,
    })),
  });

  // 3. Regra local: a faixa mais específica vence
  const local = config.localRules
    .filter((r) => r.active && cepInRange(cep, r))
    .sort((a, b) => rangeSize(a) - rangeSize(b))[0];
  if (local) {
    return finish(
      [
        {
          service: 'local',
          label: local.label || SHIPPING_SERVICE_LABELS.local,
          priceCents: local.priceCents,
          daysMin: local.daysMin,
          daysMax: local.daysMax,
        },
      ],
      null,
    );
  }

  // 4. UF pelo CEP e zona
  const uf = config.ufCepRanges.find((r) => cepInRange(cep, r))?.uf;
  if (!uf) return { mode: 'invalid', message: SHIPPING_MESSAGES.invalidCep };
  const zone = config.zones.find((z) => z.active && z.ufs.includes(uf));
  if (!zone) return consult('no_zone');

  // 5 e 6. Peso a cobrar e limites
  const weight = chargeableWeightG(input, config);
  const totalQty = input.items.reduce((sum, item) => sum + item.qty, 0);
  if (settings.maxItemsAutoShipping !== null && totalQty > settings.maxItemsAutoShipping) {
    return consult('too_many_items');
  }
  if (settings.maxWeightAutoG !== null && weight > settings.maxWeightAutoG) {
    return consult('too_heavy');
  }

  // 7. Tarifa: menor faixa que comporta o peso, por serviço
  const options: ShippingOption[] = [];
  for (const service of RATE_SERVICES) {
    const rate = config.rates
      .filter((r) => r.zoneId === zone.id && r.service === service && r.maxWeightG >= weight)
      .sort((a, b) => a.maxWeightG - b.maxWeightG)[0];
    if (rate) {
      options.push({
        service,
        label: SHIPPING_SERVICE_LABELS[service],
        priceCents: rate.priceCents,
        daysMin: rate.daysMin,
        daysMax: rate.daysMax,
      });
    }
  }
  if (options.length === 0) return consult('no_rate');

  // 8. Prazo (preparo + extras) e acréscimos aplicados em finish()
  const quote = finish(options, weight);

  // 9. Frete grátis: só o Econômico, quando o subtotal com desconto atinge o mínimo.
  //    Fica R$ 0,00 mesmo com acréscimo de exceção (docs/frete.md, passo 9).
  const freeMin = settings.freeShippingMinCents;
  if (quote.mode === 'options' && freeMin !== null && input.discountedSubtotalCents >= freeMin) {
    for (const option of quote.options) {
      if (option.service === 'economy') option.priceCents = 0 satisfies Cents;
    }
  }
  return quote;
}
