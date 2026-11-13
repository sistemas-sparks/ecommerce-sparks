import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MelhorEnvioCalculateRequest } from '@sparks/shared';
import { createMelhorEnvioClient } from './melhor-envio';

const TOKEN = 'token-secreto-de-teste';
const CEP = '49015123';
const request: MelhorEnvioCalculateRequest = {
  from: { postal_code: '49000000' },
  to: { postal_code: CEP },
  products: [
    { id: 'p1', width: 10, height: 5, length: 15, weight: 0.3, insurance_value: 10, quantity: 1 },
  ],
  services: '1,2',
};
const opts = {
  token: TOKEN,
  baseUrl: 'https://sandbox.melhorenvio.com.br',
  userAgent: 'Teste (a@b.dev)',
};

let warn: ReturnType<typeof vi.spyOn>;
function client(fetchImpl: typeof fetch, timeoutMs?: number) {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return createMelhorEnvioClient({ ...opts, fetch: fetchImpl, timeoutMs });
}
afterEach(() => vi.restoreAllMocks());

describe('cliente do Melhor Envio', () => {
  it('chama a URL certa com método, cabeçalhos e corpo', async () => {
    const fake = vi.fn(async () => Response.json([{ id: 1 }]));
    const result = await client(fake as unknown as typeof fetch).calculate(request);
    expect(result).toEqual({ ok: true, items: [{ id: 1 }] });
    const [url, init] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      'User-Agent': opts.userAgent,
    });
    expect(JSON.parse(init.body as string)).toEqual(request);
  });

  it('timeout vira timeout', async () => {
    const fake = (async (_u: unknown, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('abort')));
      })) as unknown as typeof fetch;
    expect(await client(fake, 20).calculate(request)).toEqual({ ok: false, reason: 'timeout' });
  });

  it('erro de rede', async () => {
    const fake = (async () => {
      throw new TypeError('falhou');
    }) as unknown as typeof fetch;
    expect(await client(fake).calculate(request)).toEqual({ ok: false, reason: 'network' });
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [500, 'http_error'],
    [502, 'http_error'],
  ])('status %i vira %s', async (status, reason) => {
    const fake = (async () => new Response('x', { status })) as unknown as typeof fetch;
    expect(await client(fake).calculate(request)).toEqual({ ok: false, reason });
  });

  it('resposta inválida: JSON quebrado, objeto e corpo grande', async () => {
    for (const body of ['{não é json', JSON.stringify({ a: 1 }), 'a'.repeat(256 * 1024 + 1)]) {
      const fake = (async () => new Response(body)) as unknown as typeof fetch;
      expect(await client(fake).calculate(request)).toEqual({
        ok: false,
        reason: 'invalid_response',
      });
    }
  });

  it('requisição inválida não chama a rede', async () => {
    const fake = vi.fn();
    const bad = { ...request, to: { postal_code: 'abc' } };
    expect(await client(fake as unknown as typeof fetch).calculate(bad)).toEqual({
      ok: false,
      reason: 'invalid_response',
    });
    expect(fake).not.toHaveBeenCalled();
  });

  it('o log de falha não traz token nem CEP', async () => {
    const fake = (async () => new Response('x', { status: 401 })) as unknown as typeof fetch;
    await client(fake).calculate(request);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('melhor_envio_failed');
    expect(logged).toContain('401');
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(CEP);
  });
});
