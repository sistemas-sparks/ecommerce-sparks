import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShippingHybridAdminData } from '@sparks/shared';
import { createApp } from '../app';
import { createTestKey, signToken, testEnv, USER_ID, type TestKey } from '../test-utils';
import type { ShippingRepo } from './repo';

const typeId = '11111111-1111-4111-8111-111111111111';
const areaId = '22222222-2222-4222-8222-222222222222';
let key: TestKey;
let repo: ShippingRepo;
let data: ShippingHybridAdminData;

beforeAll(async () => {
  key = await createTestKey();
});
beforeEach(() => {
  const size = { weight_g: 100, length_cm: 16, width_cm: 11, height_cm: 4 };
  data = {
    exceptions: [],
    package_sizes: [
      { size: 'P', ...size },
      { size: 'M', ...size },
      { size: 'G', ...size },
    ],
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
      melhor_envio_margin_cents: 250,
    },
    own_types: [{ id: typeId, name: 'Entrega local', active: true, sort_order: 0 }],
    own_areas: [],
    me_services: [
      { service_id: 1, name: 'PAC', carrier: 'Correios', enabled: true, sort_order: 0 },
    ],
  };
  repo = {
    load: vi.fn(),
    loadAdmin: vi.fn(async () => data),
    loadHybrid: vi.fn(),
    products: vi.fn(),
    coupon: vi.fn(),
    save: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    settings: vi.fn(async () => {}),
  } as unknown as ShippingRepo;
});

async function call(path: string, method = 'GET', body?: unknown, role: string | null = 'admin') {
  const token =
    role === null ? null : await signToken(key, { app_metadata: { role }, aal: 'aal2' });
  return createApp({
    shippingRepo: () => repo,
    getJwks: async () => [key.publicJwk],
    rateLimitHit: async () => true,
  }).request(
    `/admin/shipping${path}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    testEnv,
  );
}
const type = { name: 'Entrega local', active: true, sort_order: 1 };
const area = {
  type_id: typeId,
  label: 'Centro',
  cep_start: '49000-000',
  cep_end: '49009999',
  price_cents: 800,
  days_min: 0,
  days_max: 1,
  active: true,
};

describe('GET /admin/shipping', () => {
  it('exige login admin', async () => {
    expect((await call('', 'GET', undefined, null)).status).toBe(401);
    expect((await call('', 'GET', undefined, 'customer')).status).toBe(403);
  });
  it('devolve tipos, áreas, serviços e a folga', async () => {
    const res = await call('');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ShippingHybridAdminData;
    expect(body.own_types).toHaveLength(1);
    expect(body.me_services[0]?.service_id).toBe(1);
    expect(body.settings.melhor_envio_margin_cents).toBe(250);
    expect(body).not.toHaveProperty('zones');
    expect(body).not.toHaveProperty('rates');
    expect(body).not.toHaveProperty('local_rules');
  });
});

describe('tipos de frete próprio', () => {
  it('cria, edita e exclui com o autor do login', async () => {
    expect((await call('/own-types', 'POST', type)).status).toBe(201);
    expect(repo.save).toHaveBeenCalledWith('own-types', null, type, USER_ID);
    expect((await call(`/own-types/${typeId}`, 'PATCH', { ...type, active: false })).status).toBe(
      200,
    );
    expect(repo.save).toHaveBeenLastCalledWith(
      'own-types',
      typeId,
      { ...type, active: false },
      USER_ID,
    );
    expect((await call(`/own-types/${typeId}`, 'DELETE')).status).toBe(200);
    expect(repo.remove).toHaveBeenCalledWith('own-types', typeId, USER_ID);
  });
  it('recusa nome vazio e id inválido', async () => {
    expect((await call('/own-types', 'POST', { ...type, name: '  ' })).status).toBe(400);
    expect((await call('/own-types/abc', 'PATCH', type)).status).toBe(400);
    expect((await call('/own-types/abc', 'DELETE')).status).toBe(400);
    expect(repo.save).not.toHaveBeenCalled();
  });
});

describe('áreas por faixa de CEP', () => {
  it('cria (normaliza o CEP), edita e exclui', async () => {
    expect((await call('/own-areas', 'POST', area)).status).toBe(201);
    expect(repo.save).toHaveBeenCalledWith(
      'own-areas',
      null,
      { ...area, cep_start: '49000000' },
      USER_ID,
    );
    expect((await call(`/own-areas/${areaId}`, 'PATCH', { ...area, price_cents: 0 })).status).toBe(
      200,
    );
    expect((await call(`/own-areas/${areaId}`, 'DELETE')).status).toBe(200);
    expect(repo.remove).toHaveBeenCalledWith('own-areas', areaId, USER_ID);
  });
  it.each([
    ['CEP inválido', { cep_start: '4900' }],
    ['início maior que o fim', { cep_start: '49010000', cep_end: '49000000' }],
    ['preço negativo', { price_cents: -1 }],
    ['preço fracionado', { price_cents: 8.5 }],
    ['prazo mínimo maior que o máximo', { days_min: 3, days_max: 1 }],
    ['tipo inválido', { type_id: 'x' }],
  ])('recusa %s sem ecoar a entrada', async (_name, patch) => {
    const res = await call('/own-areas', 'POST', { ...area, ...patch });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('4900');
    expect(repo.save).not.toHaveBeenCalled();
  });
  it('id inválido na edição e exclusão', async () => {
    expect((await call('/own-areas/1', 'PATCH', area)).status).toBe(400);
    expect((await call('/own-areas/1', 'DELETE')).status).toBe(400);
  });
});

describe('serviços do Melhor Envio', () => {
  it('liga e desliga por PATCH', async () => {
    expect((await call('/me-services/2', 'PATCH', { enabled: false })).status).toBe(200);
    expect(repo.save).toHaveBeenCalledWith('me-services', '2', { enabled: false }, USER_ID);
  });
  it('não cria nem exclui serviço e recusa id inválido', async () => {
    expect((await call('/me-services', 'POST', { enabled: true })).status).toBe(400);
    expect((await call('/me-services/2', 'DELETE')).status).toBe(400);
    expect((await call('/me-services/0', 'PATCH', { enabled: true })).status).toBe(400);
    expect((await call('/me-services/abc', 'PATCH', { enabled: true })).status).toBe(400);
    expect((await call('/me-services/2', 'PATCH', { enabled: 'sim' })).status).toBe(400);
  });
});

describe('PATCH /settings (folga)', () => {
  const settings = () => {
    const { gift_wrap_enabled: _g, melhor_envio_margin_cents: _m, ...rest } = data.settings;
    void _g;
    void _m;
    return rest;
  };
  it('aceita folga em centavos inteiros', async () => {
    const body = { ...settings(), melhor_envio_margin_cents: 300 };
    expect((await call('/settings', 'PATCH', body)).status).toBe(200);
    expect(repo.settings).toHaveBeenCalledWith(body, USER_ID);
  });
  it.each([-1, 2.5, 100001])('recusa folga %s', async (value) => {
    const res = await call('/settings', 'PATCH', {
      ...settings(),
      melhor_envio_margin_cents: value,
    });
    expect(res.status).toBe(400);
    expect(repo.settings).not.toHaveBeenCalled();
  });
});

describe('rotas antigas removidas', () => {
  it.each(['zones', 'rates', 'local-rules'])('%s responde 404', async (name) => {
    expect((await call(`/${name}`, 'POST', {})).status).toBe(404);
    expect((await call(`/${name}/${areaId}`, 'PATCH', {})).status).toBe(404);
    expect((await call(`/${name}/${areaId}`, 'DELETE')).status).toBe(404);
  });
});
