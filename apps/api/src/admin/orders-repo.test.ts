import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../env';
import { testEnv } from '../test-utils';
import { supabaseAdminOrdersRepo } from './orders-repo';

const ID = '11111111-1111-4111-8111-111111111111';
afterEach(() => vi.unstubAllGlobals());

function setup(respond: (url: URL, method: string, body: unknown) => Response) {
  const seen: { url: URL; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const raw = await request.text();
      const entry = {
        url: new URL(request.url),
        method: request.method,
        body: raw ? JSON.parse(raw) : null,
      };
      seen.push(entry);
      return respond(entry.url, entry.method, entry.body);
    }),
  );
  const repo = supabaseAdminOrdersRepo(
    loadConfig({ ...testEnv, SUPABASE_SERVICE_ROLE_KEY: `orders-repo-${crypto.randomUUID()}` }),
  );
  return { repo, seen };
}

describe('pedidos no painel (consultas ao banco)', () => {
  it('filtra por status, período em horário de Brasília e código, com página de 25', async () => {
    const { repo, seen } = setup((url) =>
      url.searchParams.has('limit') || url.searchParams.has('offset')
        ? Response.json([])
        : Response.json([], { headers: { 'content-range': '*/3' } }),
    );
    const list = await repo.list({
      status: 'paid',
      from: '2026-11-01',
      to: '2026-11-12',
      q: 'SPK-7F',
      page: 2,
    });
    expect(list).toMatchObject({ page: 2, hasMore: false });
    const main = seen.find((s) => s.url.searchParams.get('select')?.includes('customer_name'))!;
    const params = main.url.searchParams;
    expect(params.get('status')).toBe('eq.paid');
    expect(params.getAll('created_at')).toEqual([
      'gte.2026-11-01T00:00:00-03:00',
      'lt.2026-11-13T00:00:00-03:00',
    ]);
    expect(params.get('code')).toBe('ilike.%SPK-7F%');
    expect(params.get('offset')).toBe('25');
    expect(params.get('limit')).toBe('26');
    expect(main.url.searchParams.get('select')).not.toContain('whatsapp');
  });

  it('sinaliza próxima página quando há mais de 25 e soma os itens', async () => {
    const row = (n: number) => ({
      id: ID,
      code: 'SPK-ABCDE',
      status: 'paid',
      created_at: '2026-11-12T10:00:00+00:00',
      customer_name: 'Ana',
      total_cents: 1000,
      gift_message: n === 0 ? 'Oi' : null,
      order_items: [{ qty: 2 }, { qty: 1 }],
    });
    const { repo } = setup((url) =>
      url.searchParams.get('select')?.includes('customer_name')
        ? Response.json(Array.from({ length: 26 }, (_, n) => row(n)))
        : Response.json([], { headers: { 'content-range': '*/4' } }),
    );
    const list = await repo.list({ page: 1 });
    expect(list.orders).toHaveLength(25);
    expect(list.hasMore).toBe(true);
    expect(list.orders[0]).toMatchObject({ itemCount: 3, hasGiftMessage: true });
    expect(list.pending).toEqual({ awaitingShippingQuote: 4, paid: 4 });
  });

  it('chama as funções SQL com o autor e devolve só o resultado conhecido', async () => {
    const { repo, seen } = setup(() => Response.json('invalid_transition'));
    expect(await repo.setStatus(ID, 'shipped', 'AB123456789BR', 'admin:x')).toBe(
      'invalid_transition',
    );
    expect(seen[0]!.url.pathname).toMatch(/rpc\/admin_set_order_status$/);
    expect(seen[0]!.body).toEqual({
      p_order_id: ID,
      p_status: 'shipped',
      p_actor: 'admin:x',
      p_tracking: 'AB123456789BR',
    });
  });

  it('falha fechado com resposta inesperada ou erro do banco, sem repassar o texto dele', async () => {
    const odd = setup(() => Response.json('qualquer_coisa'));
    await expect(odd.repo.setTracking(ID, null, 'admin:x')).rejects.toThrow();
    const down = setup(() =>
      Response.json({ message: 'detalhe com 79999991234' }, { status: 500 }),
    );
    await expect(down.repo.setTracking(ID, 'ABCD', 'admin:x')).rejects.toThrow(
      /^admin_orders_repo_set_tracking$/,
    );
  });

  it('pedido inexistente vira null (sem erro)', async () => {
    const { repo } = setup(() => Response.json([]));
    await expect(repo.get(ID)).resolves.toBeNull();
  });
});
