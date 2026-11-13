import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../env';
import { testEnv } from '../test-utils';
import { supabaseGiftWrapRepo } from './repo';
import { supabaseSettingsRepo } from '../admin/settings-repo';

type Row = Record<string, unknown>;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const img = (path: string, position: number) => ({ path, alt: null, position });
const products: Row[] = [
  {
    id: B,
    name: 'Caixa Z',
    description: 'z',
    price_cents: 900,
    cost_cents: 100,
    stock: 3,
    kind: 'gift_wrap',
    active: true,
    deleted_at: null,
    product_images: [img('p/2/1080.webp', 2), img('p/1/360.webp', 1)],
  },
  {
    id: A,
    name: 'Caixa A',
    description: 'a',
    price_cents: 500,
    cost_cents: 100,
    stock: 1,
    kind: 'gift_wrap',
    active: true,
    deleted_at: null,
    product_images: [],
  },
  {
    id: 'x1',
    name: 'Sem estoque',
    description: '',
    price_cents: 1,
    cost_cents: 1,
    stock: 0,
    kind: 'gift_wrap',
    active: true,
    deleted_at: null,
    product_images: [],
  },
  {
    id: 'x2',
    name: 'Inativa',
    description: '',
    price_cents: 1,
    cost_cents: 1,
    stock: 5,
    kind: 'gift_wrap',
    active: false,
    deleted_at: null,
    product_images: [],
  },
  {
    id: 'x3',
    name: 'Excluída',
    description: '',
    price_cents: 1,
    cost_cents: 1,
    stock: 5,
    kind: 'gift_wrap',
    active: true,
    deleted_at: '2026-01-01',
    product_images: [],
  },
  {
    id: 'x4',
    name: 'Regular',
    description: '',
    price_cents: 1,
    cost_cents: 1,
    stock: 5,
    kind: 'regular',
    active: true,
    deleted_at: null,
    product_images: [],
  },
];

let enabled = true;
let calls: { method: string; path: string; body: unknown }[] = [];
afterEach(() => vi.unstubAllGlobals());

/** Mini PostgREST: aplica os filtros eq/is/gt da URL sobre `products`. */
function setup() {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const text = await request.text();
      const body = text ? JSON.parse(text) : null;
      calls.push({ method: request.method, path: url.pathname, body });
      if (url.pathname.startsWith('/rest/v1/settings')) {
        if (request.method === 'PATCH') {
          enabled = body.gift_wrap_enabled;
          return Response.json({ id: 1 });
        }
        return Response.json({ gift_wrap_enabled: enabled });
      }
      if (url.pathname.startsWith('/rest/v1/audit_log')) return new Response(null, { status: 201 });
      let rows = products.filter((row) =>
        [...url.searchParams].every(([key, value]) => {
          if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
          if (value === 'is.null') return row[key] === null;
          if (value.startsWith('gt.')) return Number(row[key]) > Number(value.slice(3));
          return true;
        }),
      );
      rows = [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const limit = Number(url.searchParams.get('limit') ?? rows.length);
      return Response.json(rows.slice(0, limit));
    }),
  );
  const config = loadConfig({
    ...testEnv,
    SUPABASE_SERVICE_ROLE_KEY: `gw-test-${crypto.randomUUID()}`,
  });
  return { gift: supabaseGiftWrapRepo(config), settings: supabaseSettingsRepo(config) };
}

describe('repositório público da embalagem', () => {
  it('desligada: não lista nem consulta produtos', async () => {
    enabled = false;
    const { gift } = setup();
    expect(await gift.load()).toEqual({ enabled: false, models: [] });
    expect(calls.some((c) => c.path.includes('/products'))).toBe(false);
  });

  it('ligada: só gift_wrap ativo, com estoque, não excluído, por nome, sem custo nem estoque', async () => {
    enabled = true;
    const { gift } = setup();
    const result = await gift.load();
    expect(result.enabled).toBe(true);
    expect(result.models.map((m) => m.id)).toEqual([A, B]);
    expect(result.models[0]).toMatchObject({ name: 'Caixa A', priceCents: 500, photo: null });
    expect(result.models[1]?.photo?.sources.map((s) => s.width)).toEqual([360, 720, 1080]);
    expect(result.models[1]?.photo?.url).toContain('p/1/360.webp');
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/cost|stock|deleted_at|kind/);
  });

  it('seleciona colunas uma a uma e limita a 20', async () => {
    enabled = true;
    const { gift } = setup();
    await gift.load();
    const request = (fetch as unknown as { mock: { calls: [unknown, unknown][] } }).mock.calls
      .map(([input]) => new URL(String((input as Request).url ?? input)))
      .find((u) => u.pathname.includes('/products'));
    expect(request?.searchParams.get('select')).not.toContain('*');
    expect(request?.searchParams.get('select')).not.toContain('cost');
    expect(request?.searchParams.get('limit')).toBe('20');
  });
});

describe('repositório do interruptor', () => {
  it('conta total e disponíveis', async () => {
    enabled = true;
    const { settings } = setup();
    expect(await settings.get()).toEqual({
      gift_wrap_enabled: true,
      gift_wrap_models: { total: 3, available: 2 },
    });
  });

  it('grava o interruptor e audita sem dados pessoais', async () => {
    enabled = false;
    const { settings } = setup();
    const result = await settings.update({ gift_wrap_enabled: true }, 'admin:u1');
    expect(result.gift_wrap_enabled).toBe(true);
    const audit = calls.find((c) => c.path.includes('audit_log'));
    expect(audit?.body).toEqual({
      actor: 'admin:u1',
      action: 'update',
      entity: 'gift_wrap_settings',
      entity_id: null,
      diff: { gift_wrap_enabled: true },
    });
  });
});
