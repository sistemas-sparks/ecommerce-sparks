import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CouponAdminRow } from '@sparks/shared';
import { createApp } from '../app';
import { apiError } from '../lib/errors';
import { createTestKey, signToken, testEnv, USER_ID, type TestKey } from '../test-utils';
import type { CouponsRepo } from './repo';

const couponId = '11111111-1111-4111-8111-111111111111';
let key: TestKey;
let row: CouponAdminRow;
let repo: CouponsRepo;
beforeAll(async () => {
  key = await createTestKey();
});
beforeEach(() => {
  row = {
    id: couponId,
    code: 'BEMVINDA10',
    type: 'percent',
    value: 10,
    minOrderCents: null,
    maxUses: null,
    usedCount: 0,
    startsAt: null,
    endsAt: null,
    active: true,
    createdAt: '2026-10-07T12:00:00.000000+00:00',
  };
  repo = {
    list: vi.fn(async () => [row]),
    create: vi.fn(async () => row),
    update: vi.fn(async () => row),
    remove: vi.fn(async () => {}),
  };
});
const app = (allow = true) =>
  createApp({
    couponsRepo: () => repo,
    getJwks: async () => [key.publicJwk],
    rateLimitHit: async () => allow,
  });
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  role: string | null = 'admin',
  allow = true,
) {
  const token =
    role === null ? null : await signToken(key, { app_metadata: { role }, aal: 'aal2' });
  return app(allow).request(
    path,
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
const input = () => ({
  type: 'percent',
  value: 10,
  minOrderCents: null,
  maxUses: null,
  startsAt: null,
  endsAt: null,
  active: true,
});
const createInput = () => ({ code: 'BEMVINDA10', ...input() });
const errorCode = async (r: Response) =>
  ((await r.json()) as { error: { code: string } }).error.code;

describe('cupons no painel', () => {
  it('recusa sem login (401) e sem papel admin (403), antes do banco', async () => {
    for (const role of [null, 'customer']) {
      const status = role === null ? 401 : 403;
      expect((await request('/admin/coupons', 'GET', undefined, role)).status).toBe(status);
      expect((await request('/admin/coupons', 'POST', createInput(), role)).status).toBe(status);
      expect((await request(`/admin/coupons/${couponId}`, 'PATCH', input(), role)).status).toBe(
        status,
      );
      expect((await request(`/admin/coupons/${couponId}`, 'DELETE', undefined, role)).status).toBe(
        status,
      );
    }
    expect(repo.list).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
  });
  it('lista os cupons', async () => {
    const response = await request('/admin/coupons');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ coupons: [row] });
  });
  it('cria com o autor autenticado e responde 201', async () => {
    const response = await request('/admin/coupons', 'POST', createInput());
    expect(response.status).toBe(201);
    expect(((await response.json()) as CouponAdminRow).code).toBe('BEMVINDA10');
    expect(repo.create).toHaveBeenCalledWith(createInput(), `admin:${USER_ID}`);
  });
  it('código repetido: 409', async () => {
    repo.create = vi.fn(async () => {
      throw apiError(
        409,
        'coupon_code_taken',
        'Já existe um cupom com esse código. Escolha outro.',
      );
    });
    const response = await request('/admin/coupons', 'POST', createInput());
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe('coupon_code_taken');
  });
  it('corpo inválido: 400 (percentual 101, campo extra)', async () => {
    for (const body of [
      { ...createInput(), value: 101 },
      { ...createInput(), usedCount: 5 },
    ]) {
      const response = await request('/admin/coupons', 'POST', body);
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe('invalid_input');
    }
    expect(
      (await request(`/admin/coupons/${couponId}`, 'PATCH', { ...input(), usedCount: 1 })).status,
    ).toBe(400);
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });
  it('edita', async () => {
    const response = await request(`/admin/coupons/${couponId}`, 'PATCH', {
      ...input(),
      value: 20,
    });
    expect(response.status).toBe(200);
    expect(repo.update).toHaveBeenCalledWith(
      couponId,
      { ...input(), value: 20 },
      `admin:${USER_ID}`,
    );
  });
  it('edita cupom inexistente: 404', async () => {
    repo.update = vi.fn(async () => {
      throw apiError(404, 'not_found', 'Não encontrado.');
    });
    expect((await request(`/admin/coupons/${couponId}`, 'PATCH', input())).status).toBe(404);
  });
  it('id que não é uuid: 404', async () => {
    expect((await request('/admin/coupons/abc', 'PATCH', input())).status).toBe(404);
    expect(repo.update).not.toHaveBeenCalled();
  });
  it('limite menor que os usos feitos: 422', async () => {
    repo.update = vi.fn(async () => {
      throw apiError(
        422,
        'coupon_max_uses_below_used',
        'O limite não pode ser menor que os usos já feitos.',
      );
    });
    const response = await request(`/admin/coupons/${couponId}`, 'PATCH', {
      ...input(),
      maxUses: 1,
    });
    expect(response.status).toBe(422);
    expect(await errorCode(response)).toBe('coupon_max_uses_below_used');
  });
  it('exclui (lógica) e responde ok', async () => {
    const response = await request(`/admin/coupons/${couponId}`, 'DELETE');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(repo.remove).toHaveBeenCalledWith(couponId, `admin:${USER_ID}`);
  });
  it('excluir inexistente: 404', async () => {
    repo.remove = vi.fn(async () => {
      throw apiError(404, 'not_found', 'Não encontrado.');
    });
    expect((await request(`/admin/coupons/${couponId}`, 'DELETE')).status).toBe(404);
  });
  it('limite de requisições nas escritas: 429', async () => {
    expect((await request('/admin/coupons', 'POST', createInput(), 'admin', false)).status).toBe(
      429,
    );
    expect(
      (await request(`/admin/coupons/${couponId}`, 'PATCH', input(), 'admin', false)).status,
    ).toBe(429);
    expect(
      (await request(`/admin/coupons/${couponId}`, 'DELETE', undefined, 'admin', false)).status,
    ).toBe(429);
    expect(repo.create).not.toHaveBeenCalled();
  });
});
