// T-020 · Relatório de lucro: função SQL somente de leitura (PGlite; a migration nunca foi aplicada).
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, createTestDb } from './db';

let db: PGlite;
let seq = 0;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

const code = () =>
  `SPK-${'ABCDEFGHJK'[seq % 10]}${'23456789'[Math.floor(seq / 10) % 8]}ZZ${'MNPQRS'[seq++ % 6]}`;

async function product(name: string) {
  const slug = `p-${seq++}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.products (slug, name, price_cents, stock, active)
     values ($1, $2, 1000, 100, true) returning id`,
    [slug, name],
  );
  return rows[0]!.id;
}

interface Item {
  productId: string | null;
  name: string;
  price: number;
  cost: number;
  qty: number;
}

/** Pedido com itens; o estado final é gravado direto (como dono do banco, só para montar o cenário). */
async function order(opts: {
  status: string;
  paidAt: string | null;
  items: Item[];
  discount?: number;
  shipping?: number;
  giftWrap?: number;
}) {
  const subtotal = opts.items.reduce((s, i) => s + i.price * i.qty, 0);
  const discount = opts.discount ?? 0;
  const shipping = opts.shipping ?? 0;
  const gift = opts.giftWrap ?? 0;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.orders (
       code, token_hash, status, customer_name, customer_whatsapp, address, address_type,
       shipping_cents, subtotal_cents, discount_cents, gift_wrap_cents, total_cents, paid_at
     ) values ($1, $2, 'awaiting_payment', 'Cliente Teste', '79999991234', '{"cep":"49000000"}',
       'urban', $3, $4, $5, $6, $7, $8) returning id`,
    [
      code(),
      `hash-${seq}-${Math.random()}`,
      shipping,
      subtotal,
      discount,
      gift,
      subtotal - discount + shipping + gift,
      opts.paidAt,
    ],
  );
  const id = rows[0]!.id;
  const path = ['paid', 'preparing', 'shipped', 'delivered'];
  const target = path.includes(opts.status)
    ? path.slice(0, path.indexOf(opts.status) + 1)
    : opts.status === 'canceled'
      ? ['canceled']
      : opts.status === 'returned'
        ? ['paid', 'preparing', 'shipped', 'returned']
        : [];
  for (const step of target) {
    await db.query(`update public.orders set status = $2 where id = $1`, [id, step]);
  }
  for (const i of opts.items) {
    await db.query(
      `insert into public.order_items (order_id, product_id, name_snapshot, unit_price_cents, unit_cost_cents, qty)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, i.productId, i.name, i.price, i.cost, i.qty],
    );
  }
  return id;
}

interface Raw {
  buckets: Record<string, number | string>[];
  products: Record<string, number | string>[];
  products_count: number;
}
const report = (from: string, to: string, group = 'day') =>
  asRole(
    db,
    'service_role',
    null,
    async () =>
      (
        await db.query<{ r: Raw }>(`select public.admin_profit_report($1, $2, $3) as r`, [
          from,
          to,
          group,
        ])
      ).rows[0]!.r,
  );

describe('admin_profit_report', () => {
  it('conta só pago, em separação, enviado e entregue; usa o snapshot e separa frete e embalagem', async () => {
    const caderno = await product('Caderno atual');
    const lapis = await product('Lápis');
    const item = (productId: string, name: string, price: number, cost: number, qty: number) => ({
      productId,
      name,
      price,
      cost,
      qty,
    });
    // Dia 10/03 (Brasília): 23h50 de 10/03 em Brasília é 02h50 UTC de 11/03.
    await order({
      status: 'paid',
      paidAt: '2026-03-11T02:50:00Z',
      items: [item(caderno, 'Caderno antigo', 2500, 1000, 2), item(lapis, 'Lápis', 300, 100, 10)],
      discount: 500,
      shipping: 1500,
      giftWrap: 300,
    });
    await order({
      status: 'delivered',
      paidAt: '2026-03-12T15:00:00Z',
      items: [item(caderno, 'Caderno', 2500, 1200, 1)],
      shipping: 2000,
    });
    // Fora do relatório:
    await order({
      status: 'canceled',
      paidAt: '2026-03-12T15:00:00Z',
      items: [item(caderno, 'Caderno', 2500, 1000, 1)],
    });
    await order({
      status: 'returned',
      paidAt: '2026-03-12T15:00:00Z',
      items: [item(caderno, 'Caderno', 2500, 1000, 1)],
    });
    await order({
      status: 'awaiting_payment',
      paidAt: null,
      items: [item(caderno, 'Caderno', 2500, 1000, 1)],
    });
    // Fora do período (dia 13):
    await order({
      status: 'shipped',
      paidAt: '2026-03-13T15:00:00Z',
      items: [item(caderno, 'Caderno', 2500, 1000, 1)],
    });
    // Muda o cadastro depois da compra: o relatório não pode mudar.
    await db.query(`update public.products set price_cents = 9999, cost_cents = 9000`);

    const day = await report('2026-03-10', '2026-03-12');
    expect(day.buckets.map((b) => b.bucket)).toEqual(['2026-03-10', '2026-03-12']);
    expect(day.buckets[0]).toMatchObject({
      orders: 1,
      units: 12,
      sales_cents: 8000,
      sales_costed_cents: 8000,
      cost_cents: 3000,
      units_uncosted: 0,
      sales_uncosted_cents: 0,
      discount_cents: 500,
      shipping_cents: 1500,
      gift_wrap_cents: 300,
    });
    expect(day.buckets[1]).toMatchObject({ orders: 1, sales_cents: 2500, cost_cents: 1200 });

    const month = await report('2026-03-01', '2026-03-31', 'month');
    expect(month.buckets).toHaveLength(1);
    expect(month.buckets[0]).toMatchObject({ bucket: '2026-03', orders: 3, shipping_cents: 3500 });

    // Mês inteiro (inclui o pedido do dia 13). Produto: agrupado pelo id, nome do pedido mais recente, custo do snapshot.
    const names = month.products.map((p) => p.name);
    expect(names).toEqual(['Caderno', 'Lápis']);
    expect(month.products[0]).toMatchObject({
      units: 4,
      sales_cents: 10000,
      cost_cents: 4200,
      units_uncosted: 0,
    });
    expect(month.products_count).toBe(2);
  });

  it('item com custo zero vira "sem custo" e não entra nas vendas com custo', async () => {
    const semCusto = await product('Sem custo cadastrado');
    await order({
      status: 'paid',
      paidAt: '2027-01-05T15:00:00Z',
      items: [{ productId: semCusto, name: 'Sem custo cadastrado', price: 1000, cost: 0, qty: 3 }],
    });
    const r = await report('2027-01-05', '2027-01-05');
    expect(r.buckets[0]).toMatchObject({
      sales_cents: 3000,
      sales_costed_cents: 0,
      cost_cents: 0,
      units_uncosted: 3,
      sales_uncosted_cents: 3000,
    });
    expect(r.products[0]).toMatchObject({ units: 3, units_uncosted: 3, cost_cents: 0 });
  });

  it('rateia o desconto do pedido entre itens com e sem custo, em inteiros e sem perder centavo (C-1)', async () => {
    const item = (price: number, cost: number, qty = 1) => ({
      productId: null,
      name: `Item ${price}/${cost}`,
      price,
      cost,
      qty,
    });
    const paid = (day: string) => `2028-02-${day}T15:00:00Z`;
    // Dia 01: só itens sem custo + cupom de 100 -> o desconto todo vai para "sem custo".
    await order({
      status: 'paid',
      paidAt: paid('01'),
      items: [item(1000, 0, 1)],
      discount: 100,
    });
    // Dia 02: misto, 2.500 com custo + 1.000 sem custo, cupom de 1.000.
    // com custo: 1.000 × 2.500 / 3.500 = 714 resto 1.000; sem custo: 285 resto 2.500; sobra 1 centavo
    // vai ao maior resto (sem custo) -> 714 + 286 = 1.000.
    await order({
      status: 'paid',
      paidAt: paid('02'),
      items: [item(2500, 1000), item(1000, 0)],
      discount: 1000,
    });
    // Dia 03: empate nos restos (100 e 100 de 200): o centavo fica com os itens com custo.
    await order({
      status: 'paid',
      paidAt: paid('03'),
      items: [item(100, 50), item(100, 0)],
      discount: 1,
    });
    // Dia 04: sem desconto.
    await order({ status: 'paid', paidAt: paid('04'), items: [item(100, 0)] });
    // Dia 05: dois pedidos no mesmo dia; o rateio é por pedido e a soma não perde centavo.
    await order({
      status: 'paid',
      paidAt: paid('05'),
      items: [item(333, 100), item(333, 0), item(334, 0)],
      discount: 7,
    });
    await order({
      status: 'paid',
      paidAt: '2028-02-05T16:00:00Z',
      items: [item(500, 200, 3), item(250, 0, 2)],
      discount: 999,
    });

    const r = await report('2028-02-01', '2028-02-05');
    const byDay = Object.fromEntries(r.buckets.map((b) => [b.bucket, b]));
    expect(byDay['2028-02-01']).toMatchObject({
      sales_cents: 1000,
      sales_costed_cents: 0,
      discount_cents: 100,
      discount_uncosted_cents: 100,
    });
    expect(byDay['2028-02-02']).toMatchObject({
      discount_cents: 1000,
      discount_uncosted_cents: 286,
    });
    expect(byDay['2028-02-03']).toMatchObject({ discount_cents: 1, discount_uncosted_cents: 0 });
    expect(byDay['2028-02-04']).toMatchObject({ discount_cents: 0, discount_uncosted_cents: 0 });

    // Dia 05, pedido 1: s = 1.000, sc = 333, su = 667, d = 7 -> 2 (resto 331) e 4 (resto 669);
    // sobra 1 -> sem custo fica com 5. Pedido 2: s = 2.000, sc = 1.500, su = 500, d = 999 ->
    // 749 (resto 500) e 249 (resto 1.500); sobra 1 -> sem custo (maior resto), 250.
    expect(byDay['2028-02-05']).toMatchObject({
      orders: 2,
      discount_cents: 1006,
      discount_uncosted_cents: 5 + 250,
    });

    // Invariante em todo dia: a parte sem custo nunca passa do total nem das vendas sem custo.
    for (const b of r.buckets) {
      expect(Number(b.discount_uncosted_cents)).toBeGreaterThanOrEqual(0);
      expect(Number(b.discount_uncosted_cents)).toBeLessThanOrEqual(Number(b.discount_cents));
      expect(Number(b.discount_uncosted_cents)).toBeLessThanOrEqual(Number(b.sales_uncosted_cents));
    }
  });

  it('agrupa por nome quando o produto foi apagado e respeita o fuso de Brasília', async () => {
    await order({
      status: 'paid',
      // 01h00 UTC de 02/06 = 22h00 de 01/06 em Brasília.
      paidAt: '2027-06-02T01:00:00Z',
      items: [{ productId: null, name: 'Produto apagado', price: 500, cost: 200, qty: 1 }],
    });
    const june1 = await report('2027-06-01', '2027-06-01');
    expect(june1.buckets).toHaveLength(1);
    expect(june1.products[0]).toMatchObject({ key: 'n:Produto apagado', name: 'Produto apagado' });
    expect((await report('2027-06-02', '2027-06-02')).buckets).toHaveLength(0);
  });

  it('período sem vendas devolve listas vazias', async () => {
    const r = await report('2030-01-01', '2030-01-31');
    expect(r).toEqual({ buckets: [], products: [], products_count: 0 });
  });

  it('recusa entrada inválida (agrupamento, ordem das datas, período maior que 366 dias)', async () => {
    await expect(report('2026-03-01', '2026-03-02', 'year')).rejects.toThrow(/invalid_payload/);
    await expect(report('2026-03-05', '2026-03-01')).rejects.toThrow(/invalid_payload/);
    await expect(report('2026-01-01', '2027-01-02')).rejects.toThrow(/invalid_payload/);
    expect((await report('2026-01-01', '2027-01-01')).buckets).toBeDefined();
  });

  it('só a API (service_role) executa: anon e authenticated recebem permission denied', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        asRole(db, role, '00000000-0000-4000-8000-0000000000aa', () =>
          db.query(`select public.admin_profit_report('2026-03-01', '2026-03-02', 'day')`),
        ),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('é somente leitura: não altera pedidos, itens nem produtos', async () => {
    const count = async () =>
      (
        await db.query<{ n: string }>(
          `select (select count(*) from public.orders)::text || '/' ||
                  (select count(*) from public.order_items)::text || '/' ||
                  (select count(*) from public.audit_log)::text as n`,
        )
      ).rows[0]!.n;
    const before = await count();
    await report('2026-03-01', '2026-03-31', 'month');
    expect(await count()).toBe(before);
    const { rows } = await db.query<{ provolatile: string }>(
      `select provolatile from pg_proc where proname = 'admin_profit_report'`,
    );
    expect(rows[0]!.provolatile).toBe('s'); // stable: o Postgres recusa escrita dentro dela
  });
});
