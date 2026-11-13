// Regras do banco: transições de status, logs só de inserção, CHECKs de dinheiro e limite de requisições.
import type { PGlite } from '@electric-sql/pglite';
import { ORDER_STATUSES, canTransition } from '@sparks/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, createTestDb, insertOrder } from './db';

let db: PGlite;
let seq = 0;
const nextCode = () =>
  `SPK-${'ABCDEFGHJK'[Math.floor(seq / 10) % 10]}${'2345678923'[seq++ % 10]}ZZZ`;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

async function setStatus(orderId: string, status: string, actor?: string) {
  return asRole(db, 'service_role', null, async () => {
    await db.query(`select set_config('app.actor', $1, false)`, [actor ?? '']);
    return db.query(`update public.orders set status = $1 where id = $2`, [status, orderId]);
  });
}

describe('seed', () => {
  it('carrega faixas de CEP, zonas, tamanhos e configurações', async () => {
    const count = async (t: string) =>
      (await db.query<{ n: number }>(`select count(*)::int as n from public.${t}`)).rows[0]?.n;
    expect(await count('uf_cep_ranges')).toBe(30);
    expect(await count('shipping_zones')).toBe(6);
    expect(await count('package_sizes')).toBe(3);
    expect(await count('settings')).toBe(1);
  });

  it('não inventa dados da cliente', async () => {
    expect(await db.query(`select * from public.shipping_rates`)).toMatchObject({ rows: [] });
    expect(await db.query(`select * from public.shipping_local_rules`)).toMatchObject({ rows: [] });
    const { rows } = await db.query(
      `select store_whatsapp, origin_cep, free_shipping_min_cents from public.settings`,
    );
    expect(rows).toEqual([
      { store_whatsapp: null, origin_cep: null, free_shipping_min_cents: null },
    ]);
  });

  it('cada UF está em exatamente uma zona', async () => {
    const { rows } = await db.query<{ uf: string; n: number }>(
      `select uf, count(*)::int as n from public.shipping_zones, unnest(ufs) as uf group by uf`,
    );
    expect(rows).toHaveLength(27);
    expect(rows.every((r) => r.n === 1)).toBe(true);
  });
});

describe('transições de status', () => {
  it('o banco segue exatamente ORDER_TRANSITIONS do packages/shared', async () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const { rows } = await db.query<{ ok: boolean }>(
          `select public.order_status_allowed($1, $2) as ok`,
          [from, to],
        );
        expect(rows[0]?.ok, `${from} -> ${to}`).toBe(canTransition(from, to));
      }
    }
  });

  it('pedido novo só começa aguardando pagamento ou frete', async () => {
    await expect(insertOrder(db, { code: nextCode(), status: 'paid' })).rejects.toThrow(
      /não pode começar/,
    );
  });

  it('bloqueia pular etapas e registra o histórico das válidas', async () => {
    const id = await insertOrder(db, { code: nextCode() });
    await expect(setStatus(id, 'shipped')).rejects.toThrow(/transição de status inválida/);
    await setStatus(id, 'paid', 'webhook');
    await setStatus(id, 'preparing', 'admin:lojista');

    const { rows } = await db.query(
      `select from_status, to_status, actor from public.order_events where order_id = $1 order by id`,
      [id],
    );
    expect(rows).toEqual([
      { from_status: null, to_status: 'awaiting_payment', actor: 'system' },
      { from_status: 'awaiting_payment', to_status: 'paid', actor: 'webhook' },
      { from_status: 'paid', to_status: 'preparing', actor: 'admin:lojista' },
    ]);
  });

  it('estado final não volta', async () => {
    const id = await insertOrder(db, { code: nextCode() });
    await setStatus(id, 'expired');
    await expect(setStatus(id, 'paid')).rejects.toThrow(/transição de status inválida/);
  });
});

describe('logs só de inserção', () => {
  it('audit_log: service_role não altera nem apaga', async () => {
    await asRole(db, 'service_role', null, () =>
      db.query(
        `insert into public.audit_log (actor, action, entity) values ('admin', 'create', 'product')`,
      ),
    );
    await expect(
      asRole(db, 'service_role', null, () => db.query(`update public.audit_log set actor = 'x'`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, 'service_role', null, () => db.query(`delete from public.audit_log`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('audit_log e order_events: nem o dono do banco altera, apaga ou trunca', async () => {
    for (const table of ['audit_log', 'order_events']) {
      await expect(db.query(`update public.${table} set actor = 'x'`)).rejects.toThrow(
        /só de inserção/,
      );
      await expect(db.query(`delete from public.${table}`)).rejects.toThrow(/só de inserção/);
      await expect(db.query(`truncate public.${table}`)).rejects.toThrow(/só de inserção/);
    }
  });
});

describe('CHECKs de dinheiro e formato', () => {
  it('rejeita preço negativo', async () => {
    await expect(
      db.query(`insert into public.products (slug, name, price_cents) values ('x', 'X', -1)`),
    ).rejects.toThrow(/check/i);
  });

  it('rejeita estoque negativo', async () => {
    await db.query(
      `insert into public.products (slug, name, price_cents, stock) values ('caneta', 'Caneta', 500, 1)`,
    );
    await expect(
      db.query(`update public.products set stock = stock - 2 where slug = 'caneta'`),
    ).rejects.toThrow(/check/i);
  });

  it('rejeita total que não bate com as parcelas', async () => {
    await expect(
      db.query(
        `insert into public.orders (code, token_hash, status, customer_name, customer_whatsapp,
           address, address_type, shipping_service, shipping_cents, subtotal_cents, total_cents)
         values ('SPK-TTTTT', 'h-t', 'awaiting_payment', 'Teste', '79999991234',
           '{}', 'urban', 'economy', 1500, 5000, 1)`,
      ),
    ).rejects.toThrow(/orders_total_check/);
  });

  it('rejeita desconto maior que o subtotal', async () => {
    await expect(
      db.query(
        `insert into public.orders (code, token_hash, status, customer_name, customer_whatsapp,
           address, address_type, shipping_service, shipping_cents, subtotal_cents, discount_cents, total_cents)
         values ('SPK-DDDDD', 'h-d', 'awaiting_payment', 'Teste', '79999991234',
           '{}', 'urban', 'economy', 0, 100, 200, -100)`,
      ),
    ).rejects.toThrow(/check/i);
  });

  it('pedido aguardando frete pode ficar sem frete; os demais não', async () => {
    const base = `insert into public.orders (code, token_hash, status, customer_name, customer_whatsapp,
      address, address_type, subtotal_cents, total_cents) values ($1, $2, $3, 'Teste', '79999991234',
      '{}', 'rural', 5000, 5000)`;
    await db.query(base, ['SPK-RRRRR', 'h-r', 'awaiting_shipping_quote']);
    await expect(db.query(base, ['SPK-RRRRS', 'h-s', 'awaiting_payment'])).rejects.toThrow(
      /orders_shipping_defined_check/,
    );
  });

  it('cupom: código maiúsculo e percentual entre 1 e 100', async () => {
    await expect(
      db.query(`insert into public.coupons (code, type, value) values ('volta10', 'percent', 10)`),
    ).rejects.toThrow(/check/i);
    await expect(
      db.query(`insert into public.coupons (code, type, value) values ('VOLTA', 'percent', 101)`),
    ).rejects.toThrow(/coupons_value_check/);
    await db.query(
      `insert into public.coupons (code, type, value) values ('VOLTA10', 'percent', 10)`,
    );
  });

  it('mensagem do cartão com mais de 140 caracteres é rejeitada', async () => {
    await expect(
      db.query(
        `insert into public.orders (code, token_hash, status, customer_name, customer_whatsapp,
           address, address_type, shipping_service, shipping_cents, subtotal_cents, total_cents, gift_message)
         values ('SPK-GGGGG', 'h-g', 'awaiting_payment', 'Teste', '79999991234',
           '{}', 'urban', 'economy', 0, 100, 100, repeat('a', 141))`,
      ),
    ).rejects.toThrow(/check/i);
  });
});

describe('rate_limit_hit', () => {
  const hit = (key: string, max: number) =>
    asRole(db, 'service_role', null, async () => {
      const { rows } = await db.query<{ ok: boolean }>(
        `select public.rate_limit_hit($1, 60, $2) as ok`,
        [key, max],
      );
      return rows[0]?.ok;
    });

  it('libera até o máximo e bloqueia depois', async () => {
    expect([
      await hit('cupom:ip1', 3),
      await hit('cupom:ip1', 3),
      await hit('cupom:ip1', 3),
    ]).toEqual([true, true, true]);
    expect(await hit('cupom:ip1', 3)).toBe(false);
  });

  it('chaves diferentes têm contagens separadas', async () => {
    expect(await hit('cupom:ip2', 1)).toBe(true);
    expect(await hit('cupom:ip2', 1)).toBe(false);
    expect(await hit('cupom:ip3', 1)).toBe(true);
  });

  it('rejeita parâmetros inválidos', async () => {
    await expect(hit('', 3)).rejects.toThrow(/parâmetros inválidos/);
    await expect(hit('x', 0)).rejects.toThrow(/parâmetros inválidos/);
  });
});
