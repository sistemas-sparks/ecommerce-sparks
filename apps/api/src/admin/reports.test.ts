import type { ProfitRaw } from '@sparks/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { createTestKey, signToken, testEnv, type TestKey } from '../test-utils';
import type { AdminReportsRepo } from './reports-repo';

let key: TestKey;
let repo: AdminReportsRepo;
let raw: ProfitRaw;

beforeAll(async () => {
  key = await createTestKey();
});

beforeEach(() => {
  raw = {
    buckets: [
      {
        bucket: '2026-11-03',
        orders: 2,
        units: 5,
        salesCents: 10_000,
        salesCostedCents: 8_000,
        costCents: 4_000,
        unitsUncosted: 1,
        salesUncostedCents: 2_000,
        discountCents: 500,
        discountUncostedCents: 100,
        shippingCents: 3_000,
        giftWrapCents: 300,
      },
    ],
    products: [
      {
        key: 'p1',
        name: 'Caderno',
        units: 5,
        salesCents: 10_000,
        salesCostedCents: 8_000,
        costCents: 4_000,
        unitsUncosted: 1,
      },
    ],
    productsCount: 1,
  };
  repo = { profit: vi.fn(async () => raw) };
});

async function request(
  query: string,
  opts: { role?: string | null; aal?: string; allow?: boolean; method?: string } = {},
) {
  const role = opts.role === undefined ? 'admin' : opts.role;
  const token =
    role === null
      ? null
      : await signToken(key, { app_metadata: { role }, aal: opts.aal ?? 'aal2' });
  const app = createApp({
    adminReportsRepo: () => repo,
    getJwks: async () => [key.publicJwk],
    rateLimitHit: async () => opts.allow ?? true,
  });
  return app.request(
    `/admin/reports/profit${query}`,
    {
      method: opts.method ?? 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
    testEnv,
  );
}
const errorCode = async (r: Response) =>
  ((await r.json()) as { error: { code: string } }).error.code;

const GOOD = '?from=2026-11-01&to=2026-11-05&groupBy=day';

describe('GET /admin/reports/profit', () => {
  it('recusa sem login (401), sem papel admin (403) e sem segunda etapa (403), antes do banco', async () => {
    expect((await request(GOOD, { role: null })).status).toBe(401);
    expect((await request(GOOD, { role: 'customer' })).status).toBe(403);
    const noMfa = await request(GOOD, { aal: 'aal1' });
    expect(noMfa.status).toBe(403);
    expect(await errorCode(noMfa)).toBe('mfa_required');
    expect(repo.profit).not.toHaveBeenCalled();
  });

  it('aplica o limite de requisições (429) antes de tocar no banco', async () => {
    expect((await request(GOOD, { allow: false })).status).toBe(429);
    expect(repo.profit).not.toHaveBeenCalled();
  });

  it('só aceita leitura: POST não existe', async () => {
    expect((await request(GOOD, { method: 'POST' })).status).toBe(404);
    expect(repo.profit).not.toHaveBeenCalled();
  });

  it.each([
    ['sem datas', ''],
    ['data inválida', '?from=2026-02-30&to=2026-03-01'],
    ['formato errado', '?from=01/11/2026&to=05/11/2026'],
    ['fim antes do início', '?from=2026-11-05&to=2026-11-01'],
    ['mais de 366 dias', '?from=2025-01-01&to=2026-11-01'],
    ['agrupamento inválido', '?from=2026-11-01&to=2026-11-05&groupBy=year'],
    ['injeção no parâmetro', '?from=2026-11-01%27%3B%20drop%20table%20orders%3B--&to=2026-11-05'],
  ])('recusa período inválido (%s) com 400, sem consultar o banco', async (_name, query) => {
    const r = await request(query);
    expect(r.status).toBe(400);
    expect(await errorCode(r)).toBe('invalid_input');
    expect(repo.profit).not.toHaveBeenCalled();
  });

  it('calcula lucro e margem no servidor: item sem custo fica fora do lucro', async () => {
    const r = await request(GOOD);
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(repo.profit).toHaveBeenCalledWith({
      from: '2026-11-01',
      to: '2026-11-05',
      groupBy: 'day',
    });
    const body = (await r.json()) as {
      totals: Record<string, unknown>;
      series: { key: string }[];
      products: { profitCents: number }[];
    };
    // lucro = 8.000 (vendas com custo) - 4.000 (custo) - 400 (desconto dos itens com custo:
    // 500 no total, 100 rateados aos itens sem custo)
    expect(body.totals).toMatchObject({
      salesCents: 10_000,
      discountCents: 500,
      netSalesCents: 9_500,
      costCents: 4_000,
      profitCents: 3_600,
      marginPermille: 474, // 3.600 / 7.600 = 47,37%
      uncosted: { units: 1, salesCents: 1_900 }, // 2.000 - 100 de desconto rateado
      shippingCents: 3_000,
      giftWrapCents: 300,
    });
    expect(body.series.map((s) => s.key)).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ]);
    expect(body.products[0]).toMatchObject({ profitCents: 4_000 });
  });

  it('erro do banco vira 500 genérico, sem texto do banco', async () => {
    repo.profit = vi.fn(async () => {
      throw new Error('admin_reports_repo_profit');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await request(GOOD);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('admin_reports_repo');
  });
});
