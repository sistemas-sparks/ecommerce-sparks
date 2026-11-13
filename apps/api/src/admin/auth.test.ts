import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import {
  SITE_ORIGIN,
  type TestKey,
  USER_ID,
  createTestKey,
  signToken,
  testEnv,
} from '../test-utils';

let key: TestKey;

beforeAll(async () => {
  key = await createTestKey();
});

function buildApp(rateLimitHit = async () => true) {
  return createApp({ getJwks: async () => [key.publicJwk], rateLimitHit });
}

const me = (token?: string, app = buildApp()) =>
  app.request('/admin/me', { headers: token ? { Authorization: `Bearer ${token}` } : {} }, testEnv);

describe('GET /admin/me', () => {
  it('admin recebe os próprios dados', async () => {
    const res = await me(await signToken(key, { app_metadata: { role: 'admin' }, aal: 'aal2' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: USER_ID, email: 'pessoa@teste.dev', aal: 'aal2' });
  });

  it('sem login: 401', async () => {
    expect((await me()).status).toBe(401);
  });

  it('cliente comum (sem papel admin): 403', async () => {
    const res = await me(await signToken(key));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('papel admin em user_metadata (editável pelo usuário) não vale: 403', async () => {
    const res = await me(await signToken(key, { user_metadata: { role: 'admin' } }));
    expect(res.status).toBe(403);
  });

  it('admin só com a senha (aal1) é barrado com mfa_required', async () => {
    const res = await me(await signToken(key, { app_metadata: { role: 'admin' }, aal: 'aal1' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'mfa_required' } });
  });

  it('admin sem a claim aal também é barrado (falha fechada)', async () => {
    const res = await me(await signToken(key, { app_metadata: { role: 'admin' }, aal: undefined }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'mfa_required' } });
  });

  it('aal2 sem papel admin continua 403 forbidden (e não revela a segunda etapa)', async () => {
    const res = await me(await signToken(key, { aal: 'aal2' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('aal1 sem papel admin: forbidden, não mfa_required', async () => {
    const res = await me(await signToken(key, { aal: 'aal1' }));
    expect(await res.json()).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('aal2 com papel só em user_metadata continua 403', async () => {
    const res = await me(await signToken(key, { user_metadata: { role: 'admin' }, aal: 'aal2' }));
    expect(res.status).toBe(403);
  });

  it('as demais rotas /admin/* também exigem aal2', async () => {
    const token = await signToken(key, { app_metadata: { role: 'admin' }, aal: 'aal1' });
    for (const path of [
      '/admin/products',
      '/admin/coupons',
      '/admin/settings',
      '/admin/shipping/rules',
    ]) {
      const res = await buildApp().request(
        path,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv,
      );
      expect(res.status, path).toBe(403);
      expect(await res.json(), path).toMatchObject({ error: { code: 'mfa_required' } });
    }
  });

  it('rota de admin inexistente também exige login (não revela o que existe)', async () => {
    const res = await buildApp().request('/admin/qualquer-coisa', {}, testEnv);
    expect(res.status).toBe(401);
  });

  it('respeita o limite de requisições', async () => {
    const res = await me(
      await signToken(key, { app_metadata: { role: 'admin' }, aal: 'aal2' }),
      buildApp(async () => false),
    );
    expect(res.status).toBe(429);
  });

  it('preflight do CORS passa sem token', async () => {
    const res = await buildApp().request(
      '/admin/me',
      {
        method: 'OPTIONS',
        headers: {
          Origin: SITE_ORIGIN,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'authorization',
        },
      },
      testEnv,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE_ORIGIN);
  });
});
