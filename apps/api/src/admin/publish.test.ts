import type { ClaimPublishResult, PublicCatalog } from '@sparks/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import type { Bindings } from '../env';
import { type TestKey, createTestKey, signToken, testEnv, USER_ID } from '../test-utils';
import type { PublishRepo } from './publish-repo';

const HOOK = 'https://api.cloudflare.com/deploy-hook/teste';
const env: Bindings = { ...testEnv, DEPLOY_HOOK_URL: HOOK };

let key: TestKey;
let adminToken: string;
let customerToken: string;

beforeAll(async () => {
  key = await createTestKey();
  adminToken = await signToken(key, { app_metadata: { role: 'admin' }, aal: 'aal2' });
  customerToken = await signToken(key);
});

const CLAIMED_AT = '2026-10-07T15:00:00.000Z';
const NEXT = '2026-10-07T15:10:00.000Z';

let claimResult: ClaimPublishResult;
let reverted: [string, string | null][];
let actors: string[];
let hookStatus: number | 'error';
let hookCalls: string[];

const catalog: PublicCatalog = {
  categories: [],
  products: [],
  contact: { whatsapp: null, address: null },
  instagram_images: [],
  banners: [],
  bio_links: [],
};

const repo: PublishRepo = {
  async claim(_interval, actor) {
    actors.push(actor);
    return claimResult;
  },
  async revert(claimedAt, previous) {
    reverted.push([claimedAt, previous]);
  },
  async lastPublishAt() {
    return CLAIMED_AT;
  },
  async snapshot() {
    return catalog;
  },
};

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  hookCalls.push(String(input));
  if (hookStatus === 'error') throw new Error('rede');
  return new Response('{}', { status: hookStatus });
});

beforeEach(() => {
  claimResult = { ok: true, previous: null, claimed_at: CLAIMED_AT, next_allowed_at: NEXT };
  reverted = [];
  actors = [];
  hookStatus = 200;
  hookCalls = [];
});

function app(rateLimitHit = async () => true) {
  return createApp({
    getJwks: async () => [key.publicJwk],
    rateLimitHit,
    fetch: fetchMock,
    publishRepo: () => repo,
  });
}

const publish = (token = adminToken, e: Bindings = env) =>
  app().request(
    '/admin/publish',
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
    e,
  );

async function errorOf(res: Response) {
  return ((await res.json()) as { error: { code: string; message: string } }).error;
}

describe('POST /admin/publish', () => {
  it('dispara o deploy hook e devolve quando poderá publicar de novo', async () => {
    const res = await publish();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ publishedAt: CLAIMED_AT, nextAllowedAt: NEXT });
    expect(hookCalls).toEqual([HOOK]);
    // Autor pelo id, sem e-mail.
    expect(actors).toEqual([`admin:${USER_ID}`]);
  });

  it('dentro dos 10 minutos: 429 com o horário de São Paulo e sem chamar o hook', async () => {
    claimResult = { ok: false, previous: CLAIMED_AT, claimed_at: null, next_allowed_at: NEXT };
    const res = await publish();
    expect(res.status).toBe(429);
    const error = await errorOf(res);
    expect(error.code).toBe('publish_too_soon');
    // 15:10 UTC = 12:10 em São Paulo.
    expect(error.message).toBe(
      'O site foi publicado há pouco. Você pode publicar de novo às 12:10.',
    );
    expect(hookCalls).toHaveLength(0);
  });

  it.each([500, 'error'] as const)(
    'hook falhou (%s): devolve a vez e responde 503',
    async (status) => {
      hookStatus = status;
      const res = await publish();
      expect(res.status).toBe(503);
      expect(await errorOf(res)).toMatchObject({ code: 'publish_failed' });
      expect(reverted).toEqual([[CLAIMED_AT, null]]);
    },
  );

  it('sem DEPLOY_HOOK_URL (ou sem HTTPS): 503 sem reservar a vez', async () => {
    for (const e of [testEnv, { ...testEnv, DEPLOY_HOOK_URL: 'http://inseguro.teste/hook' }]) {
      const res = await publish(adminToken, e);
      expect(res.status).toBe(503);
      expect(await errorOf(res)).toMatchObject({ code: 'publish_not_configured' });
    }
    expect(actors).toHaveLength(0);
  });

  it('cliente comum não publica (403) e sem login (401)', async () => {
    expect((await publish(customerToken)).status).toBe(403);
    const res = await app().request('/admin/publish', { method: 'POST' }, env);
    expect(res.status).toBe(401);
    expect(hookCalls).toHaveLength(0);
  });
});

describe('GET /admin/publish', () => {
  it('mostra a última publicação e se o hook está configurado', async () => {
    const res = await app().request(
      '/admin/publish',
      { headers: { Authorization: `Bearer ${adminToken}` } },
      env,
    );
    expect(await res.json()).toEqual({
      configured: true,
      lastPublishedAt: CLAIMED_AT,
      nextAllowedAt: NEXT,
    });
  });
});

describe('GET /catalog/snapshot', () => {
  it('é público e devolve o catálogo', async () => {
    const res = await app().request('/catalog/snapshot', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(catalog);
  });

  it('respeita o limite de requisições', async () => {
    const res = await app(async () => false).request('/catalog/snapshot', {}, env);
    expect(res.status).toBe(429);
  });
});
