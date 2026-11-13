import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { type TestKey, USER_ID, createTestKey, signToken, testEnv } from '../test-utils';
import { requireUser } from './auth';
import type { Deps } from '../types';

let key: TestKey;
let otherKey: TestKey;

beforeAll(async () => {
  key = await createTestKey('chave-1');
  otherKey = await createTestKey('chave-1'); // mesmo kid, chave diferente (assinatura falsa)
});

function buildApp(getJwks: Deps['getJwks'] = vi.fn(async () => [key.publicJwk])) {
  const app = createApp({ getJwks, rateLimitHit: async () => true });
  app.get('/eu', requireUser, (c) => c.json(c.var.user));
  return { app, getJwks };
}

const call = (app: ReturnType<typeof buildApp>['app'], token?: string) =>
  app.request('/eu', { headers: token ? { Authorization: `Bearer ${token}` } : {} }, testEnv);

describe('requireUser', () => {
  it('aceita token válido e expõe o usuário', async () => {
    const { app } = buildApp();
    const res = await call(app, await signToken(key, { app_metadata: { role: 'admin' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: USER_ID,
      email: 'pessoa@teste.dev',
      aal: 'aal1',
      appRole: 'admin',
    });
  });

  it('sem token: 401 com WWW-Authenticate', async () => {
    const res = await call(buildApp().app);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
  });

  it.each(['abc', 'a.b', 'Basic xyz'])('token malformado "%s": 401', async (token) => {
    const res = await buildApp().app.request('/eu', { headers: { Authorization: token } }, testEnv);
    expect(res.status).toBe(401);
  });

  it('token expirado: 401', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const res = await call(buildApp().app, await signToken(key, { exp: past, iat: past - 3600 }));
    expect(res.status).toBe(401);
  });

  it('token sem exp: 401', async () => {
    const res = await call(buildApp().app, await signToken(key, { exp: undefined }));
    expect(res.status).toBe(401);
  });

  it('assinatura de outra chave: 401', async () => {
    const res = await call(buildApp().app, await signToken(otherKey));
    expect(res.status).toBe(401);
  });

  it('emissor de outro projeto: 401', async () => {
    const res = await call(
      buildApp().app,
      await signToken(key, { iss: 'https://outro.supabase.co/auth/v1' }),
    );
    expect(res.status).toBe(401);
  });

  it('audiência errada (ex.: token anon): 401', async () => {
    const res = await call(buildApp().app, await signToken(key, { aud: 'anon' }));
    expect(res.status).toBe(401);
  });

  it('sub que não é uuid: 401', async () => {
    const res = await call(buildApp().app, await signToken(key, { sub: 'admin' }));
    expect(res.status).toBe(401);
  });

  it('recusa HS256 (segredo compartilhado)', async () => {
    const { Jwt } = await import('hono/utils/jwt');
    const now = Math.floor(Date.now() / 1000);
    const token = await Jwt.sign(
      { sub: USER_ID, iss: `${testEnv.SUPABASE_URL}/auth/v1`, aud: 'authenticated', exp: now + 60 },
      'segredo',
      'HS256',
    );
    expect((await call(buildApp().app, token)).status).toBe(401);
  });

  it('kid desconhecido: busca o JWKS de novo uma vez (rotação de chave)', async () => {
    const rotated = await createTestKey('chave-2');
    const getJwks = vi.fn(async (_config, opts?: { refresh?: boolean }) =>
      opts?.refresh ? [key.publicJwk, rotated.publicJwk] : [key.publicJwk],
    );
    const { app } = buildApp(getJwks);
    const res = await call(app, await signToken(rotated));
    expect(res.status).toBe(200);
    expect(getJwks).toHaveBeenCalledTimes(2);
  });

  it('JWKS indisponível: 503 (falha fechada)', async () => {
    const { app } = buildApp(
      vi.fn(async () => {
        throw new Error('rede');
      }),
    );
    const res = await call(app, await signToken(key));
    expect(res.status).toBe(503);
  });

  it('aal2 é repassado quando presente', async () => {
    const res = await call(buildApp().app, await signToken(key, { aal: 'aal2' }));
    expect(await res.json()).toMatchObject({ aal: 'aal2' });
  });
});
