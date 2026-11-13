import type { Cents } from '../money';
import type { AddressType } from '../order';
import type { UF } from '../schemas/common';

export const PACKAGE_SIZES = ['P', 'M', 'G'] as const;
export type PackageSize = (typeof PACKAGE_SIZES)[number];

export const RATE_SERVICES = ['economy', 'express'] as const;
export type RateService = (typeof RATE_SERVICES)[number];

export const CEP_EXCEPTION_ACTIONS = ['block', 'consult', 'extra_days', 'extra_cents'] as const;
export type CepExceptionAction = (typeof CEP_EXCEPTION_ACTIONS)[number];

/** CEPs sempre como 8 dígitos ("49000000"). */
export interface CepRange {
  cepStart: string;
  cepEnd: string;
}

export interface UfCepRange extends CepRange {
  uf: UF;
}

export interface ShippingZone {
  id: string;
  name: string;
  ufs: readonly UF[];
  active: boolean;
}

export interface ShippingRate {
  zoneId: string;
  service: RateService;
  maxWeightG: number;
  priceCents: Cents;
  daysMin: number;
  daysMax: number;
}

export interface ShippingLocalRule extends CepRange {
  label: string;
  priceCents: Cents;
  daysMin: number;
  daysMax: number;
  active: boolean;
}

export interface CepException extends CepRange {
  action: CepExceptionAction;
  /** Dias (extra_days) ou centavos (extra_cents). Ignorado em block e consult. */
  value: number | null;
}

export interface PackageSizeSpec {
  weightG: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface ShippingSettings {
  handlingDays: number;
  /** null = sem frete grátis. */
  freeShippingMinCents: Cents | null;
  /** null = sem limite. */
  maxItemsAutoShipping: number | null;
  /** null = sem limite. */
  maxWeightAutoG: number | null;
  /** Peso da caixa somado a todo pedido. */
  packageTareG: number;
  /**
   * Campo reservado para confirmação futura da fórmula vigente dos Correios.
   * Deve permanecer null; valores preenchidos são rejeitados pelo motor (docs/frete.md, passo 5).
   */
  cubicDivisor: number | null;
}

export interface ShippingConfig {
  ufCepRanges: readonly UfCepRange[];
  zones: readonly ShippingZone[];
  rates: readonly ShippingRate[];
  localRules: readonly ShippingLocalRule[];
  exceptions: readonly CepException[];
  packageSizes: Readonly<Record<PackageSize, PackageSizeSpec>>;
  settings: ShippingSettings;
}

export interface ShippingItem {
  /** Peso real em gramas; null usa o peso padrão do tamanho. */
  weightG: number | null;
  packageSize: PackageSize;
  qty: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
}

export interface ShippingInput {
  cep: string;
  items: readonly ShippingItem[];
  /** Embalagem de presente (1 por pedido), se escolhida. */
  giftWrap?: Omit<ShippingItem, 'qty'> | null;
  addressType: AddressType;
  /** Subtotal dos produtos já com desconto: base do frete grátis. */
  discountedSubtotalCents: Cents;
}

export interface ShippingOption {
  service: 'local' | RateService;
  label: string;
  priceCents: Cents;
  daysMin: number;
  daysMax: number;
}

export type ShippingQuote =
  | { mode: 'options'; options: ShippingOption[]; chargeableWeightG: number | null }
  | { mode: 'consult'; reason: ConsultReason; message: string }
  | { mode: 'blocked'; message: string }
  | { mode: 'invalid'; message: string };

export type ConsultReason =
  'cep_exception' | 'address_type' | 'no_zone' | 'too_heavy' | 'too_many_items' | 'no_rate';
