// Tipos do frete híbrido: fretes próprios por faixa de CEP + cotação do Melhor Envio.
import type { Cents } from '../money';
import type { AddressType } from '../order';
import type {
  CepException,
  CepRange,
  PackageSize,
  PackageSizeSpec,
  ShippingItem,
  ShippingSettings,
} from './types';

export interface OwnShippingType {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

export interface OwnShippingArea extends CepRange {
  id: string;
  typeId: string;
  label: string;
  priceCents: Cents;
  daysMin: number;
  daysMax: number;
  active: boolean;
}

export interface MelhorEnvioSettings {
  originCep: string; // 8 dígitos
  enabledServiceIds: readonly number[]; // ids dos serviços no Melhor Envio
  marginCents: Cents; // folga em centavos somada a cada opção do Melhor Envio
}

export interface HybridShippingConfig {
  exceptions: readonly CepException[];
  packageSizes: Readonly<Record<PackageSize, PackageSizeSpec>>;
  settings: ShippingSettings;
  ownTypes: readonly OwnShippingType[];
  ownAreas: readonly OwnShippingArea[];
  melhorEnvio: MelhorEnvioSettings;
}

export interface HybridShippingItem extends ShippingItem {
  id: string; // id do produto (vai como products[].id ao Melhor Envio)
  unitPriceCents: Cents; // base do valor segurado
}

export interface HybridShippingInput {
  cep: string;
  items: readonly HybridShippingItem[];
  giftWrap?: Omit<HybridShippingItem, 'qty'> | null;
  addressType: AddressType;
  discountedSubtotalCents: Cents;
}

export type ShippingServiceId = `own:${string}` | `me:${number}`;

export interface HybridShippingOption {
  service: ShippingServiceId;
  carrier: string | null; // null nos fretes próprios; nome da transportadora no Melhor Envio
  label: string;
  priceCents: Cents;
  daysMin: number;
  daysMax: number;
}

export type HybridConsultReason =
  'cep_exception' | 'address_type' | 'too_heavy' | 'too_many_items' | 'no_option';

export type HybridShippingQuote =
  | { mode: 'options'; options: HybridShippingOption[] }
  | { mode: 'consult'; reason: HybridConsultReason; message: string }
  | { mode: 'blocked'; message: string }
  | { mode: 'invalid'; message: string };

export type MelhorEnvioFailure =
  'timeout' | 'network' | 'unauthorized' | 'http_error' | 'invalid_response';

/** Resultado da chamada ao Melhor Envio (feita na API); o motor valida cada item. */
export type MelhorEnvioResult =
  { ok: true; items: readonly unknown[] } | { ok: false; reason: MelhorEnvioFailure };
