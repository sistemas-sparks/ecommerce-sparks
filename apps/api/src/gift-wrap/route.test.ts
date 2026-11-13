import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import type { SettingsRepo } from '../admin/settings-repo';
import { createTestKey, signToken, testEnv, USER_ID, type TestKey } from '../test-utils';
import type { GiftWrapRepo } from './repo';

let key: TestKey;
beforeAll(async () => {
  key = await createTestKey();
});

const state = { gift_wrap_enabled: false, gift_wrap_models: { total: 2, available: 1 } };
function makeApp(hit = true) {
  const settingsRepo: SettingsRepo = {
    get: vi.fn(async () => state),
    update: vi.fn(async (data) => ({ ...state, gift_wrap_enabled: data.gift_wrap_enabled })),
  };
  const giftWrapRepo: GiftWrapRepo = {
    load: vi.fn(async () => ({ enabled: false, models: [] })),
  };
  const app = createApp({
    settingsRepo: () => settingsRepo,
    giftWrapRepo: () => giftWrapRepo,
    getJwks: async () => [key.publicJwk],
    rateLimitHit: async () => hit,
  });
  return { app, settingsRepo, giftWrapRepo };
}
async function admin(
  app: ReturnType<typeof makeApp>['app'],
  method: string,
  body?: unknown,
  role: string | null = 'admin',
) {
  const token =
    role === null ? null : await signToken(key, { app_metadata: { role }, aal: 'aal2' });
  return app.request(
    '/admin/settings',
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

describe('/admin/settings', () => {
  it('exige login admin', async () => {
    const { app } = makeApp();
    expect((await admin(app, 'GET', undefined, null)).status).toBe(401);
    expect((await admin(app, 'GET', undefined, 'customer')).status).toBe(403);
    expect((await admin(app, 'PATCH', { gift_wrap_enabled: true }, null)).status).toBe(401);
    expect((await admin(app, 'PATCH', { gift_wrap_enabled: true }, 'customer')).status).toBe(403);
  });
  it('GET devolve interruptor e contagem de modelos', async () => {
    const { app } = makeApp();
    const res = await admin(app, 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(state);
  });
  it('PATCH liga e desliga, com autor admin:<id>', async () => {
    const { app, settingsRepo } = makeApp();
    const on = await admin(app, 'PATCH', { gift_wrap_enabled: true });
    expect(on.status).toBe(200);
    expect(((await on.json()) as { gift_wrap_enabled: boolean }).gift_wrap_enabled).toBe(true);
    await admin(app, 'PATCH', { gift_wrap_enabled: false });
    expect(settingsRepo.update).toHaveBeenNthCalledWith(
      1,
      { gift_wrap_enabled: true },
      `admin:${USER_ID}`,
    );
    expect(settingsRepo.update).toHaveBeenNthCalledWith(
      2,
      { gift_wrap_enabled: false },
      `admin:${USER_ID}`,
    );
  });
  it.each([
    [{}],
    [{ gift_wrap_enabled: 'sim' }],
    [{ gift_wrap_enabled: true, free_shipping_min_cents: 0 }],
    [null],
  ])('PATCH rejeita corpo inválido %j com 400', async (body) => {
    const { app, settingsRepo } = makeApp();
    const res = await admin(app, 'PATCH', body);
    expect(res.status).toBe(400);
    expect(settingsRepo.update).not.toHaveBeenCalled();
  });
  it('PATCH respeita o limite de requisições', async () => {
    const { app } = makeApp(false);
    expect((await admin(app, 'PATCH', { gift_wrap_enabled: true })).status).toBe(429);
  });
});

describe('GET /gift-wrap', () => {
  it('funciona sem login, sem cache', async () => {
    const { app, giftWrapRepo } = makeApp();
    const res = await app.request('/gift-wrap', {}, testEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ enabled: false, models: [] });
    expect(giftWrapRepo.load).toHaveBeenCalledOnce();
  });
  it('respeita o limite de requisições', async () => {
    const { app } = makeApp(false);
    expect((await app.request('/gift-wrap', {}, testEnv)).status).toBe(429);
  });
  it('não vaza campo extra do repositório', async () => {
    const { app, giftWrapRepo } = makeApp();
    vi.mocked(giftWrapRepo.load).mockResolvedValueOnce({
      enabled: true,
      models: [
        { id: USER_ID, name: 'x', description: '', priceCents: 1, photo: null, cost_cents: 5 },
      ],
    } as never);
    const res = await app.request('/gift-wrap', {}, testEnv);
    expect(res.status).toBe(500);
  });
});
