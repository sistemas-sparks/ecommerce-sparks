import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../env';
import { testEnv, USER_ID } from '../test-utils';
import { supabaseShippingRepo } from './repo';

const rowId = '33333333-3333-4333-8333-333333333333';
afterEach(() => vi.unstubAllGlobals());

function setup(body: unknown, status = 200) {
  const writes: { table: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const table = new URL(request.url).pathname.split('/').at(-1) ?? '';
      const text = await request.text();
      writes.push({ table, body: text ? JSON.parse(text) : null });
      return Response.json(table === 'audit_log' ? null : body, {
        status: table === 'audit_log' ? 201 : status,
      });
    }),
  );
  const repo = supabaseShippingRepo(
    loadConfig({
      ...testEnv,
      SUPABASE_SERVICE_ROLE_KEY: `shipping-repo-test-${crypto.randomUUID()}`,
    }),
  );
  return { repo, writes };
}

describe('persistência do frete', () => {
  it('registra o ID criado e o autor no histórico de auditoria', async () => {
    const { repo, writes } = setup({ id: rowId }, 201);
    await repo.save('zones', null, { name: 'Zona de teste', ufs: ['SE'], active: true }, USER_ID);
    expect(writes.at(-1)).toEqual({
      table: 'audit_log',
      body: {
        actor: USER_ID,
        action: 'create',
        entity: 'shipping_zones',
        entity_id: rowId,
        diff: {},
      },
    });
  });

  it('não aceita identificador malformado da resposta externa como sucesso', async () => {
    const { repo, writes } = setup({ id: 'identificador-inválido' });
    await expect(repo.save('zones', null, {}, USER_ID)).rejects.toThrow();
    expect(writes.some((write) => write.table === 'audit_log')).toBe(false);
  });

  it('exclusão de cadastro inexistente não informa sucesso nem inventa auditoria', async () => {
    const { repo, writes } = setup({ code: 'PGRST116', message: 'Nenhuma linha' }, 406);
    await expect(repo.remove('zones', rowId, USER_ID)).rejects.toMatchObject({ status: 404 });
    expect(writes.some((write) => write.table === 'audit_log')).toBe(false);
  });

  it('falha de gravação na auditoria é reportada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const table = new URL(String(input)).pathname.split('/').at(-1);
        return Response.json(table === 'audit_log' ? { code: 'XX000' } : { id: rowId }, {
          status: table === 'audit_log' ? 500 : 201,
        });
      }),
    );
    const repo = supabaseShippingRepo(
      loadConfig({ ...testEnv, SUPABASE_SERVICE_ROLE_KEY: 'shipping-test-audit-unavailable' }),
    );
    await expect(repo.save('zones', null, {}, USER_ID)).rejects.toMatchObject({ status: 503 });
  });
});

describe('leitura híbrida', () => {
  it('lê só ativos e valida o formato das linhas', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        urls.push(url.toString());
        const table = url.pathname.split('/').at(-1);
        const size = { weight_g: 100, length_cm: 16, width_cm: 11, height_cm: 4 };
        const bodies: Record<string, unknown> = {
          shipping_cep_exceptions: [],
          package_sizes: ['P', 'M', 'G'].map((s) => ({ size: s, ...size })),
          settings: {
            origin_cep: null,
            origin_uf: null,
            handling_days: 1,
            free_shipping_min_cents: null,
            max_items_auto_shipping: null,
            max_weight_auto_g: null,
            package_tare_g: 0,
            cubic_divisor: null,
            gift_wrap_enabled: false,
            melhor_envio_margin_cents: 0,
          },
          shipping_own_types: [],
          shipping_own_areas: [],
          melhor_envio_services: [
            { service_id: 1, name: 'PAC', carrier: 'Correios', enabled: true, sort_order: 0 },
          ],
        };
        return Response.json(bodies[table ?? '']);
      }),
    );
    const repo = supabaseShippingRepo(
      loadConfig({ ...testEnv, SUPABASE_SERVICE_ROLE_KEY: `hybrid-test-${crypto.randomUUID()}` }),
    );
    const data = await repo.loadHybrid();
    expect(data.melhor_envio_services).toHaveLength(1);
    expect(urls.some((u) => u.includes('shipping_own_areas') && u.includes('active=eq.true'))).toBe(
      true,
    );
    expect(
      urls.some((u) => u.includes('melhor_envio_services') && u.includes('enabled=eq.true')),
    ).toBe(true);
  });
});

describe('entidades do frete híbrido', () => {
  it('audita a criação de tipo próprio', async () => {
    const { repo, writes } = setup({ id: rowId }, 201);
    await repo.save('own-types', null, { name: 'Local', active: true, sort_order: 0 }, USER_ID);
    expect(writes.at(-1)?.body).toMatchObject({
      action: 'create',
      entity: 'shipping_own_types',
      entity_id: rowId,
    });
  });
  it('audita a edição de serviço do Melhor Envio pelo service_id', async () => {
    const { repo, writes } = setup({ service_id: 2 });
    await repo.save('me-services', '2', { enabled: false }, USER_ID);
    expect(writes.at(-1)?.body).toMatchObject({
      action: 'update',
      entity: 'melhor_envio_services',
      entity_id: '2',
    });
  });
  it('não cria serviço do Melhor Envio', async () => {
    const { repo } = setup({ service_id: 9 });
    await expect(repo.save('me-services', null, {}, USER_ID)).rejects.toMatchObject({
      status: 400,
    });
  });
  it('exclui área e audita', async () => {
    const { repo, writes } = setup({ id: rowId });
    await repo.remove('own-areas', rowId, USER_ID);
    expect(writes.at(-1)?.body).toMatchObject({ action: 'delete', entity: 'shipping_own_areas' });
  });
});
