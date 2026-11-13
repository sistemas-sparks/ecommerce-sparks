import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, createTestDb, USER_A } from './db';

let db: PGlite;
let sequence = 0;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});
const product = () => ({
  slug: `produto-teste-${++sequence}`,
  name: 'Produto de teste',
  description: '',
  category_id: null,
  kind: 'regular',
  price_cents: 1234,
  cost_cents: 700,
  stock: 10,
  weight_g: null,
  package_size: 'P',
  length_cm: null,
  width_cm: null,
  height_cm: null,
  active: true,
  featured: false,
  badge: null,
});
async function mutate(
  entity: string,
  action: string,
  id: string | null,
  data: unknown,
  expected: string | null = null,
  productId: string | null = null,
) {
  return asRole(db, 'service_role', null, async () => {
    const result = await db.query<{ result: { id: string } }>(
      `select public.admin_catalog_mutate($1,$2,$3,$4,$5,$6,$7) as result`,
      [entity, action, id, JSON.stringify(data), expected, USER_A, productId],
    );
    return result.rows[0]!.result.id;
  });
}
async function version(table: 'products' | 'categories' | 'product_images', id: string) {
  return (
    await db.query<{ version: string }>(
      `select updated_at::text as version from public.${table} where id=$1`,
      [id],
    )
  ).rows[0]!.version;
}

describe('alterações atômicas do catálogo', () => {
  it('clientes e anônimos não executam a função administrativa', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        asRole(db, role, USER_A, () =>
          db.query(`select public.admin_catalog_mutate('products','create',null,$1,null,$2,null)`, [
            JSON.stringify(product()),
            USER_A,
          ]),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });
  it('registra criação com o ID e o autor; dinheiro permanece em centavos', async () => {
    const input = product();
    const id = await mutate('products', 'create', null, input);
    expect(
      (await db.query(`select price_cents,cost_cents,stock from public.products where id=$1`, [id]))
        .rows,
    ).toEqual([{ price_cents: 1234, cost_cents: 700, stock: 10 }]);
    expect(
      (
        await db.query(
          `select actor,action,entity_id from public.audit_log where entity='products' and entity_id=$1`,
          [id],
        )
      ).rows,
    ).toEqual([{ actor: USER_A, action: 'create', entity_id: id }]);
  });
  it('uma edição antiga não repõe estoque reservado por outra transação', async () => {
    const input = product();
    const id = await mutate('products', 'create', null, input);
    const before = await version('products', id);
    await db.query(`update public.products set stock=stock-2 where id=$1`, [id]);
    await expect(mutate('products', 'update', id, { ...input, stock: 10 }, before)).rejects.toThrow(
      /catalog_changed/,
    );
    expect(
      (await db.query<{ stock: number }>(`select stock from public.products where id=$1`, [id]))
        .rows[0]!.stock,
    ).toBe(8);
    await mutate(
      'products',
      'update',
      id,
      { ...input, stock: 8, price_cents: 1599 },
      await version('products', id),
    );
    expect(
      (await db.query(`select price_cents,stock from public.products where id=$1`, [id])).rows,
    ).toEqual([{ price_cents: 1599, stock: 8 }]);
  });
  it('falha na auditoria desfaz também a criação do produto', async () => {
    const input = product();
    await db.exec(`create function public.catalog_test_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'audit_test_failure'; end $$;
      create trigger catalog_test_audit_failure before insert on public.audit_log for each row execute function public.catalog_test_audit_failure();`);
    try {
      await expect(mutate('products', 'create', null, input)).rejects.toThrow(/audit_test_failure/);
      expect(
        (await db.query(`select id from public.products where slug=$1`, [input.slug])).rows,
      ).toEqual([]);
    } finally {
      await db.exec(
        `drop trigger catalog_test_audit_failure on public.audit_log; drop function public.catalog_test_audit_failure();`,
      );
    }
  });
  it('exclusão do produto mantém o registro e bloqueia novas edições', async () => {
    const input = product();
    const id = await mutate('products', 'create', null, input);
    await mutate('products', 'delete', id, {}, await version('products', id));
    expect(
      (
        await db.query(
          `select active,deleted_at is not null as deleted from public.products where id=$1`,
          [id],
        )
      ).rows,
    ).toEqual([{ active: false, deleted: true }]);
    await expect(
      mutate('products', 'update', id, input, await version('products', id)),
    ).rejects.toThrow(/catalog_changed/);
  });
  it('uma categoria com produtos não é apagada', async () => {
    const categoryId = await mutate('categories', 'create', null, {
      slug: 'categoria-teste',
      name: 'Categoria de teste',
      position: 0,
      active: true,
    });
    const input = { ...product(), category_id: categoryId };
    const id = await mutate('products', 'create', null, input);
    await expect(
      mutate('categories', 'delete', categoryId, {}, await version('categories', categoryId)),
    ).rejects.toThrow(/category_in_use/);
    await mutate('products', 'delete', id, {}, await version('products', id));
    await mutate('categories', 'delete', categoryId, {}, await version('categories', categoryId));
    expect(
      (await db.query(`select id from public.categories where id=$1`, [categoryId])).rows,
    ).toEqual([]);
  });
  it('a função limita fotos a 12 e impede associar arquivos de outro produto', async () => {
    const id = await mutate('products', 'create', null, product());
    const photoId = crypto.randomUUID();
    await expect(
      mutate(
        'product_images',
        'create',
        photoId,
        { path: `${crypto.randomUUID()}/${photoId}/1080.webp`, alt: 'Foto', position: 0 },
        null,
        id,
      ),
    ).rejects.toThrow(/catalog_invalid/);
    for (let index = 0; index < 12; index++) {
      const imageId = crypto.randomUUID();
      await mutate(
        'product_images',
        'create',
        imageId,
        { path: `${id}/${imageId}/1080.webp`, alt: 'Foto de teste', position: index },
        null,
        id,
      );
    }
    const extra = crypto.randomUUID();
    await expect(
      mutate(
        'product_images',
        'create',
        extra,
        { path: `${id}/${extra}/1080.webp`, alt: 'Foto extra', position: 0 },
        null,
        id,
      ),
    ).rejects.toThrow(/image_limit/);
    expect(
      (
        await db.query<{ count: number }>(
          `select count(*)::int as count from public.product_images where product_id=$1`,
          [id],
        )
      ).rows[0]!.count,
    ).toBe(12);
  });
});
