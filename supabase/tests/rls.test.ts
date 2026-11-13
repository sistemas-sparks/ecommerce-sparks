// Testes de RLS obrigatórios (docs/banco-de-dados.md): como anon e como cliente A,
// ler, inserir, alterar e apagar em TODAS as tabelas, inclusive dados do cliente B. Tudo deve falhar.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USER_A, USER_B, asRole, createTestDb, insertOrder, publicTables } from './db';

let db: PGlite;
let tables: string[];
const firstColumn: Record<string, string> = {};

beforeAll(async () => {
  db = await createTestDb();
  tables = await publicTables(db);
  for (const t of tables) {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = $1
          and is_identity = 'NO' and is_generated = 'NEVER'
        order by ordinal_position limit 1`,
      [t],
    );
    firstColumn[t] = rows[0]?.column_name ?? 'id';
  }

  // Dados dos dois clientes, gravados pelo dono do banco.
  await db.query(
    `insert into auth.users (id, email) values ($1, 'a@teste.dev'), ($2, 'b@teste.dev')`,
    [USER_A, USER_B],
  );
  await db.query(
    `insert into public.profiles (user_id, name) values ($1, 'Cliente A'), ($2, 'Cliente B')`,
    [USER_A, USER_B],
  );
  await insertOrder(db, { code: 'SPK-AAAAA', userId: USER_A });
  await insertOrder(db, { code: 'SPK-BBBBB', userId: USER_B });
});

afterAll(async () => {
  await db.close();
});

describe('estrutura', () => {
  it('existem as tabelas do modelo', () => {
    expect(tables).toEqual(
      expect.arrayContaining([
        'audit_log', 'categories', 'coupon_redemptions', 'coupons', 'favorites', 'order_events',
        'order_items', 'orders', 'package_sizes', 'payment_events', 'product_images', 'products',
        'profiles', 'rate_limits', 'settings', 'shipping_cep_exceptions', 'shipping_local_rules',
        'shipping_rates', 'shipping_zones', 'uf_cep_ranges',
      ]),
    ); // prettier-ignore
  });

  it('RLS está ativo em todas as tabelas de public', async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it('nenhuma policy libera acesso direto', async () => {
    const { rows } = await db.query(`select * from pg_policies where schemaname = 'public'`);
    expect(rows).toEqual([]);
  });
});

const roles = [
  { role: 'anon' as const, userId: null, label: 'anon' },
  { role: 'authenticated' as const, userId: USER_A, label: 'cliente A' },
];

describe.each(roles)('acesso negado como $label', ({ role, userId }) => {
  it.each(['select', 'insert', 'update', 'delete'] as const)('%s em todas as tabelas', async (op) => {
    for (const table of tables) {
      const col = firstColumn[table];
      const sql = {
        select: `select * from public.${table}`,
        insert: `insert into public.${table} default values`,
        update: `update public.${table} set ${col} = ${col}`,
        delete: `delete from public.${table}`,
      }[op];
      await expect(asRole(db, role, userId, () => db.query(sql)), `${op} em ${table}`).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('não executa funções do banco', async () => {
    await expect(
      asRole(db, role, userId, () => db.query(`select public.rate_limit_hit('x', 60, 10)`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, role, userId, () => db.query(`select public.rate_limit_cleanup()`)),
    ).rejects.toThrow(/permission denied/);
  });
}); // prettier-ignore

describe('cliente A tentando dados do cliente B', () => {
  it('não lê o pedido nem o perfil de B', async () => {
    await expect(
      asRole(db, 'authenticated', USER_A, () =>
        db.query(`select * from public.orders where customer_user_id = $1`, [USER_B]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, 'authenticated', USER_A, () =>
        db.query(`select * from public.profiles where user_id = $1`, [USER_B]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('não altera nem apaga o pedido de B', async () => {
    await expect(
      asRole(db, 'authenticated', USER_A, () =>
        db.query(`update public.orders set customer_name = 'X' where customer_user_id = $1`, [USER_B]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, 'authenticated', USER_A, () =>
        db.query(`delete from public.orders where customer_user_id = $1`, [USER_B]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('nem o próprio pedido é acessível direto (tudo passa pela API)', async () => {
    await expect(
      asRole(db, 'authenticated', USER_A, () =>
        db.query(`select * from public.orders where customer_user_id = $1`, [USER_A]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('os dados continuam intactos', async () => {
    const { rows } = await db.query<{ customer_name: string }>(
      `select customer_name from public.orders order by code`,
    );
    expect(rows.map((r) => r.customer_name)).toEqual(['Cliente Teste', 'Cliente Teste']);
  });
}); // prettier-ignore

describe('service_role (API)', () => {
  it('lê e grava nas tabelas de negócio', async () => {
    const rows = await asRole(db, 'service_role', null, async () => {
      await db.query(`insert into public.categories (slug, name) values ('cadernos', 'Cadernos')`);
      return (await db.query(`select slug from public.categories`)).rows;
    });
    expect(rows).toEqual([{ slug: 'cadernos' }]);
  });

  it('executa rate_limit_hit', async () => {
    const result = await asRole(db, 'service_role', null, () =>
      db.query<{ ok: boolean }>(`select public.rate_limit_hit('svc', 60, 5) as ok`),
    );
    expect(result.rows[0]?.ok).toBe(true);
  });
});
