import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, createTestDb, USER_A } from './db';

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

const row = (line: number, slug: string, overrides: Record<string, unknown> = {}) => ({
  line,
  slug,
  name: `Produto ${slug}`,
  description: '',
  category_id: null,
  kind: 'regular',
  price_cents: 1000,
  cost_cents: 500,
  stock: 5,
  weight_g: null,
  package_size: 'P',
  length_cm: null,
  width_cm: null,
  height_cm: null,
  active: false,
  featured: false,
  badge: null,
  ...overrides,
});
const run = (rows: unknown[]) =>
  asRole(db, 'service_role', null, async () => {
    const result = await db.query<{ result: Record<string, number> }>(
      `select public.admin_products_import($1::jsonb, $2) as result`,
      [JSON.stringify(rows), USER_A],
    );
    return result.rows[0]!.result;
  });
const count = async (slugs: string[]) =>
  Number(
    (
      await db.query<{ n: string }>(
        `select count(*) as n from public.products where slug = any($1)`,
        [slugs],
      )
    ).rows[0]!.n,
  );

describe('importação de produtos (função SQL)', () => {
  it('clientes e anônimos não executam a função', async () => {
    for (const role of ['anon', 'authenticated'] as const)
      await expect(
        asRole(db, role, USER_A, () =>
          db.query(`select public.admin_products_import('[]'::jsonb, $1)`, [USER_A]),
        ),
      ).rejects.toThrow(/permission denied/);
  });

  it('cria, é idempotente, atualiza sem tocar no estoque e audita', async () => {
    expect(await run([row(2, 'imp-a'), row(3, 'imp-b')])).toEqual({
      created: 2,
      updated: 0,
      unchanged: 0,
    });
    const before = (
      await db.query<{ updated_at: string }>(
        `select updated_at::text from public.products where slug='imp-a'`,
      )
    ).rows[0]!.updated_at;
    expect(await run([row(2, 'imp-a'), row(3, 'imp-b')])).toEqual({
      created: 0,
      updated: 0,
      unchanged: 2,
    });
    expect(
      (
        await db.query<{ updated_at: string }>(
          `select updated_at::text from public.products where slug='imp-a'`,
        )
      ).rows[0]!.updated_at,
    ).toBe(before);

    await db.query(`update public.products set stock = 1 where slug = 'imp-a'`);
    expect(await run([row(2, 'imp-a', { price_cents: 2500, stock: 99 })])).toEqual({
      created: 0,
      updated: 1,
      unchanged: 0,
    });
    const product = (
      await db.query<{ price_cents: number; stock: number }>(
        `select price_cents, stock from public.products where slug='imp-a'`,
      )
    ).rows[0]!;
    expect(product).toEqual({ price_cents: 2500, stock: 1 });
    const audits = await db.query(
      `select 1 from public.audit_log where entity='products' and diff->>'source'='csv_import'`,
    );
    expect(audits.rows.length).toBe(3);
  });

  it('é tudo ou nada: uma linha inválida desfaz as anteriores e informa a linha', async () => {
    await expect(
      run([row(2, 'tx-a'), row(3, 'tx-b'), row(4, 'tx-c', { price_cents: -1 })]),
    ).rejects.toMatchObject({ message: 'import_row_failed', detail: '4' });
    expect(await count(['tx-a', 'tx-b', 'tx-c'])).toBe(0);
  });

  it('recusa slug de produto excluído, apontando a linha', async () => {
    await run([row(2, 'removido')]);
    await db.query(`update public.products set deleted_at = now() where slug = 'removido'`);
    await expect(run([row(2, 'novo-x'), row(3, 'removido')])).rejects.toMatchObject({
      message: 'import_slug_removed',
      detail: '3',
    });
    expect(await count(['novo-x'])).toBe(0);
  });

  it('recusa categoria inexistente e lotes fora do limite', async () => {
    await expect(
      run([row(2, 'cat-x', { category_id: '99999999-9999-4999-8999-999999999999' })]),
    ).rejects.toMatchObject({ message: 'import_row_failed', detail: '2' });
    await expect(run([])).rejects.toMatchObject({ message: 'catalog_invalid' });
    await expect(
      run(Array.from({ length: 501 }, (_, i) => row(i + 2, `lim-${i}`))),
    ).rejects.toMatchObject({ message: 'catalog_invalid' });
  });
});
