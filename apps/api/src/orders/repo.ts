// Acesso ao banco para pedidos do cliente, perfil e favoritos. Usa a chave de serviço do Worker
// (R3.2); o filtro por dono (customer_user_id / user_id) é feito aqui, sempre com o id do JWT.
// Toda resposta do banco passa por Zod antes de ser usada (R3.5). Sem detalhes do banco nos erros.
import {
  type OrderRow,
  type Profile,
  type ProfileInput,
  addressSchema,
  orderRowsSchema,
  profileRowSchema,
} from '@sparks/shared';
import { z } from 'zod';
import type { Config } from '../env';
import { getServiceClient } from '../lib/supabase';

export interface OrdersRepo {
  findByTokenHash(tokenHash: string): Promise<OrderRow | null>;
  /** Uma só consulta com código E WhatsApp: "não existe" e "não bate" são o mesmo resultado. */
  findByCodeAndWhatsapp(code: string, whatsapp: string): Promise<OrderRow | null>;
  findByUserAndCode(userId: string, code: string): Promise<OrderRow | null>;
  listByUser(userId: string): Promise<OrderRow[]>;
  /** Liga o pedido à conta se ele ainda não tem dono (ou já é dela). false = não encontrado. */
  claimByTokenHash(tokenHash: string, userId: string): Promise<boolean>;
  getProfile(userId: string): Promise<Profile>;
  saveProfile(userId: string, input: ProfileInput): Promise<void>;
  listFavorites(userId: string): Promise<string[]>;
  /** Troca os favoritos da conta pelos ids dados (ids de produtos que não existem são ignorados). */
  replaceFavorites(userId: string, ids: string[]): Promise<string[]>;
}

const ORDER_COLUMNS = [
  'code',
  'status',
  'customer_user_id',
  'customer_name',
  'address',
  'shipping_service',
  'shipping_label',
  'shipping_carrier',
  'shipping_cents',
  'shipping_days_min',
  'shipping_days_max',
  'tracking_code',
  'subtotal_cents',
  'discount_cents',
  'gift_wrap_cents',
  'total_cents',
  'payment_method',
  'paid_at',
  'reserved_until',
  'created_at',
  'order_items(name_snapshot, unit_price_cents, qty)',
  'order_events(to_status, created_at)',
].join(', ');

const MY_ORDERS_LIMIT = 50;
const idRowsSchema = z.array(z.object({ id: z.uuid() }));
const favoriteRowsSchema = z.array(z.object({ product_id: z.uuid() }));

function fail(what: string): never {
  // Só o que falhou: a mensagem do banco pode trazer dados do cliente.
  throw new Error(`orders_repo_${what}`);
}

export function supabaseOrdersRepo(config: Config): OrdersRepo {
  const db = getServiceClient(config);

  return {
    async findByTokenHash(tokenHash) {
      const { data, error } = await db
        .from('orders')
        .select(ORDER_COLUMNS)
        .eq('token_hash', tokenHash)
        .limit(1);
      if (error) fail('by_token');
      return orderRowsSchema.parse(data)[0] ?? null;
    },

    async findByCodeAndWhatsapp(code, whatsapp) {
      const { data, error } = await db
        .from('orders')
        .select(ORDER_COLUMNS)
        .eq('code', code)
        .eq('customer_whatsapp', whatsapp)
        .limit(1);
      if (error) fail('lookup');
      return orderRowsSchema.parse(data)[0] ?? null;
    },

    async findByUserAndCode(userId, code) {
      const { data, error } = await db
        .from('orders')
        .select(ORDER_COLUMNS)
        .eq('customer_user_id', userId)
        .eq('code', code)
        .limit(1);
      if (error) fail('by_user');
      return orderRowsSchema.parse(data)[0] ?? null;
    },

    async listByUser(userId) {
      const { data, error } = await db
        .from('orders')
        .select(ORDER_COLUMNS)
        .eq('customer_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(MY_ORDERS_LIMIT);
      if (error) fail('list');
      return orderRowsSchema.parse(data);
    },

    async claimByTokenHash(tokenHash, userId) {
      const { data, error } = await db
        .from('orders')
        .update({ customer_user_id: userId })
        .eq('token_hash', tokenHash)
        // userId vem do JWT já validado (uuid): não há texto do usuário neste filtro.
        .or(`customer_user_id.is.null,customer_user_id.eq.${userId}`)
        .select('id');
      if (error) fail('claim');
      return idRowsSchema.parse(data).length > 0;
    },

    async getProfile(userId) {
      const { data, error } = await db
        .from('profiles')
        .select('name, whatsapp, default_address')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) fail('profile');
      if (!data) return { name: null, whatsapp: null, defaultAddress: null };
      const row = profileRowSchema.parse(data);
      const address = addressSchema.safeParse(row.default_address);
      return {
        name: row.name,
        whatsapp: row.whatsapp,
        defaultAddress: address.success ? address.data : null,
      };
    },

    async saveProfile(userId, input) {
      const { error } = await db.from('profiles').upsert(
        {
          user_id: userId,
          name: input.name,
          whatsapp: input.whatsapp,
          default_address: input.defaultAddress,
        },
        { onConflict: 'user_id' },
      );
      if (error) fail('save_profile');
    },

    async listFavorites(userId) {
      const { data, error } = await db
        .from('favorites')
        .select('product_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (error) fail('favorites');
      return favoriteRowsSchema.parse(data).map((r) => r.product_id);
    },

    async replaceFavorites(userId, ids) {
      let valid: string[] = [];
      if (ids.length > 0) {
        const { data, error } = await db
          .from('products')
          .select('id')
          .in('id', ids)
          .is('deleted_at', null);
        if (error) fail('favorites_products');
        const found = new Set(idRowsSchema.parse(data).map((r) => r.id));
        valid = ids.filter((id) => found.has(id));
      }
      const current = await this.listFavorites(userId);
      const toRemove = current.filter((id) => !valid.includes(id));
      if (toRemove.length > 0) {
        const { error } = await db
          .from('favorites')
          .delete()
          .eq('user_id', userId)
          .in('product_id', toRemove);
        if (error) fail('favorites_delete');
      }
      if (valid.length > 0) {
        const { error } = await db.from('favorites').upsert(
          valid.map((product_id) => ({ user_id: userId, product_id })),
          { onConflict: 'user_id,product_id', ignoreDuplicates: true },
        );
        if (error) fail('favorites_upsert');
      }
      return valid;
    },
  };
}
