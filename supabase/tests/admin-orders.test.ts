// T-019 · Funções do painel de pedidos: status, rastreio, frete a combinar e alertas de pagamento.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, createTestDb } from './db';

let db: PGlite;
let seq = 0;
const ACTOR = 'admin:00000000-0000-4000-8000-0000000000aa';
const code = () =>
  `SPK-${'ABCDEFGHJK'[seq % 10]}${'23456789'[Math.floor(seq / 10) % 8]}ZZ${'MNPQRS'[seq++ % 6]}`;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

async function product(stock: number, kind: 'regular' | 'gift_wrap' = 'regular') {
  const slug = `p-${seq++}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.products (slug, name, price_cents, stock, active, kind)
     values ($1, 'Caderno', 2500, $2, true, $3) returning id`,
    [slug, stock, kind],
  );
  return rows[0]!.id;
}

/** Pedido com 2 itens de R$ 25,00, desconto de R$ 5,00 e embalagem de R$ 3,00. */
async function order(status: string, opts: { shipping?: number | null; stock?: number } = {}) {
  const productId = await product(opts.stock ?? 10);
  const giftId = await product(5, 'gift_wrap');
  const shipping = opts.shipping === undefined ? 1500 : opts.shipping;
  const total = 5000 - 500 + (shipping ?? 0) + 300;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.orders (
       code, token_hash, status, customer_name, customer_whatsapp, address, address_type,
       shipping_cents, subtotal_cents, discount_cents, gift_wrap_product_id, gift_wrap_cents,
       total_cents
     ) values ($1, $2, $3, 'Cliente Teste', '79999991234', '{"cep":"49000000"}', 'rural',
       $4, 5000, 500, $5, 300, $6) returning id`,
    [
      code(),
      `hash-${seq}-${Math.random()}`,
      status === 'awaiting_shipping_quote' ? status : 'awaiting_payment',
      shipping,
      giftId,
      total,
    ],
  );
  const id = rows[0]!.id;
  // Pedido novo só nasce aguardando; os demais estados são alcançados pelas transições válidas.
  const path = ['paid', 'preparing', 'shipped', 'delivered'];
  const steps = path.slice(0, path.indexOf(status) + 1);
  for (const step of path.includes(status) ? steps : []) {
    await db.query(`update public.orders set status = $2 where id = $1`, [id, step]);
  }
  await db.query(
    `insert into public.order_items (order_id, product_id, name_snapshot, unit_price_cents, unit_cost_cents, qty)
     values ($1, $2, 'Caderno', 2500, 1000, 2)`,
    [id, productId],
  );
  return { id, productId, giftId };
}

const stockOf = async (id: string) =>
  (await db.query<{ stock: number }>(`select stock from public.products where id = $1`, [id]))
    .rows[0]!.stock;
const orderOf = async (id: string) =>
  (await db.query<Record<string, unknown>>(`select * from public.orders where id = $1`, [id]))
    .rows[0]!;

const call = <T>(sql: string, params: unknown[]) =>
  asRole(db, 'service_role', null, async () => (await db.query<{ r: T }>(sql, params)).rows[0]!.r);

const setStatus = (id: string, status: string, tracking: string | null = null) =>
  call<string>(`select public.admin_set_order_status($1, $2, $3, $4) as r`, [
    id,
    status,
    ACTOR,
    tracking,
  ]);

const quote = (
  id: string,
  opts: { shipping?: number; expected?: number; days?: [number, number]; hours?: number } = {},
) =>
  call<string>(
    `select public.admin_quote_order($1, $2, $3, $4, 'Transportadora Rural', 'Rodonaves', $5,
       'pref-123', 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-123',
       now() + make_interval(hours => $6), $7) as r`,
    [
      id,
      opts.shipping ?? 4000,
      opts.days?.[0] ?? 5,
      opts.days?.[1] ?? 9,
      opts.expected ?? 4000 + 4500 + 300,
      opts.hours ?? 48,
      ACTOR,
    ],
  );

describe('admin_set_order_status', () => {
  it('segue a máquina de transições e registra autor e data', async () => {
    const { id } = await order('paid');
    expect(await setStatus(id, 'shipped')).toBe('invalid_transition');
    expect(await setStatus(id, 'preparing')).toBe('ok');
    expect(await setStatus(id, 'shipped', 'ab123456789br')).toBe('ok');
    const row = await orderOf(id);
    expect(row.status).toBe('shipped');
    expect(row.tracking_code).toBe('AB123456789BR');

    const { rows } = await db.query<{ from_status: string; to_status: string; actor: string }>(
      `select from_status, to_status, actor from public.order_events
        where order_id = $1 and to_status in ('preparing', 'shipped') order by id`,
      [id],
    );
    expect(rows).toEqual([
      { from_status: 'paid', to_status: 'preparing', actor: ACTOR },
      { from_status: 'preparing', to_status: 'shipped', actor: ACTOR },
    ]);
    expect(await setStatus(id, 'delivered')).toBe('ok');
    expect(await setStatus(id, 'preparing')).toBe('invalid_transition');
  });

  it('não deixa a lojista marcar pago, expirado ou aguardando pagamento', async () => {
    const { id } = await order('awaiting_payment');
    for (const status of ['paid', 'expired', 'awaiting_payment', 'qualquer']) {
      await expect(setStatus(id, status)).rejects.toThrow(/invalid_payload/);
    }
    expect((await orderOf(id)).status).toBe('awaiting_payment');
  });

  it('rastreio junto com o status: só em enviado ou entregue, e com audit_log', async () => {
    const { id } = await order('paid');
    expect(await setStatus(id, 'preparing', 'AB123456789BR')).toBe('tracking_not_allowed');
    expect((await orderOf(id)).status).toBe('paid');
    expect(await setStatus(id, 'canceled', 'AB123456789BR')).toBe('tracking_not_allowed');
    expect((await orderOf(id)).tracking_code).toBeNull();
    expect(await setStatus(id, 'preparing')).toBe('ok');
    expect(await setStatus(id, 'shipped', ' ab123456789br ')).toBe('ok');
    const { rows } = await db.query<{ actor: string; diff: Record<string, string> }>(
      `select actor, diff from public.audit_log where entity = 'order_tracking' and entity_id = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: ACTOR,
      diff: { tracking_code: 'AB123456789BR', status: 'shipped' },
    });
  });

  it('recusa rastreio malformado e pedido inexistente', async () => {
    const { id } = await order('preparing');
    expect(await setStatus(id, 'shipped', 'ab 12; drop')).toBe('invalid_tracking');
    expect(await setStatus(id, 'shipped', 'x'.repeat(41))).toBe('invalid_tracking');
    expect((await orderOf(id)).status).toBe('preparing');
    expect(await setStatus('00000000-0000-4000-8000-000000000000', 'shipped')).toBe('not_found');
  });

  it('cancelar pedido aguardando frete devolve o estoque reservado', async () => {
    const { id, productId, giftId } = await order('awaiting_shipping_quote', { shipping: null });
    expect(await setStatus(id, 'canceled')).toBe('ok');
    expect((await orderOf(id)).status).toBe('canceled');
    expect(await stockOf(productId)).toBe(12);
    expect(await stockOf(giftId)).toBe(6);
  });

  it('cancelar pedido pago devolve o estoque, e cancelado é final', async () => {
    const { id, productId, giftId } = await order('paid');
    expect(await setStatus(id, 'canceled')).toBe('ok');
    expect(await stockOf(productId)).toBe(12);
    expect(await stockOf(giftId)).toBe(6);
    expect(await setStatus(id, 'preparing')).toBe('invalid_transition');
    expect(await stockOf(productId)).toBe(12);
  });

  it('cancelar pedido pago grava audit_log com autor, valor e id do pagamento (estorno manual)', async () => {
    const { id } = await order('paid');
    await db.query(
      `update public.orders set mp_payment_id = 'mp-998877', paid_at = now() where id = $1`,
      [id],
    );
    expect(await setStatus(id, 'canceled')).toBe('ok');
    const { rows } = await db.query<{
      actor: string;
      action: string;
      created_at: string;
      diff: Record<string, unknown>;
    }>(
      `select actor, action, created_at, diff from public.audit_log
        where entity = 'order_cancel_paid' and entity_id = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: ACTOR,
      action: 'cancel',
      diff: { refund_cents: 6300, mp_payment_id: 'mp-998877' },
    });
    expect(rows[0]!.created_at).toBeTruthy();
  });

  it('cancelar pedido não pago não grava aviso de estorno', async () => {
    const { id } = await order('awaiting_shipping_quote', { shipping: null });
    expect(await setStatus(id, 'canceled')).toBe('ok');
    const { rows } = await db.query(
      `select 1 from public.audit_log where entity = 'order_cancel_paid' and entity_id = $1`,
      [id],
    );
    expect(rows).toHaveLength(0);
  });

  it('não devolve estoque ao marcar devolvido', async () => {
    const { id, productId } = await order('delivered');
    expect(await setStatus(id, 'returned')).toBe('ok');
    expect(await stockOf(productId)).toBe(10);
  });
});

describe('admin_set_order_tracking', () => {
  const track = (id: string, value: string | null) =>
    call<string>(`select public.admin_set_order_tracking($1, $2, $3) as r`, [id, value, ACTOR]);

  it('grava, troca e apaga o rastreio, com auditoria', async () => {
    const { id } = await order('shipped');
    expect(await track(id, ' br123456789xx ')).toBe('ok');
    expect((await orderOf(id)).tracking_code).toBe('BR123456789XX');
    expect(await track(id, '')).toBe('ok');
    expect((await orderOf(id)).tracking_code).toBeNull();
    const { rows } = await db.query<{ actor: string; diff: { tracking_code: string | null } }>(
      `select actor, diff from public.audit_log where entity = 'order_tracking' and entity_id = $1 order by id`,
      [id],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ actor: ACTOR, diff: { tracking_code: 'BR123456789XX' } });
  });

  it('só vale em separação, enviado ou entregue', async () => {
    const { id } = await order('paid');
    expect(await track(id, 'BR123456789XX')).toBe('invalid_status');
    const quoted = await order('awaiting_payment');
    expect(await track(quoted.id, 'BR123456789XX')).toBe('invalid_status');
    expect(await track(id, 'com espaço')).toBe('invalid_tracking');
    expect(await track('00000000-0000-4000-8000-000000000000', 'BR123456789XX')).toBe('not_found');
  });
});

describe('admin_quote_order (frete a combinar)', () => {
  it('libera a cobrança: recalcula o total, guarda o frete e reserva por 48 h', async () => {
    const { id } = await order('awaiting_shipping_quote', { shipping: null });
    expect(await quote(id)).toBe('ok');
    const row = await orderOf(id);
    expect(row).toMatchObject({
      status: 'awaiting_payment',
      shipping_cents: 4000,
      shipping_days_min: 5,
      shipping_days_max: 9,
      shipping_label: 'Transportadora Rural',
      shipping_carrier: 'Rodonaves',
      total_cents: 8800,
      mp_preference_id: 'pref-123',
    });
    expect(String(row.mp_checkout_url)).toMatch(/^https:\/\//);
    const { rows } = await db.query<{ hours: string }>(
      `select round(extract(epoch from (reserved_until - now())) / 3600)::text as hours
         from public.orders where id = $1`,
      [id],
    );
    expect(rows[0]!.hours).toBe('48');
    const ev = await db.query<{ actor: string }>(
      `select actor from public.order_events where order_id = $1 and to_status = 'awaiting_payment'`,
      [id],
    );
    expect(ev.rows[0]!.actor).toBe(ACTOR);
  });

  it('recusa total diferente do calculado pela API e não muda nada', async () => {
    const { id } = await order('awaiting_shipping_quote', { shipping: null });
    expect(await quote(id, { shipping: 4000, expected: 100 })).toBe('totals_changed');
    const row = await orderOf(id);
    expect(row.status).toBe('awaiting_shipping_quote');
    expect(row.shipping_cents).toBeNull();
  });

  it('recusa subtotal que não bate com os itens gravados', async () => {
    const { id } = await order('awaiting_shipping_quote', { shipping: null });
    await db.query(`update public.order_items set qty = 3 where order_id = $1`, [id]);
    expect(await quote(id)).toBe('totals_changed');
  });

  it('só funciona em pedido aguardando frete (não recota nem cobra pedido pago)', async () => {
    const paid = await order('paid');
    expect(await quote(paid.id)).toBe('invalid_status');
    const { id } = await order('awaiting_shipping_quote', { shipping: null });
    expect(await quote(id)).toBe('ok');
    expect(await quote(id)).toBe('invalid_status');
  });

  it('rejeita valores absurdos: negativo, prazo invertido, validade longa ou link inseguro', async () => {
    const { id } = await order('awaiting_shipping_quote', { shipping: null });
    await expect(quote(id, { shipping: -1, expected: 4799 })).rejects.toThrow(/invalid_payload/);
    await expect(quote(id, { days: [9, 5] })).rejects.toThrow(/invalid_payload/);
    await expect(quote(id, { hours: 100 })).rejects.toThrow(/invalid_payload/);
    await expect(
      call(
        `select public.admin_quote_order($1, 4000, 1, 2, '', '', 8800, 'p', 'http://x.test',
           now() + interval '1 hour', 'a') as r`,
        [id],
      ),
    ).rejects.toThrow(/invalid_payload/);
    expect((await orderOf(id)).status).toBe('awaiting_shipping_quote');
  });

  it('o pagamento do pedido liberado confere o novo total (valor antigo é divergente)', async () => {
    const { id } = await order('awaiting_shipping_quote', { shipping: null });
    await quote(id);
    const pay = (amount: number, ev: string) =>
      call<string>(`select public.mark_order_paid($1, 'mp-9', $2, 'pix', $3, 'h') as r`, [
        id,
        amount,
        ev,
      ]);
    expect(await pay(4800, 'ev-a')).toBe('amount_mismatch');
    expect(await pay(8800, 'ev-b')).toBe('paid');
  });
});

describe('alertas de pagamento (payment_events)', () => {
  it('registra resultado, valor e id do pagamento, sem dado pessoal', async () => {
    const { id } = await order('awaiting_payment');
    const pay = (payment: string, amount: number, ev: string) =>
      call<string>(`select public.mark_order_paid($1, $2, $3, 'pix', $4, 'h') as r`, [
        id,
        payment,
        amount,
        ev,
      ]);
    expect(await pay('mp-1', 1, 'ev-1')).toBe('amount_mismatch');
    expect(await pay('mp-2', 6000, 'ev-2')).toBe('amount_mismatch');
    expect(await pay('mp-3', 6300, 'ev-3')).toBe('paid');
    expect(await pay('mp-4', 6300, 'ev-4')).toBe('double_payment');
    const { rows } = await db.query<{ result: string; amount_cents: number; p: string }>(
      `select result, amount_cents, provider_payment_id as p from public.payment_events
        where order_id = $1 order by id`,
      [id],
    );
    expect(rows.map((r) => r.result)).toEqual([
      'amount_mismatch',
      'amount_mismatch',
      'paid',
      'double_payment',
    ]);
    expect(rows[0]).toMatchObject({ amount_cents: 1, p: 'mp-1' });
  });
});

describe('permissões', () => {
  it('só o service_role executa as funções do painel', async () => {
    const { id } = await order('paid');
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        asRole(db, role, null, () =>
          db.query(`select public.admin_set_order_status($1, 'preparing', 'x')`, [id]),
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        asRole(db, role, null, () =>
          db.query(`select public.admin_set_order_tracking($1, 'ABCD', 'x')`, [id]),
        ),
      ).rejects.toThrow(/permission denied/i);
    }
    expect((await orderOf(id)).status).toBe('paid');
  });
});
