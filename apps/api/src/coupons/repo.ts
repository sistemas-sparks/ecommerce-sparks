import {
  couponAdminRowSchema,
  type CouponAdminCreate,
  type CouponAdminRow,
  type CouponAdminUpdate,
} from '@sparks/shared';
import { z } from 'zod';
import type { Config } from '../env';
import { MESSAGES, apiError } from '../lib/errors';
import { getServiceClient } from '../lib/supabase';

export interface CouponsRepo {
  list(): Promise<CouponAdminRow[]>;
  create(input: CouponAdminCreate, actor: string): Promise<CouponAdminRow>;
  update(id: string, input: CouponAdminUpdate, actor: string): Promise<CouponAdminRow>;
  remove(id: string, actor: string): Promise<void>;
}

const COLUMNS =
  'id,code,type,value,min_order_cents,max_uses,used_count,starts_at,ends_at,active,created_at';

const dbRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  type: z.string(),
  value: z.number(),
  min_order_cents: z.number().nullable(),
  max_uses: z.number().nullable(),
  used_count: z.number(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  active: z.boolean(),
  created_at: z.string(),
});

function toRow(data: unknown): CouponAdminRow {
  const r = dbRowSchema.parse(data);
  return couponAdminRowSchema.parse({
    id: r.id,
    code: r.code,
    type: r.type,
    value: r.value,
    minOrderCents: r.min_order_cents,
    maxUses: r.max_uses,
    usedCount: r.used_count,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    active: r.active,
    createdAt: r.created_at,
  });
}

const unavailable = () => apiError(503, 'unavailable', MESSAGES.unavailable);
const notFound = () => apiError(404, 'not_found', MESSAGES.notFound);

/** Traduz erros do Postgres; qualquer outro vira 503 sem vazar detalhe. */
function mapError(error: { code?: string }) {
  if (error.code === '23505')
    return apiError(409, 'coupon_code_taken', 'Já existe um cupom com esse código. Escolha outro.');
  if (error.code === '23514')
    return apiError(
      422,
      'coupon_max_uses_below_used',
      'O limite não pode ser menor que os usos já feitos.',
    );
  return unavailable();
}

function fields(input: CouponAdminUpdate) {
  return {
    type: input.type,
    value: input.value,
    min_order_cents: input.minOrderCents,
    max_uses: input.maxUses,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    active: input.active,
  };
}

export function supabaseCouponsRepo(config: Config): CouponsRepo {
  const db = getServiceClient(config);
  // Sem dado pessoal: só os campos do cupom.
  const audit = async (
    actor: string,
    action: 'create' | 'update' | 'delete',
    id: string,
    diff: Record<string, unknown>,
  ) => {
    const result = await db
      .from('audit_log')
      .insert({ actor, action, entity: 'coupon', entity_id: id, diff });
    if (result.error) throw unavailable();
  };
  return {
    async list() {
      const { data, error } = await db
        .from('coupons')
        .select(COLUMNS)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw unavailable();
      return (data ?? []).map(toRow);
    },
    async create(input, actor) {
      const { data, error } = await db
        .from('coupons')
        .insert({ code: input.code, ...fields(input) })
        .select(COLUMNS)
        .single();
      if (error) throw mapError(error);
      const row = toRow(data);
      await audit(actor, 'create', row.id, { code: input.code, ...fields(input) });
      return row;
    },
    async update(id, input, actor) {
      const { data, error } = await db
        .from('coupons')
        .update({ ...fields(input), updated_at: new Date().toISOString() })
        .eq('id', id)
        .is('deleted_at', null)
        .select(COLUMNS)
        .maybeSingle();
      if (error) throw mapError(error);
      if (data === null) throw notFound();
      const row = toRow(data);
      await audit(actor, 'update', row.id, { code: row.code, ...fields(input) });
      return row;
    },
    async remove(id, actor) {
      const now = new Date().toISOString();
      const { data, error } = await db
        .from('coupons')
        .update({ deleted_at: now, active: false, updated_at: now })
        .eq('id', id)
        .is('deleted_at', null)
        .select('id,code')
        .maybeSingle();
      if (error) throw unavailable();
      if (data === null) throw notFound();
      const gone = z.object({ id: z.string(), code: z.string() }).parse(data);
      await audit(actor, 'delete', gone.id, { code: gone.code });
    },
  };
}
