import { z } from 'zod';
import { multiplyCents, sumCents, type Cents } from './money';
import type { CatalogImage, LiveProduct, PublicProduct } from './schemas/catalog';
import { uuidSchema } from './schemas/common';
import {
  MAX_ITEM_QTY,
  addressTypeSchema,
  couponCodeSchema,
  giftMessageSchema,
  type CartItemInput,
} from './schemas/order-input';
import { hybridShippingOptionSchema } from './schemas/shipping-hybrid';

// Cálculo de EXIBIÇÃO da sacola. O checkout recalcula tudo no servidor (R3.3); nada daqui cobra.

/**
 * Escolhas da sacola guardadas no navegador (localStorage), só para exibição e para a página de
 * checkout ler. O servidor recalcula tudo (R3.3): nada daqui é confiável para cobrança.
 */
export const cartSessionSchema = z.object({
  cep: z.string().regex(/^(\d{8})?$/),
  addressType: addressTypeSchema,
  couponCode: couponCodeSchema.nullable(),
  giftWrap: z.object({ productId: uuidSchema, message: giftMessageSchema }).nullable(),
  shipping: z
    .discriminatedUnion('mode', [
      z.object({
        mode: z.literal('options'),
        service: hybridShippingOptionSchema.shape.service,
        carrier: z.string().min(1).max(100).nullable(),
        label: z.string().min(1).max(200),
        priceCents: z.number().int().min(0).max(2147483647),
        daysMin: z.number().int().min(0).max(365),
        daysMax: z.number().int().min(0).max(365),
      }),
      z.object({ mode: z.literal('consult'), message: z.string().min(1).max(500) }),
    ])
    .nullable(),
});
export type CartSession = z.infer<typeof cartSessionSchema>;

export type CartLineStatus = 'ok' | 'unavailable' | 'over_stock';

export interface CartViewLine {
  productId: string;
  name: string;
  slug: string;
  photo: CatalogImage | null;
  qty: number;
  unitPriceCents: Cents;
  lineCents: Cents;
  maxQty: number;
  status: CartLineStatus;
}

export interface CartViewTotals {
  subtotalCents: Cents;
  discountCents: Cents;
  giftWrapCents: Cents;
  shippingCents: Cents | null;
  totalCents: Cents;
}

export interface CartView {
  lines: CartViewLine[];
  totals: CartViewTotals;
  isEmpty: boolean;
  canCheckout: boolean;
}

export interface BuildCartViewInput {
  draft: readonly CartItemInput[];
  /** Só para nome, slug e foto. O preço nunca vem daqui. */
  catalogProducts: readonly PublicProduct[];
  liveProducts: readonly LiveProduct[];
  giftWrapPriceCents: Cents | null;
  appliedDiscountCents: Cents;
  /** null = frete a combinar (consult) ou ainda não escolhido. */
  shippingCents: Cents | null;
  /** Há opção de frete escolhida (opção ou "a combinar"). Padrão: shippingCents !== null. */
  shippingChosen?: boolean;
}

export function buildCartView(input: BuildCartViewInput): CartView {
  const catalog = new Map(input.catalogProducts.map((p) => [p.id, p]));
  const live = new Map(input.liveProducts.map((p) => [p.id, p]));

  const lines: CartViewLine[] = input.draft.map((item) => {
    const product = catalog.get(item.productId);
    const stock = live.get(item.productId);
    let status: CartLineStatus = 'ok';
    if (!product || !stock || !stock.active || stock.stock <= 0) status = 'unavailable';
    else if (item.qty > stock.stock) status = 'over_stock';
    const maxQty = stock && stock.active ? Math.min(stock.stock, MAX_ITEM_QTY) : 0;
    const unitPriceCents = stock ? stock.price_cents : 0;
    return {
      productId: item.productId,
      name: product?.name ?? '',
      slug: product?.slug ?? '',
      photo: product?.images[0] ?? null,
      qty: item.qty,
      unitPriceCents,
      // Item indisponível não entra na soma.
      lineCents: status === 'unavailable' ? 0 : multiplyCents(unitPriceCents, item.qty),
      maxQty,
      status,
    };
  });

  const subtotalCents = sumCents(lines.map((l) => l.lineCents));
  const discountCents = Math.min(input.appliedDiscountCents, subtotalCents);
  const giftWrapCents = input.giftWrapPriceCents ?? 0;
  const shippingCents = input.shippingCents;
  const isEmpty = lines.length === 0;
  // Sacola vazia não tem total (nada de embalagem ou frete soltos).
  const totalCents = isEmpty
    ? 0
    : sumCents([subtotalCents - discountCents, giftWrapCents, shippingCents ?? 0]);
  const shippingChosen = input.shippingChosen ?? shippingCents !== null;

  return {
    lines,
    totals: { subtotalCents, discountCents, giftWrapCents, shippingCents, totalCents },
    isEmpty,
    canCheckout: !isEmpty && shippingChosen && lines.every((l) => l.status === 'ok'),
  };
}

// ---- Regras puras de invalidação (usadas pela sacola; o servidor continua recalculando tudo) ----

/** Assinatura dos itens: a ordem não importa; mudar produto ou quantidade muda o texto. */
export function itemsSignature(items: readonly CartItemInput[]): string {
  return items
    .map((i) => `${i.productId}:${i.qty}`)
    .sort()
    .join('|');
}

export interface AppliedCouponLike {
  code: string;
  discountCents: Cents;
  itemsSig: string;
}

/** O cupom só vale se foi validado para esta mesma sacola e ainda é o cupom da sessão. */
export function isCouponStale(applied: AppliedCouponLike | null, itemsSig: string): boolean {
  return applied !== null && applied.itemsSig !== itemsSig;
}
export function activeCoupon(
  applied: AppliedCouponLike | null,
  itemsSig: string,
  sessionCouponCode: string | null,
): AppliedCouponLike | null {
  if (!applied || isCouponStale(applied, itemsSig)) return null;
  return sessionCouponCode === applied.code ? applied : null;
}

/** Assinatura de tudo que o servidor usa para cotar o frete. */
export function shippingSignature(input: {
  itemsSig: string;
  couponCode: string | null;
  giftWrapProductId: string | null;
  cep: string;
  addressType: string;
}): string {
  return JSON.stringify([
    input.itemsSig,
    input.couponCode ?? '',
    input.giftWrapProductId ?? '',
    input.cep,
    input.addressType,
  ]);
}

/** O frete guardado só vale se foi cotado com a assinatura atual. */
export function isShippingCurrent(storedSig: string, currentSig: string): boolean {
  return storedSig !== '' && storedSig === currentSig;
}

/** "49000123" -> "49000-123"; aceita texto parcial. */
export function maskCep(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

export function formatDays(daysMin: number, daysMax: number): string {
  if (daysMax === 0) return 'No mesmo dia';
  if (daysMax === 1 && daysMin === 1) return '1 dia útil';
  if (daysMin === daysMax) return `${daysMax} dias úteis`;
  if (daysMin === 0) return daysMax === 1 ? 'Até 1 dia útil' : `Até ${daysMax} dias úteis`;
  return `${daysMin} a ${daysMax} dias úteis`;
}
