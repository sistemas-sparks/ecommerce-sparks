// Contrato da API de cálculo de frete do Melhor Envio (só cotação, R2.5) e conversão de preço.
import { z } from 'zod';
import { isCents, type Cents } from '../money';

const postalCode = z.string().regex(/^\d{8}$/);

export const melhorEnvioCalculateRequestSchema = z.object({
  from: z.object({ postal_code: postalCode }),
  to: z.object({ postal_code: postalCode }),
  products: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        width: z.number().int().min(1).max(200),
        height: z.number().int().min(1).max(200),
        length: z.number().int().min(1).max(200),
        weight: z.number().gt(0).max(100),
        insurance_value: z.number().min(0).max(100000),
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .min(1)
    .max(60),
  services: z.string().regex(/^\d{1,6}(,\d{1,6})*$/),
});
export type MelhorEnvioCalculateRequest = z.infer<typeof melhorEnvioCalculateRequestSchema>;

const deliveryRange = z.object({
  min: z.number().int().min(0).max(365),
  max: z.number().int().min(0).max(365),
});

export const melhorEnvioQuoteItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(100),
  price: z.string(),
  custom_price: z.string().optional(),
  delivery_range: deliveryRange,
  custom_delivery_range: deliveryRange.optional(),
  company: z.object({ id: z.number().int(), name: z.string().min(1).max(100) }),
});
export type MelhorEnvioQuoteItem = z.infer<typeof melhorEnvioQuoteItemSchema>;

export const melhorEnvioErrorItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  error: z.string(),
});
export type MelhorEnvioErrorItem = z.infer<typeof melhorEnvioErrorItemSchema>;

// Só garante que é um array; cada item é validado um a um pelo cliente da API.
export const melhorEnvioCalculateResponseSchema = z.array(z.unknown()).max(50);

const PRICE_TEXT = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

/** Converte o preço em texto do Melhor Envio ("23.50", em reais) para centavos, sem float. */
export function parseMelhorEnvioPriceToCents(text: string): Cents | null {
  const match = PRICE_TEXT.exec(text);
  if (!match) return null;
  const reais = Number(match[1]);
  const centavos = Number((match[2] ?? '').padEnd(2, '0'));
  const total = reais * 100 + centavos;
  return isCents(total) ? total : null;
}

/** Preço da cotação em centavos: usa custom_price se existir, senão price. */
export function melhorEnvioQuotePriceCents(
  item: Pick<MelhorEnvioQuoteItem, 'price' | 'custom_price'>,
): Cents | null {
  return parseMelhorEnvioPriceToCents(item.custom_price ?? item.price);
}

/** Prazo da cotação: custom_delivery_range se existir, senão delivery_range; min > max vira null. */
export function melhorEnvioQuoteRange(
  item: Pick<MelhorEnvioQuoteItem, 'delivery_range' | 'custom_delivery_range'>,
): { min: number; max: number } | null {
  const range = item.custom_delivery_range ?? item.delivery_range;
  return range.min > range.max ? null : { min: range.min, max: range.max };
}
