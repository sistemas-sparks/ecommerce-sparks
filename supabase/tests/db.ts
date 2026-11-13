// Banco de teste: PGlite (Postgres embutido) + simulação do Supabase + migrations + seed.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export type Role = 'anon' | 'authenticated' | 'service_role';

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(root, 'tests', 'supabase-stub.sql'), 'utf8'));

  const migrationsDir = join(root, 'migrations');
  for (const file of readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  await db.exec(readFileSync(join(root, 'seed.sql'), 'utf8'));
  return db;
}

/** Executa `fn` como um papel do Supabase (com a claim sub do JWT, se houver). */
export async function asRole<T>(
  db: PGlite,
  role: Role,
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    userId ? JSON.stringify({ sub: userId, role }) : '',
  ]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

export async function publicTables(db: PGlite): Promise<string[]> {
  const { rows } = await db.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  return rows.map((r) => r.tablename);
}

export const USER_A = '00000000-0000-4000-8000-00000000000a';
export const USER_B = '00000000-0000-4000-8000-00000000000b';

/** Insere um pedido mínimo válido (como dono do banco, fora dos papéis da API). */
export async function insertOrder(
  db: PGlite,
  opts: { code: string; userId?: string | null; status?: string },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.orders (
       code, token_hash, status, customer_user_id, customer_name, customer_whatsapp,
       address, address_type, shipping_service, shipping_cents, subtotal_cents, total_cents
     ) values ($1, $2, $3, $4, 'Cliente Teste', '79999991234',
       '{"cep":"49000000"}', 'urban', 'economy', 1500, 5000, 6500)
     returning id`,
    [opts.code, `hash-${opts.code}`, opts.status ?? 'awaiting_payment', opts.userId ?? null],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('pedido não inserido');
  return id;
}
