// Acesso ao banco para o checkout. A interface permite trocar por uma versão em memória nos testes.
// Toda resposta do banco passa por Zod (packages/shared) antes de ser usada (R3.5).
import {
  type CreateOrderResult,
  type HybridShippingConfig,
  type PackageSize,
  checkoutProductRowsSchema,
  createOrderResultSchema,
  shippingCouponRowSchema,
} from '@sparks/shared';
import type { Config } from '../env';
import { getServiceClient } from '../lib/supabase';
import { toHybridShippingConfig } from '../shipping/config';
import { supabaseShippingRepo } from '../shipping/repo';

export interface CheckoutProduct {
  id: string;
  name: string;
  priceCents: number;
  stock: number;
  kind: 'regular' | 'gift_wrap';
  active: boolean;
  deleted: boolean;
  weightG: number | null;
  packageSize: PackageSize;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
}

export interface CheckoutCoupon {
  type: 'percent' | 'fixed';
  value: number;
  minOrderCents: number | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  maxUses: number | null;
  usedCount: number;
}

export interface CheckoutContext {
  shipping: HybridShippingConfig;
  giftWrapEnabled: boolean;
}

/** Payload de public.create_order (ver supabase/migrations/20261007000001_checkout.sql). */
export interface CreateOrderPayload {
  code: string;
  token_hash: string;
  customer_user_id: string | null;
  customer_name: string;
  customer_whatsapp: string;
  customer_email: string | null;
  address: Record<string, unknown>;
  address_type: string;
  items: { product_id: string; qty: number }[];
  coupon_code: string | null;
  gift_wrap_product_id: string | null;
  gift_message: string | null;
  shipping: {
    service: string;
    cents: number;
    days_min: number;
    days_max: number;
    label: string;
    carrier: string | null;
  } | null;
  expected_subtotal_cents: number;
  expected_discount_cents: number;
  reserve_minutes: number;
}

export type CreatedOrder = CreateOrderResult;

/** Erro de negócio vindo do banco (mensagem = código fixo) ou de código de pedido repetido. */
export class CheckoutDbError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string | null = null,
  ) {
    super(code);
    this.name = 'CheckoutDbError';
  }
}

export interface CheckoutRepo {
  loadProducts(ids: string[]): Promise<CheckoutProduct[]>;
  loadCoupon(code: string): Promise<CheckoutCoupon | null>;
  loadContext(): Promise<CheckoutContext>;
  createOrder(payload: CreateOrderPayload): Promise<CreatedOrder>;
  attachPreference(orderId: string, preferenceId: string): Promise<void>;
  releaseOrder(orderId: string, status: 'canceled' | 'expired', actor: string): Promise<void>;
}

const CONTEXT_TTL_MS = 60 * 1000;
let contextCache: { key: string; value: CheckoutContext; expiresAt: number } | null = null;

const BUSINESS_ERRORS = new Set([
  'invalid_payload',
  'too_many_pending',
  'product_unavailable',
  'out_of_stock',
  'gift_wrap_unavailable',
  'coupon_invalid',
  'coupon_min_order',
  'totals_changed',
]);

function fail(what: string): never {
  // Sem detalhes do banco no erro (podem conter dados): só o que falhou.
  throw new Error(`checkout_repo_${what}`);
}

export function supabaseCheckoutRepo(config: Config): CheckoutRepo {
  const db = getServiceClient(config);

  return {
    async loadProducts(ids) {
      const { data, error } = await db
        .from('products')
        .select(
          'id, name, price_cents, stock, kind, active, deleted_at, weight_g, package_size, length_cm, width_cm, height_cm',
        )
        .in('id', ids);
      if (error) fail('products');
      return checkoutProductRowsSchema.parse(data).map((p) => ({
        id: p.id,
        name: p.name,
        priceCents: p.price_cents,
        stock: p.stock,
        kind: p.kind,
        active: p.active,
        deleted: p.deleted_at !== null,
        weightG: p.weight_g,
        packageSize: p.package_size,
        lengthCm: p.length_cm,
        widthCm: p.width_cm,
        heightCm: p.height_cm,
      }));
    },

    async loadCoupon(code) {
      const { data, error } = await db
        .from('coupons')
        .select('type, value, min_order_cents, active, starts_at, ends_at, max_uses, used_count')
        .eq('code', code)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) fail('coupon');
      if (!data) return null;
      const c = shippingCouponRowSchema.parse(data);
      return {
        type: c.type,
        value: c.value,
        minOrderCents: c.min_order_cents,
        active: c.active,
        startsAt: c.starts_at,
        endsAt: c.ends_at,
        maxUses: c.max_uses,
        usedCount: c.used_count,
      };
    },

    // Mesmas tabelas e validação da cotação de frete (T-012). Mudam pouco: cache de 1 minuto.
    async loadContext() {
      const key = config.supabaseUrl;
      if (contextCache?.key === key && contextCache.expiresAt > Date.now())
        return contextCache.value;
      const data = await supabaseShippingRepo(config).loadHybrid();
      const value: CheckoutContext = {
        shipping: toHybridShippingConfig(data),
        giftWrapEnabled: data.settings.gift_wrap_enabled,
      };
      contextCache = { key, value, expiresAt: Date.now() + CONTEXT_TTL_MS };
      return value;
    },

    async createOrder(payload) {
      const { data, error } = await db.rpc('create_order', { p: payload });
      if (error) {
        if (error.code === '23505') throw new CheckoutDbError('duplicate_code');
        if (BUSINESS_ERRORS.has(error.message)) {
          throw new CheckoutDbError(error.message, error.details || null);
        }
        fail('create_order');
      }
      return createOrderResultSchema.parse(data);
    },

    async attachPreference(orderId, preferenceId) {
      const { error } = await db
        .from('orders')
        .update({ mp_preference_id: preferenceId })
        .eq('id', orderId);
      if (error) fail('attach_preference');
    },

    async releaseOrder(orderId, status, actor) {
      const { error } = await db.rpc('release_order', {
        p_order_id: orderId,
        p_status: status,
        p_actor: actor,
      });
      if (error) fail('release_order');
    },
  };
}
