// T-014 · create_order e release_order: estoque atômico, cupom, embalagem, rural e devolução.
import type { PGlite } from '@electric-sql/pglite';
import { computeDiscount } from '@sparks/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asRole, createTestDb } from './db';

let db: PGlite;
let seq = 0;

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function nextCode(): string {
  let n = seq++;
  let s = '';
  for (let i = 0; i < 5; i++) {
    s += ALPHABET[n % ALPHABET.length];
    n = Math.floor(n / ALPHABET.length);
  }
  return `SPK-${s}`;
}

let whatsappSeq = 0;
const nextWhatsapp = () => `799${String(10000000 + whatsappSeq++)}`;

async function product(opts: {
  slug: string;
  price: number;
  stock: number;
  cost?: number;
  kind?: 'regular' | 'gift_wrap';
  active?: boolean;
}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.products (slug, name, price_cents, cost_cents, stock, kind, active)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      opts.slug,
      `Produto ${opts.slug}`,
      opts.price,
      opts.cost ?? 0,
      opts.stock,
      opts.kind ?? 'regular',
      opts.active ?? true,
    ],
  );
  return rows[0]!.id;
}

async function stockOf(id: string): Promise<number> {
  const { rows } = await db.query<{ stock: number }>(
    `select stock from public.products where id = $1`,
    [id],
  );
  return rows[0]!.stock;
}

interface Payload {
  items: { product_id: string; qty: number }[];
  expected_subtotal_cents: number;
  expected_discount_cents?: number;
  coupon_code?: string;
  gift_wrap_product_id?: string;
  shipping?: {
    service: string;
    cents: number;
    days_min: number;
    days_max: number;
    label?: string;
    carrier?: string | null;
  } | null;
  customer_whatsapp?: string;
}

function payload(p: Payload) {
  return {
    code: nextCode(),
    token_hash: `hash-${seq}-${Math.random()}`,
    customer_name: 'Cliente Teste',
    customer_whatsapp: p.customer_whatsapp ?? nextWhatsapp(),
    address: { cep: '49000000', street: 'Rua Teste', number: '1' },
    address_type: p.shipping === null ? 'rural' : 'urban',
    expected_discount_cents: 0,
    shipping: { service: 'economy', cents: 1500, days_min: 3, days_max: 6 },
    reserve_minutes: 30,
    ...p,
  };
}

interface Created {
  order_id: string;
  code: string;
  status: string;
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number | null;
  gift_wrap_cents: number;
  total_cents: number;
  reserved_until: string | null;
}

function createOrder(p: ReturnType<typeof payload>): Promise<Created> {
  return asRole(db, 'service_role', null, async () => {
    const { rows } = await db.query<{ r: Created }>(`select public.create_order($1::jsonb) as r`, [
      JSON.stringify(p),
    ]);
    return rows[0]!.r;
  });
}

function releaseOrder(orderId: string, status: string): Promise<boolean> {
  return asRole(db, 'service_role', null, async () => {
    const { rows } = await db.query<{ r: boolean }>(
      `select public.release_order($1, $2, 'teste') as r`,
      [orderId, status],
    );
    return rows[0]!.r;
  });
}

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

describe('create_order — pedido normal', () => {
  it('grava o pedido, a cópia dos itens, baixa o estoque e reserva por 30 min', async () => {
    const caneta = await product({ slug: 'caneta-a', price: 1990, cost: 800, stock: 5 });
    const caderno = await product({ slug: 'caderno-a', price: 3500, cost: 1500, stock: 2 });

    const created = await createOrder(
      payload({
        items: [
          { product_id: caneta, qty: 2 },
          { product_id: caderno, qty: 1 },
        ],
        expected_subtotal_cents: 7480,
      }),
    );

    expect(created).toMatchObject({
      status: 'awaiting_payment',
      subtotal_cents: 7480,
      discount_cents: 0,
      shipping_cents: 1500,
      gift_wrap_cents: 0,
      total_cents: 8980,
    });
    const minutes = (new Date(created.reserved_until!).getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);

    expect(await stockOf(caneta)).toBe(3);
    expect(await stockOf(caderno)).toBe(1);

    const { rows: items } = await db.query(
      `select name_snapshot, unit_price_cents, unit_cost_cents, qty from public.order_items
        where order_id = $1 order by unit_price_cents`,
      [created.order_id],
    );
    expect(items).toEqual([
      { name_snapshot: 'Produto caneta-a', unit_price_cents: 1990, unit_cost_cents: 800, qty: 2 },
      { name_snapshot: 'Produto caderno-a', unit_price_cents: 3500, unit_cost_cents: 1500, qty: 1 },
    ]);

    const { rows: events } = await db.query(
      `select to_status, actor from public.order_events where order_id = $1`,
      [created.order_id],
    );
    expect(events).toEqual([{ to_status: 'awaiting_payment', actor: 'checkout' }]);
  });

  it('a cópia do preço não muda quando o produto muda depois', async () => {
    const id = await product({ slug: 'lapis-a', price: 500, stock: 3 });
    const created = await createOrder(
      payload({ items: [{ product_id: id, qty: 1 }], expected_subtotal_cents: 500 }),
    );
    await db.query(`update public.products set price_cents = 900, name = 'Outro' where id = $1`, [
      id,
    ]);
    const { rows } = await db.query(
      `select name_snapshot, unit_price_cents from public.order_items where order_id = $1`,
      [created.order_id],
    );
    expect(rows).toEqual([{ name_snapshot: 'Produto lapis-a', unit_price_cents: 500 }]);
  });
});

describe('create_order — estoque', () => {
  it('recusa quantidade maior que o estoque e não mexe em nada', async () => {
    const id = await product({ slug: 'borracha-a', price: 300, stock: 1 });
    await expect(
      createOrder(payload({ items: [{ product_id: id, qty: 2 }], expected_subtotal_cents: 600 })),
    ).rejects.toThrow('out_of_stock');
    expect(await stockOf(id)).toBe(1);
  });

  it('a última unidade vai para um pedido só; o estoque nunca fica negativo', async () => {
    const id = await product({ slug: 'estojo-a', price: 2500, stock: 1 });
    const p = () => payload({ items: [{ product_id: id, qty: 1 }], expected_subtotal_cents: 2500 });
    await createOrder(p());
    await expect(createOrder(p())).rejects.toThrow('out_of_stock');
    expect(await stockOf(id)).toBe(0);
  });

  it('se um item falha, os outros também não são baixados (tudo ou nada)', async () => {
    const ok = await product({ slug: 'ok-a', price: 100, stock: 10 });
    const sem = await product({ slug: 'sem-a', price: 100, stock: 0 });
    await expect(
      createOrder(
        payload({
          items: [
            { product_id: ok, qty: 1 },
            { product_id: sem, qty: 1 },
          ],
          expected_subtotal_cents: 200,
        }),
      ),
    ).rejects.toThrow('out_of_stock');
    expect(await stockOf(ok)).toBe(10);
  });

  it('produto inativo, apagado, inexistente ou do tipo embalagem não é vendido como item', async () => {
    const inativo = await product({ slug: 'inativo-a', price: 100, stock: 5, active: false });
    const apagado = await product({ slug: 'apagado-a', price: 100, stock: 5 });
    await db.query(`update public.products set deleted_at = now() where id = $1`, [apagado]);
    const embalagem = await product({ slug: 'emb-a', price: 100, stock: 5, kind: 'gift_wrap' });
    for (const id of [inativo, apagado, embalagem, '00000000-0000-4000-8000-000000000999']) {
      await expect(
        createOrder(payload({ items: [{ product_id: id, qty: 1 }], expected_subtotal_cents: 100 })),
      ).rejects.toThrow('product_unavailable');
    }
  });

  it('recusa produto repetido na lista', async () => {
    const id = await product({ slug: 'repetido-a', price: 100, stock: 5 });
    await expect(
      createOrder(
        payload({
          items: [
            { product_id: id, qty: 1 },
            { product_id: id, qty: 1 },
          ],
          expected_subtotal_cents: 200,
        }),
      ),
    ).rejects.toThrow('invalid_payload');
  });
});

describe('create_order — recálculo no banco', () => {
  it('preço alterado entre a cotação e a compra: recusa e não grava nada', async () => {
    const id = await product({ slug: 'mudou-a', price: 1000, stock: 5 });
    await expect(
      createOrder(payload({ items: [{ product_id: id, qty: 1 }], expected_subtotal_cents: 900 })),
    ).rejects.toThrow('totals_changed');
    expect(await stockOf(id)).toBe(5);
  });
});

describe('create_order — cupom', () => {
  beforeEach(async () => {
    await db.query(`delete from public.coupon_redemptions`);
  });

  it('percentual arredonda para baixo, reserva o uso e registra o resgate pendente', async () => {
    const id = await product({ slug: 'cupom-a', price: 1999, stock: 5 });
    await db.query(
      `insert into public.coupons (code, type, value, max_uses) values ('DEZ15', 'percent', 15, 10)`,
    );
    const created = await createOrder(
      payload({
        items: [{ product_id: id, qty: 1 }],
        coupon_code: 'dez15',
        expected_subtotal_cents: 1999,
        expected_discount_cents: 299,
      }),
    );
    expect(created).toMatchObject({ discount_cents: 299, total_cents: 1999 - 299 + 1500 });

    const { rows } = await db.query(
      `select c.used_count, r.status from public.coupons c
         join public.coupon_redemptions r on r.coupon_id = c.id where c.code = 'DEZ15'`,
    );
    expect(rows).toEqual([{ used_count: 1, status: 'pending' }]);
  });

  it('cupom fixo maior que o subtotal zera só os produtos', async () => {
    const id = await product({ slug: 'cupom-b', price: 1000, stock: 5 });
    await db.query(
      `insert into public.coupons (code, type, value) values ('FIXO50', 'fixed', 5000)`,
    );
    const created = await createOrder(
      payload({
        items: [{ product_id: id, qty: 1 }],
        coupon_code: 'FIXO50',
        expected_subtotal_cents: 1000,
        expected_discount_cents: 1000,
      }),
    );
    expect(created.total_cents).toBe(1500);
  });

  it('inexistente, inativo, vencido, futuro e esgotado dão a mesma resposta', async () => {
    const id = await product({ slug: 'cupom-c', price: 1000, stock: 50 });
    await db.exec(`
      insert into public.coupons (code, type, value, active) values ('INATIVO', 'percent', 10, false);
      insert into public.coupons (code, type, value, ends_at) values ('VENCIDO', 'percent', 10, now() - interval '1 minute');
      insert into public.coupons (code, type, value, starts_at) values ('FUTURO', 'percent', 10, now() + interval '1 day');
      insert into public.coupons (code, type, value, max_uses, used_count) values ('ESGOTADO', 'percent', 10, 1, 1);
    `);
    for (const code of ['NAOEXISTE', 'INATIVO', 'VENCIDO', 'FUTURO', 'ESGOTADO']) {
      await expect(
        createOrder(
          payload({
            items: [{ product_id: id, qty: 1 }],
            coupon_code: code,
            expected_subtotal_cents: 1000,
            expected_discount_cents: 100,
          }),
        ),
        code,
      ).rejects.toThrow('coupon_invalid');
    }
  });

  it('abaixo da compra mínima: coupon_min_order; no limite exato: aplica', async () => {
    const id = await product({ slug: 'cupom-d', price: 2500, stock: 50 });
    await db.query(
      `insert into public.coupons (code, type, value, min_order_cents) values ('MIN50', 'fixed', 500, 5000)`,
    );
    await expect(
      createOrder(
        payload({
          items: [{ product_id: id, qty: 1 }],
          coupon_code: 'MIN50',
          expected_subtotal_cents: 2500,
          expected_discount_cents: 500,
        }),
      ),
    ).rejects.toThrow('coupon_min_order');
    const created = await createOrder(
      payload({
        items: [{ product_id: id, qty: 2 }],
        coupon_code: 'MIN50',
        expected_subtotal_cents: 5000,
        expected_discount_cents: 500,
      }),
    );
    expect(created.discount_cents).toBe(500);
  });

  it('o último uso do cupom vai para um pedido só', async () => {
    const id = await product({ slug: 'cupom-e', price: 1000, stock: 50 });
    await db.query(
      `insert into public.coupons (code, type, value, max_uses) values ('UMAVEZ', 'fixed', 100, 1)`,
    );
    const p = () =>
      payload({
        items: [{ product_id: id, qty: 1 }],
        coupon_code: 'UMAVEZ',
        expected_subtotal_cents: 1000,
        expected_discount_cents: 100,
      });
    await createOrder(p());
    await expect(createOrder(p())).rejects.toThrow('coupon_invalid');
  });

  it('o desconto do banco é igual ao de packages/shared (mesma regra nos dois lados)', async () => {
    const cases: [number, number][] = [
      [1, 50],
      [99, 10],
      [1999, 15],
      [10000, 33],
      [12345, 7],
      [5000, 100],
    ];
    for (const [subtotal, percent] of cases) {
      const { rows } = await db.query<{ d: number }>(
        `select floor($1::numeric * $2 / 100)::integer as d`,
        [subtotal, percent],
      );
      const ts = computeDiscount(subtotal, {
        type: 'percent',
        value: percent,
        minOrderCents: null,
      });
      expect(rows[0]!.d, `${percent}% de ${subtotal}`).toBe(ts.discountCents);
    }
  });
});

describe('create_order — embalagem de presente', () => {
  it('recusa quando a embalagem está desligada no painel', async () => {
    const id = await product({ slug: 'emb-item-a', price: 1000, stock: 5 });
    const emb = await product({ slug: 'emb-b', price: 800, stock: 5, kind: 'gift_wrap' });
    await db.query(`update public.settings set gift_wrap_enabled = false`);
    await expect(
      createOrder(
        payload({
          items: [{ product_id: id, qty: 1 }],
          gift_wrap_product_id: emb,
          expected_subtotal_cents: 1000,
        }),
      ),
    ).rejects.toThrow('gift_wrap_unavailable');
  });

  it('ligada: soma o valor, baixa 1 do estoque e o cupom não desconta a embalagem', async () => {
    const id = await product({ slug: 'emb-item-b', price: 1000, stock: 5 });
    const emb = await product({ slug: 'emb-c', price: 800, stock: 2, kind: 'gift_wrap' });
    await db.query(`update public.settings set gift_wrap_enabled = true`);
    await db.query(
      `insert into public.coupons (code, type, value) values ('TUDO', 'percent', 100)`,
    );
    const created = await createOrder(
      payload({
        items: [{ product_id: id, qty: 1 }],
        gift_wrap_product_id: emb,
        coupon_code: 'TUDO',
        expected_subtotal_cents: 1000,
        expected_discount_cents: 1000,
      }),
    );
    expect(created).toMatchObject({ gift_wrap_cents: 800, total_cents: 0 + 1500 + 800 });
    expect(await stockOf(emb)).toBe(1);
  });

  it('embalagem sem estoque é recusada', async () => {
    const id = await product({ slug: 'emb-item-c', price: 1000, stock: 5 });
    const emb = await product({ slug: 'emb-d', price: 800, stock: 0, kind: 'gift_wrap' });
    await db.query(`update public.settings set gift_wrap_enabled = true`);
    await expect(
      createOrder(
        payload({
          items: [{ product_id: id, qty: 1 }],
          gift_wrap_product_id: emb,
          expected_subtotal_cents: 1000,
        }),
      ),
    ).rejects.toThrow('gift_wrap_unavailable');
  });
});

describe('create_order — frete a combinar (rural)', () => {
  it('fica aguardando frete, sem cobrança de frete, sem prazo, e reserva o estoque', async () => {
    const id = await product({ slug: 'rural-a', price: 2000, stock: 3 });
    const created = await createOrder(
      payload({
        items: [{ product_id: id, qty: 1 }],
        expected_subtotal_cents: 2000,
        shipping: null,
      }),
    );
    expect(created).toMatchObject({
      status: 'awaiting_shipping_quote',
      shipping_cents: null,
      total_cents: 2000,
      reserved_until: null,
    });
    expect(await stockOf(id)).toBe(2);
  });
});

describe('create_order — snapshot do frete híbrido (T-028)', () => {
  async function shippingOf(orderId: string) {
    const { rows } = await db.query<{
      shipping_service: string | null;
      shipping_label: string | null;
      shipping_carrier: string | null;
    }>(
      `select shipping_service, shipping_label, shipping_carrier from public.orders where id = $1`,
      [orderId],
    );
    return rows[0]!;
  }

  it('grava rótulo e transportadora; aceita own:<uuid> e me:2', async () => {
    const id = await product({ slug: 'hib-a', price: 2000, stock: 5 });
    const own = await createOrder(
      payload({
        items: [{ product_id: id, qty: 1 }],
        expected_subtotal_cents: 2000,
        shipping: {
          service: 'own:3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b',
          cents: 800,
          days_min: 1,
          days_max: 2,
          label: 'Entrega local · Centro',
          carrier: null,
        },
      }),
    );
    expect(await shippingOf(own.order_id)).toEqual({
      shipping_service: 'own:3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b',
      shipping_label: 'Entrega local · Centro',
      shipping_carrier: null,
    });
    const me = await createOrder(
      payload({
        items: [{ product_id: id, qty: 1 }],
        expected_subtotal_cents: 2000,
        shipping: {
          service: 'me:2',
          cents: 2290,
          days_min: 4,
          days_max: 7,
          label: 'SEDEX',
          carrier: 'Correios',
        },
      }),
    );
    expect(await shippingOf(me.order_id)).toEqual({
      shipping_service: 'me:2',
      shipping_label: 'SEDEX',
      shipping_carrier: 'Correios',
    });
  });
});

describe('create_order — pedidos pendentes demais', () => {
  it('no máximo 3 pedidos pendentes por WhatsApp na última hora', async () => {
    const id = await product({ slug: 'pendente-a', price: 100, stock: 50 });
    const whatsapp = nextWhatsapp();
    const p = () =>
      payload({
        items: [{ product_id: id, qty: 1 }],
        expected_subtotal_cents: 100,
        customer_whatsapp: whatsapp,
      });
    await createOrder(p());
    await createOrder(p());
    await createOrder(p());
    await expect(createOrder(p())).rejects.toThrow('too_many_pending');
  });
});

describe('release_order', () => {
  it('cancela, devolve estoque, embalagem e uso do cupom; repetir não faz nada', async () => {
    const id = await product({ slug: 'devolve-a', price: 1000, stock: 4 });
    const emb = await product({ slug: 'emb-e', price: 800, stock: 3, kind: 'gift_wrap' });
    await db.query(`update public.settings set gift_wrap_enabled = true`);
    await db.query(`insert into public.coupons (code, type, value) values ('VOLTA', 'fixed', 100)`);
    const created = await createOrder(
      payload({
        items: [{ product_id: id, qty: 2 }],
        gift_wrap_product_id: emb,
        coupon_code: 'VOLTA',
        expected_subtotal_cents: 2000,
        expected_discount_cents: 100,
      }),
    );
    expect(await stockOf(id)).toBe(2);
    expect(await stockOf(emb)).toBe(2);

    expect(await releaseOrder(created.order_id, 'canceled')).toBe(true);
    expect(await stockOf(id)).toBe(4);
    expect(await stockOf(emb)).toBe(3);
    const { rows } = await db.query(
      `select c.used_count, r.status, o.status as order_status, o.reserved_until
         from public.coupons c join public.coupon_redemptions r on r.coupon_id = c.id
         join public.orders o on o.id = r.order_id where c.code = 'VOLTA'`,
    );
    expect(rows).toEqual([
      { used_count: 0, status: 'released', order_status: 'canceled', reserved_until: null },
    ]);

    // Idempotente: a segunda chamada não devolve estoque de novo.
    expect(await releaseOrder(created.order_id, 'canceled')).toBe(false);
    expect(await stockOf(id)).toBe(4);
  });

  it('expira pedido aguardando pagamento', async () => {
    const id = await product({ slug: 'expira-a', price: 1000, stock: 1 });
    const created = await createOrder(
      payload({ items: [{ product_id: id, qty: 1 }], expected_subtotal_cents: 1000 }),
    );
    expect(await releaseOrder(created.order_id, 'expired')).toBe(true);
    expect(await stockOf(id)).toBe(1);
  });

  it('pedido aguardando frete não expira (só a lojista cancela)', async () => {
    const id = await product({ slug: 'expira-b', price: 1000, stock: 1 });
    const created = await createOrder(
      payload({
        items: [{ product_id: id, qty: 1 }],
        expected_subtotal_cents: 1000,
        shipping: null,
      }),
    );
    await expect(releaseOrder(created.order_id, 'expired')).rejects.toThrow(/transição/);
    expect(await stockOf(id)).toBe(0);
  });

  it('pedido pago não é liberado', async () => {
    const id = await product({ slug: 'pago-a', price: 1000, stock: 1 });
    const created = await createOrder(
      payload({ items: [{ product_id: id, qty: 1 }], expected_subtotal_cents: 1000 }),
    );
    await db.query(`update public.orders set status = 'paid' where id = $1`, [created.order_id]);
    expect(await releaseOrder(created.order_id, 'canceled')).toBe(false);
    expect(await stockOf(id)).toBe(0);
  });
});

describe('permissões', () => {
  it('anon e authenticated não executam create_order nem release_order', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        asRole(db, role, null, () => db.query(`select public.create_order('{}'::jsonb)`)),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asRole(db, role, null, () =>
          db.query(
            `select public.release_order('00000000-0000-4000-8000-000000000001', 'canceled')`,
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
