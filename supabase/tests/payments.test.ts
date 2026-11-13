// T-015 · mark_order_paid (idempotência, valor, estados) e expire_unpaid_orders.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, createTestDb, insertOrder } from './db';

let db: PGlite;
let seq = 0;
const code = () =>
  `SPK-P${'23456789ABCDEFGHJKMNPQRSTUVWXYZ'[seq++ % 31]}${'ABCDEFGH'[Math.floor(seq / 31)]}ZZ`;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

function markPaid(
  orderId: string,
  opts: { paymentId?: string; amount?: number; event?: string } = {},
) {
  return asRole(db, 'service_role', null, async () => {
    const { rows } = await db.query<{ r: string }>(
      `select public.mark_order_paid($1, $2, $3, 'pix', $4, 'hash') as r`,
      [orderId, opts.paymentId ?? 'mp-1', opts.amount ?? 6500, opts.event ?? `ev-${Math.random()}`],
    );
    return rows[0]!.r;
  });
}

async function orderRow(id: string) {
  const { rows } = await db.query<Record<string, unknown>>(
    `select status, mp_payment_id, payment_method, paid_at, reserved_until from public.orders where id = $1`,
    [id],
  );
  return rows[0]!;
}

describe('mark_order_paid', () => {
  it('marca como pago, guarda o pagamento e confirma o cupom', async () => {
    const id = await insertOrder(db, { code: code() });
    await db.query(`insert into public.coupons (code, type, value) values ('PAGO', 'fixed', 100)`);
    await db.query(
      `insert into public.coupon_redemptions (coupon_id, order_id)
       select id, $1 from public.coupons where code = 'PAGO'`,
      [id],
    );

    expect(await markPaid(id, { paymentId: 'mp-100' })).toBe('paid');
    const order = await orderRow(id);
    expect(order).toMatchObject({
      status: 'paid',
      mp_payment_id: 'mp-100',
      payment_method: 'pix',
      reserved_until: null,
    });
    expect(order.paid_at).not.toBeNull();

    const { rows } = await db.query(
      `select r.status from public.coupon_redemptions r where r.order_id = $1`,
      [id],
    );
    expect(rows).toEqual([{ status: 'confirmed' }]);

    const { rows: events } = await db.query(
      `select actor, to_status from public.order_events where order_id = $1 order by id`,
      [id],
    );
    expect(events.at(-1)).toEqual({ actor: 'webhook', to_status: 'paid' });
  });

  it('o mesmo evento repetido é processado uma vez só', async () => {
    const id = await insertOrder(db, { code: code() });
    expect(await markPaid(id, { event: 'ev-repetido' })).toBe('paid');
    expect(await markPaid(id, { event: 'ev-repetido' })).toBe('duplicate');
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.payment_events where provider_event_id = 'ev-repetido'`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('outro evento do mesmo pagamento: already_paid, sem mudar nada', async () => {
    const id = await insertOrder(db, { code: code() });
    await markPaid(id, { paymentId: 'mp-200' });
    expect(await markPaid(id, { paymentId: 'mp-200' })).toBe('already_paid');
  });

  it('segundo pagamento diferente para o mesmo pedido: double_payment', async () => {
    const id = await insertOrder(db, { code: code() });
    await markPaid(id, { paymentId: 'mp-300' });
    expect(await markPaid(id, { paymentId: 'mp-301' })).toBe('double_payment');
    expect((await orderRow(id)).mp_payment_id).toBe('mp-300');
  });

  it('valor diferente do total: não marca como pago', async () => {
    const id = await insertOrder(db, { code: code() });
    expect(await markPaid(id, { amount: 6499 })).toBe('amount_mismatch');
    expect((await orderRow(id)).status).toBe('awaiting_payment');
  });

  it('pedido expirado ou cancelado: late_payment, sem reabrir sozinho', async () => {
    const id = await insertOrder(db, { code: code() });
    await db.query(`update public.orders set status = 'expired' where id = $1`, [id]);
    expect(await markPaid(id)).toBe('late_payment');
    expect((await orderRow(id)).status).toBe('expired');
  });

  it('pedido inexistente: order_not_found, e o evento fica registrado', async () => {
    expect(await markPaid('00000000-0000-4000-8000-00000000dead', { event: 'ev-orfao' })).toBe(
      'order_not_found',
    );
    const { rows } = await db.query(
      `select processed_at is not null as processed from public.payment_events where provider_event_id = 'ev-orfao'`,
    );
    expect(rows).toEqual([{ processed: true }]);
  });

  it('anon e authenticated não executam', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        asRole(db, role, null, () =>
          db.query(`select public.mark_order_paid(gen_random_uuid(), 'x', 1, 'pix', 'e', 'h')`),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe('expire_unpaid_orders', () => {
  async function orderWithStock(reservedMinutesAgo: number, status = 'awaiting_payment') {
    const slug = `exp-${seq++}`;
    const { rows } = await db.query<{ id: string }>(
      `insert into public.products (slug, name, price_cents, stock, active) values ($1, 'P', 5000, 0, true) returning id`,
      [slug],
    );
    const productId = rows[0]!.id;
    const orderId = await insertOrder(db, { code: code(), status });
    await db.query(
      `update public.orders set reserved_until = now() - make_interval(mins => $2) where id = $1`,
      [orderId, reservedMinutesAgo],
    );
    await db.query(
      `insert into public.order_items (order_id, product_id, name_snapshot, unit_price_cents, unit_cost_cents, qty)
       values ($1, $2, 'P', 5000, 0, 2)`,
      [orderId, productId],
    );
    return { orderId, productId };
  }

  const stock = async (id: string) =>
    (await db.query<{ s: number }>(`select stock as s from public.products where id = $1`, [id]))
      .rows[0]!.s;

  const expire = () =>
    asRole(
      db,
      'service_role',
      null,
      async () =>
        (await db.query<{ n: number }>(`select public.expire_unpaid_orders() as n`)).rows[0]!.n,
    );

  it('expira só os vencidos há mais de 10 minutos e devolve o estoque', async () => {
    const vencido = await orderWithStock(11);
    const naFolga = await orderWithStock(5);
    const rural = await orderWithStock(60, 'awaiting_shipping_quote');

    expect(await expire()).toBeGreaterThanOrEqual(1);
    expect((await orderRow(vencido.orderId)).status).toBe('expired');
    expect(await stock(vencido.productId)).toBe(2);

    expect((await orderRow(naFolga.orderId)).status).toBe('awaiting_payment');
    expect(await stock(naFolga.productId)).toBe(0);

    expect((await orderRow(rural.orderId)).status).toBe('awaiting_shipping_quote');
  });

  it('rodar de novo não devolve o estoque duas vezes', async () => {
    const vencido = await orderWithStock(30);
    await expire();
    await expire();
    expect(await stock(vencido.productId)).toBe(2);
  });

  it('pedido pago não expira', async () => {
    const pago = await orderWithStock(30);
    await markPaid(pago.orderId, { paymentId: `mp-${seq}` });
    await expire();
    expect((await orderRow(pago.orderId)).status).toBe('paid');
  });
});
