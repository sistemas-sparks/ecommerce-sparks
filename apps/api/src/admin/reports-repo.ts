// Relatório de lucro no painel (T-020). Só leitura: chama a função SQL `admin_profit_report`
// (supabase/migrations/20261113000001_admin_reports.sql) com a chave de serviço do Worker (R3.2).
// A resposta do banco passa por Zod (R3.5). O erro não carrega texto do banco.
import { PRODUCT_LIST_LIMIT, type ProfitRaw, type ProfitReportQuery } from '@sparks/shared';
import { z } from 'zod';
import type { Config } from '../env';
import { getServiceClient } from '../lib/supabase';

export interface AdminReportsRepo {
  profit(query: ProfitReportQuery): Promise<ProfitRaw>;
}

const n = z.number().int().min(0);
const rawSchema = z.object({
  buckets: z.array(
    z.object({
      bucket: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
      orders: n,
      units: n,
      sales_cents: n,
      sales_costed_cents: n,
      cost_cents: n,
      units_uncosted: n,
      sales_uncosted_cents: n,
      discount_cents: n,
      discount_uncosted_cents: n,
      shipping_cents: n,
      gift_wrap_cents: n,
    }),
  ),
  products: z
    .array(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1),
        units: n,
        sales_cents: n,
        sales_costed_cents: n,
        cost_cents: n,
        units_uncosted: n,
      }),
    )
    .max(PRODUCT_LIST_LIMIT),
  products_count: n,
});

export function supabaseAdminReportsRepo(config: Config): AdminReportsRepo {
  const db = getServiceClient(config);
  return {
    async profit(query) {
      const { data, error } = await db.rpc('admin_profit_report', {
        p_from: query.from,
        p_to: query.to,
        p_group: query.groupBy,
      });
      // Só o que falhou: a mensagem do banco pode trazer dados do pedido.
      if (error) throw new Error('admin_reports_repo_profit');
      const raw = rawSchema.parse(data);
      return {
        buckets: raw.buckets.map((b) => ({
          bucket: b.bucket,
          orders: b.orders,
          units: b.units,
          salesCents: b.sales_cents,
          salesCostedCents: b.sales_costed_cents,
          costCents: b.cost_cents,
          unitsUncosted: b.units_uncosted,
          salesUncostedCents: b.sales_uncosted_cents,
          discountCents: b.discount_cents,
          discountUncostedCents: b.discount_uncosted_cents,
          shippingCents: b.shipping_cents,
          giftWrapCents: b.gift_wrap_cents,
        })),
        products: raw.products.map((p) => ({
          key: p.key,
          name: p.name,
          units: p.units,
          salesCents: p.sales_cents,
          salesCostedCents: p.sales_costed_cents,
          costCents: p.cost_cents,
          unitsUncosted: p.units_uncosted,
        })),
        productsCount: raw.products_count,
      };
    },
  };
}
