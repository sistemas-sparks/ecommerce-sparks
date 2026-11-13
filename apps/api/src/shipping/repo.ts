import {
  shippingAdminDataSchema,
  shippingHybridDataSchema,
  shippingHybridAdminDataSchema,
  shippingMeServiceWriteResultSchema,
  shippingProductRowsSchema,
  shippingCouponRowSchema,
  shippingWriteResultSchema,
  shippingPackageWriteResultSchema,
  shippingSettingsWriteResultSchema,
  type ShippingAdminData,
  type ShippingCouponRow,
  type ShippingAdminEntity,
  type ShippingEntity,
  type ShippingHybridAdminData,
  type ShippingHybridSettingsInput,
  type ShippingHybridData,
  type ShippingProductRow,
} from '@sparks/shared';
import type { Config } from '../env';
import { getServiceClient } from '../lib/supabase';
import { apiError } from '../lib/errors';

export interface ShippingRepo {
  load(): Promise<ShippingAdminData>;
  /**
   * Dados do painel do frete híbrido: tudo, inclusive inativos.
   */
  loadAdmin(): Promise<ShippingHybridAdminData>;
  /** Dados do motor híbrido: só tipos/áreas ativos e serviços habilitados. */
  loadHybrid(): Promise<ShippingHybridData>;
  products(ids: string[]): Promise<ShippingProductRow[]>;
  coupon(code: string): Promise<ShippingCouponRow | null>;
  save(
    entity: ShippingEntity | ShippingAdminEntity,
    id: string | null,
    data: Record<string, unknown>,
    actor: string,
  ): Promise<void>;
  remove(entity: ShippingEntity | ShippingAdminEntity, id: string, actor: string): Promise<void>;
  settings(data: ShippingHybridSettingsInput, actor: string): Promise<void>;
}
const TABLES = {
  zones: 'shipping_zones',
  rates: 'shipping_rates',
  'local-rules': 'shipping_local_rules',
  exceptions: 'shipping_cep_exceptions',
  'package-sizes': 'package_sizes',
  'own-types': 'shipping_own_types',
  'own-areas': 'shipping_own_areas',
  'me-services': 'melhor_envio_services',
} as const;
function keyOf(entity: keyof typeof TABLES): string {
  if (entity === 'package-sizes') return 'size';
  return entity === 'me-services' ? 'service_id' : 'id';
}
function check(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === 'PGRST116')
    throw apiError(404, 'not_found', 'Configuração de frete não encontrada.');
  if (['23505', '23503', '23514'].includes(error.code ?? ''))
    throw apiError(
      409,
      'shipping_conflict',
      'Confira os dados: há um cadastro repetido ou uma configuração vinculada.',
    );
  throw apiError(503, 'unavailable', 'Não foi possível acessar as configurações de frete.');
}
export function supabaseShippingRepo(config: Config): ShippingRepo {
  const db = getServiceClient(config);
  const audit = async (actor: string, action: string, entity: string, entityId: string | null) => {
    const { error } = await db
      .from('audit_log')
      .insert({ actor, action, entity, entity_id: entityId, diff: {} });
    check(error);
  };
  return {
    async load() {
      const [uf, zones, rates, local, exceptions, sizes, settings] = await Promise.all([
        db.from('uf_cep_ranges').select('uf,cep_start,cep_end'),
        db.from('shipping_zones').select('id,name,ufs,active').order('name'),
        db
          .from('shipping_rates')
          .select('id,zone_id,service,max_weight_g,price_cents,days_min,days_max')
          .order('max_weight_g'),
        db
          .from('shipping_local_rules')
          .select('id,label,cep_start,cep_end,price_cents,days_min,days_max,active')
          .order('cep_start'),
        db
          .from('shipping_cep_exceptions')
          .select('id,cep_start,cep_end,action,value,note')
          .order('cep_start'),
        db.from('package_sizes').select('size,weight_g,length_cm,width_cm,height_cm'),
        db
          .from('settings')
          .select(
            'origin_cep,origin_uf,handling_days,free_shipping_min_cents,max_items_auto_shipping,max_weight_auto_g,package_tare_g,cubic_divisor,gift_wrap_enabled',
          )
          .eq('id', 1)
          .single(),
      ]);
      for (const result of [uf, zones, rates, local, exceptions, sizes, settings])
        check(result.error);
      return shippingAdminDataSchema.parse({
        uf_ranges: uf.data,
        zones: zones.data,
        rates: rates.data,
        local_rules: local.data,
        exceptions: exceptions.data,
        package_sizes: sizes.data,
        settings: settings.data,
      });
    },
    async loadAdmin() {
      const [exceptions, sizes, settings, types, areas, services] = await Promise.all([
        db
          .from('shipping_cep_exceptions')
          .select('id,cep_start,cep_end,action,value,note')
          .order('cep_start'),
        db.from('package_sizes').select('size,weight_g,length_cm,width_cm,height_cm'),
        db
          .from('settings')
          .select(
            'origin_cep,origin_uf,handling_days,free_shipping_min_cents,max_items_auto_shipping,max_weight_auto_g,package_tare_g,cubic_divisor,gift_wrap_enabled,melhor_envio_margin_cents',
          )
          .eq('id', 1)
          .single(),
        db.from('shipping_own_types').select('id,name,active,sort_order').order('sort_order'),
        db
          .from('shipping_own_areas')
          .select('id,type_id,label,cep_start,cep_end,price_cents,days_min,days_max,active')
          .order('cep_start'),
        db
          .from('melhor_envio_services')
          .select('service_id,name,carrier,enabled,sort_order')
          .order('sort_order'),
      ]);
      for (const result of [exceptions, sizes, settings, types, areas, services])
        check(result.error);
      return shippingHybridAdminDataSchema.parse({
        exceptions: exceptions.data,
        package_sizes: sizes.data,
        settings: settings.data,
        own_types: types.data,
        own_areas: areas.data,
        me_services: services.data,
      });
    },
    async loadHybrid() {
      const [exceptions, sizes, settings, types, areas, services] = await Promise.all([
        db
          .from('shipping_cep_exceptions')
          .select('id,cep_start,cep_end,action,value,note')
          .order('cep_start'),
        db.from('package_sizes').select('size,weight_g,length_cm,width_cm,height_cm'),
        db
          .from('settings')
          .select(
            'origin_cep,origin_uf,handling_days,free_shipping_min_cents,max_items_auto_shipping,max_weight_auto_g,package_tare_g,cubic_divisor,gift_wrap_enabled,melhor_envio_margin_cents',
          )
          .eq('id', 1)
          .single(),
        db
          .from('shipping_own_types')
          .select('id,name,active,sort_order')
          .eq('active', true)
          .order('sort_order'),
        db
          .from('shipping_own_areas')
          .select('id,type_id,label,cep_start,cep_end,price_cents,days_min,days_max,active')
          .eq('active', true)
          .order('cep_start'),
        db
          .from('melhor_envio_services')
          .select('service_id,name,carrier,enabled,sort_order')
          .eq('enabled', true)
          .order('sort_order'),
      ]);
      for (const result of [exceptions, sizes, settings, types, areas, services])
        check(result.error);
      return shippingHybridDataSchema.parse({
        exceptions: exceptions.data,
        package_sizes: sizes.data,
        settings: settings.data,
        own_types: types.data,
        own_areas: areas.data,
        melhor_envio_services: services.data,
      });
    },
    async products(ids) {
      const { data, error } = await db
        .from('products')
        .select(
          'id,price_cents,stock,active,kind,deleted_at,weight_g,package_size,length_cm,width_cm,height_cm',
        )
        .in('id', ids);
      check(error);
      return shippingProductRowsSchema.parse(data);
    },
    async coupon(code) {
      const { data, error } = await db
        .from('coupons')
        .select('type,value,min_order_cents,max_uses,used_count,active,starts_at,ends_at')
        .eq('code', code)
        .is('deleted_at', null)
        .maybeSingle();
      check(error);
      return data === null ? null : shippingCouponRowSchema.parse(data);
    },
    async save(entity, id, data, actor) {
      const table = TABLES[entity];
      const key = keyOf(entity);
      if (entity === 'me-services' && id === null)
        throw apiError(400, 'invalid_input', 'Serviço do Melhor Envio não pode ser criado.');
      const result = id
        ? await db.from(table).update(data).eq(key, id).select(key).single()
        : await db.from(table).insert(data).select('id').single();
      check(result.error);
      let entityId: string | null = null;
      if (entity === 'package-sizes') shippingPackageWriteResultSchema.parse(result.data);
      else if (entity === 'me-services')
        entityId = String(shippingMeServiceWriteResultSchema.parse(result.data).service_id);
      else entityId = shippingWriteResultSchema.parse(result.data).id;
      await audit(actor, id ? 'update' : 'create', table, entityId);
    },
    async remove(entity, id, actor) {
      const result = await db.from(TABLES[entity]).delete().eq('id', id).select('id').single();
      check(result.error);
      shippingWriteResultSchema.parse(result.data);
      await audit(actor, 'delete', TABLES[entity], id);
    },
    async settings(data, actor) {
      const result = await db.from('settings').update(data).eq('id', 1).select('id').single();
      check(result.error);
      shippingSettingsWriteResultSchema.parse(result.data);
      await audit(actor, 'update', 'shipping_settings', null);
    },
  };
}
