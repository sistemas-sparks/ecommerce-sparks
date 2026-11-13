// T-028 · frete híbrido: tabelas novas, CHECKs, shipping_service do pedido e RLS.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, createTestDb, insertOrder } from './db';

let db: PGlite;
let seq = 0;
const code = () => `SPK-H${'23456789ABCDEFGHJKMNPQRSTUVWXYZ'[seq++ % 31]}ZZZ`;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

async function newType(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.shipping_own_types (name) values ('Tipo teste') returning id`,
  );
  return rows[0]!.id;
}

function insertArea(
  typeId: string,
  o: { start?: string; end?: string; price?: number; min?: number; max?: number; label?: string } = {},
) {
  return db.query(
    `insert into public.shipping_own_areas
       (type_id, label, cep_start, cep_end, price_cents, days_min, days_max)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      typeId,
      o.label ?? '',
      o.start ?? '49000000',
      o.end ?? '49099999',
      o.price ?? 1000,
      o.min ?? 1,
      o.max ?? 2,
    ],
  );
}

describe('dados iniciais', () => {
  it('cria PAC e SEDEX habilitados', async () => {
    const { rows } = await db.query(
      `select service_id, name, carrier, enabled from public.melhor_envio_services order by service_id`,
    );
    expect(rows).toEqual([
      { service_id: 1, name: 'PAC', carrier: 'Correios', enabled: true },
      { service_id: 2, name: 'SEDEX', carrier: 'Correios', enabled: true },
    ]);
  });

  it('folga do Melhor Envio vale 0 por padrão', async () => {
    const { rows } = await db.query<{ m: number }>(
      `select melhor_envio_margin_cents as m from public.settings`,
    );
    expect(rows[0]?.m).toBe(0);
  });
});

describe('shipping_own_areas', () => {
  it('aceita uma faixa válida', async () => {
    await expect(insertArea(await newType())).resolves.toBeTruthy();
  });

  it.each([
    ['CEP fora do formato', { start: '4900' }],
    ['cep_start maior que cep_end', { start: '49099999', end: '49000000' }],
    ['preço negativo', { price: -1 }],
    ['days_max menor que days_min', { min: 3, max: 2 }],
    ['label com 61 caracteres', { label: 'a'.repeat(61) }],
  ])('recusa %s', async (_n, o) => {
    await expect(insertArea(await newType(), o)).rejects.toThrow();
  });

  it('recusa type_id inexistente', async () => {
    await expect(insertArea('00000000-0000-4000-8000-000000000099')).rejects.toThrow();
  });

  it('apagar o tipo apaga as áreas', async () => {
    const t = await newType();
    await insertArea(t);
    await db.query(`delete from public.shipping_own_types where id = $1`, [t]);
    const { rows } = await db.query(`select 1 from public.shipping_own_areas where type_id = $1`, [t]);
    expect(rows).toHaveLength(0);
  });
});

describe('orders.shipping_service', () => {
  const uuid = '123e4567-e89b-42d3-a456-426614174000';

  async function setService(value: string) {
    const id = await insertOrder(db, { code: code() });
    return db.query(`update public.orders set shipping_service = $1 where id = $2`, [value, id]);
  }

  it.each(['economy', `own:${uuid}`, 'me:2'])('aceita %s', async (v) => {
    await expect(setService(v)).resolves.toBeTruthy();
  });

  it.each(['me:0', 'me:abc', 'own:xyz', 'correios'])('recusa %s', async (v) => {
    await expect(setService(v)).rejects.toThrow();
  });
});

describe('RLS das tabelas novas', () => {
  const tables = ['shipping_own_types', 'shipping_own_areas', 'melhor_envio_services'];
  const stmts = (t: string) => [
    `select * from public.${t}`,
    `insert into public.${t} default values`,
    `update public.${t} set updated_at = now()`,
    `delete from public.${t}`,
  ];

  for (const role of ['anon', 'authenticated'] as const) {
    it.each(tables)(`${role} não acessa %s`, async (t) => {
      for (const sql of stmts(t)) {
        await expect(
          asRole(db, role, null, () => db.query(sql)),
        ).rejects.toThrow();
      }
    });
  }
});
