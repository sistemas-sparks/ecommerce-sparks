import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../env';
import { testEnv } from '../test-utils';
import { supabaseAdminReportsRepo } from './reports-repo';

afterEach(() => vi.unstubAllGlobals());

function setup(respond: () => Response) {
  const seen: { url: URL; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const raw = await request.text();
      seen.push({ url: new URL(request.url), body: raw ? JSON.parse(raw) : null });
      return respond();
    }),
  );
  const repo = supabaseAdminReportsRepo(
    loadConfig({ ...testEnv, SUPABASE_SERVICE_ROLE_KEY: `reports-repo-${crypto.randomUUID()}` }),
  );
  return { repo, seen };
}

const bucket = {
  bucket: '2026-11-03',
  orders: 1,
  units: 2,
  sales_cents: 5000,
  sales_costed_cents: 5000,
  cost_cents: 2000,
  units_uncosted: 0,
  sales_uncosted_cents: 0,
  discount_cents: 0,
  discount_uncosted_cents: 0,
  shipping_cents: 1500,
  gift_wrap_cents: 0,
};
const query = { from: '2026-11-01', to: '2026-11-30', groupBy: 'day' } as const;

describe('relatório de lucro (consulta ao banco)', () => {
  it('chama só a função de leitura com datas e agrupamento e converte as somas', async () => {
    const { repo, seen } = setup(() =>
      Response.json({ buckets: [bucket], products: [], products_count: 0 }),
    );
    const raw = await repo.profit({ ...query, groupBy: 'month' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url.pathname).toBe('/rest/v1/rpc/admin_profit_report');
    expect(seen[0]!.body).toEqual({ p_from: '2026-11-01', p_to: '2026-11-30', p_group: 'month' });
    expect(raw.buckets[0]).toMatchObject({
      bucket: '2026-11-03',
      salesCents: 5000,
      shippingCents: 1500,
    });
  });

  it('erro do banco vira erro genérico, sem a mensagem do banco', async () => {
    const { repo } = setup(() =>
      Response.json({ message: 'Maria Silva 79999991234', code: 'P0001' }, { status: 400 }),
    );
    const err = await repo.profit(query).catch((e: unknown) => e);
    expect(String(err)).toBe('Error: admin_reports_repo_profit');
  });

  it('resposta fora do formato é recusada (Zod)', async () => {
    const { repo } = setup(() =>
      Response.json({
        buckets: [{ ...bucket, sales_cents: -1 }],
        products: [],
        products_count: 0,
      }),
    );
    await expect(repo.profit(query)).rejects.toThrow();
  });
});
