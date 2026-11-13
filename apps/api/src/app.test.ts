import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { checkoutEnabled } from './middleware/checkout-enabled';
import { rateLimit } from './middleware/rate-limit';
import { assertTurnstile } from './middleware/turnstile';
import { SITE_ORIGIN, testEnv } from './test-utils';
import type { Deps } from './types';

function buildApp(deps: Partial<Deps> = {}) {
  const app = createApp({
    rateLimitHit: async () => true,
    getJwks: async () => [],
    fetch: async () => new Response('{}'),
    ...deps,
  });
  app.get('/teste', (c) => c.json({ ok: true }));
  app.post('/teste/limitado', rateLimit({ bucket: 'teste', max: 2, windowSeconds: 60 }), (c) =>
    c.json({ ok: true }),
  );
  app.post('/teste/turnstile', async (c) => {
    const { token } = await c.req.json<{ token: string }>();
    await assertTurnstile(c, token);
    return c.json({ ok: true });
  });
  app.post('/teste/checkout', checkoutEnabled, (c) => c.json({ ok: true }));
  app.get('/teste/erro', () => {
    throw new Error('falha com dado pessoal 79999991234');
  });
  return app;
}

describe('saúde', () => {
  it('GET /health responde mesmo sem configuração', async () => {
    const res = await createApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('configuração', () => {
  it('sem as variáveis obrigatórias responde 503 genérico e loga só os nomes', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await buildApp().request('/teste', {}, { SUPABASE_URL: 'https://x.supabase.co' });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'unavailable' } });
    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toContain('SITE_URL');
    expect(logged).not.toContain('x.supabase.co');
    log.mockRestore();
  });

  it('recusa origem do site sem https', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await buildApp().request(
      '/teste',
      {},
      { ...testEnv, SITE_URL: 'http://loja.teste' },
    );
    expect(res.status).toBe(503);
    vi.restoreAllMocks();
  });
});

describe('cabeçalhos de segurança', () => {
  it('estão em respostas de sucesso e de erro', async () => {
    for (const path of ['/teste', '/nao-existe']) {
      const res = await buildApp().request(path, {}, testEnv);
      expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
      expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
      expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=63072000');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(res.headers.get('Permissions-Policy')).toContain('camera=()');
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('X-Request-Id')).toBeTruthy();
    }
  });

  it('404 tem corpo JSON padronizado', async () => {
    const res = await buildApp().request('/nao-existe', {}, testEnv);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Não encontrado.' } });
  });
});

describe('CORS', () => {
  it('libera as origens configuradas', async () => {
    for (const origin of [SITE_ORIGIN, 'http://localhost:3000']) {
      const res = await buildApp().request('/teste', { headers: { Origin: origin } }, testEnv);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    }
  });

  it('não libera outras origens', async () => {
    const res = await buildApp().request(
      '/teste',
      { headers: { Origin: 'https://site-malicioso.teste' } },
      testEnv,
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('preflight libera Authorization e não usa credenciais', async () => {
    const res = await buildApp().request(
      '/teste/limitado',
      {
        method: 'OPTIONS',
        headers: {
          Origin: SITE_ORIGIN,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type',
        },
      },
      testEnv,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Headers')).toMatch(/Authorization/);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });
});

describe('limite de corpo', () => {
  it('recusa corpo acima de 64 KB com 413', async () => {
    const res = await buildApp().request(
      '/teste/limitado',
      { method: 'POST', body: 'x'.repeat(65 * 1024), headers: { 'Content-Type': 'text/plain' } },
      testEnv,
    );
    expect(res.status).toBe(413);
  });
});

describe('limite de requisições', () => {
  it('bloqueia com 429 e Retry-After quando estoura', async () => {
    const counts = new Map<string, number>();
    const app = buildApp({
      rateLimitHit: async (_config, key, _window, max) => {
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return (counts.get(key) ?? 0) <= max;
      },
    });
    const call = (ip: string) =>
      app.request(
        '/teste/limitado',
        { method: 'POST', headers: { 'cf-connecting-ip': ip } },
        testEnv,
      );

    expect((await call('203.0.113.1')).status).toBe(200);
    expect((await call('203.0.113.1')).status).toBe(200);
    const blocked = await call('203.0.113.1');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('60');
    expect(await blocked.json()).toMatchObject({ error: { code: 'rate_limited' } });

    // Outro IP tem contagem própria.
    expect((await call('203.0.113.2')).status).toBe(200);
  });

  it('não guarda o IP puro na chave', async () => {
    const keys: string[] = [];
    const app = buildApp({
      rateLimitHit: async (_c, key) => {
        keys.push(key);
        return true;
      },
    });
    await app.request(
      '/teste/limitado',
      { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.9' } },
      testEnv,
    );
    expect(keys[0]).toMatch(/^teste:[0-9a-f]{32}$/);
    expect(keys[0]).not.toContain('203.0.113.9');
  });

  it('falha fechada (503) se não conseguir contar', async () => {
    const app = buildApp({
      rateLimitHit: async () => {
        throw new Error('banco fora');
      },
    });
    const res = await app.request('/teste/limitado', { method: 'POST' }, testEnv);
    expect(res.status).toBe(503);
  });
});

describe('Turnstile', () => {
  const post = (app: ReturnType<typeof buildApp>) =>
    app.request(
      '/teste/turnstile',
      {
        method: 'POST',
        body: JSON.stringify({ token: 'token-do-navegador' }),
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.5' },
      },
      testEnv,
    );

  it('passa quando o siteverify confirma, enviando secret, token e IP', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true })));
    const res = await post(buildApp({ fetch: fetchMock }));
    expect(res.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const form = init.body as FormData;
    expect(form.get('secret')).toBe('turnstile-de-teste');
    expect(form.get('response')).toBe('token-do-navegador');
    expect(form.get('remoteip')).toBe('203.0.113.5');
  });

  it('recusa com 403 quando o token é inválido', async () => {
    const res = await post(
      buildApp({ fetch: async () => new Response(JSON.stringify({ success: false })) }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'turnstile_failed' } });
  });

  it('falha fechada quando o siteverify não responde', async () => {
    const res = await post(
      buildApp({
        fetch: async () => {
          throw new Error('timeout');
        },
      }),
    );
    expect(res.status).toBe(403);
  });

  it.each([null, { success: 'true' }, { success: 1 }])(
    'recusa resposta malformada do siteverify: %j',
    async (body) => {
      expect((await post(buildApp({ fetch: async () => Response.json(body) }))).status).toBe(403);
    },
  );
});

describe('interruptor do checkout', () => {
  it('CHECKOUT_ENABLED=false pausa as compras com 503', async () => {
    const res = await buildApp().request(
      '/teste/checkout',
      { method: 'POST' },
      { ...testEnv, CHECKOUT_ENABLED: 'false' },
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'checkout_paused' } });
  });

  it('ligado por padrão', async () => {
    const res = await buildApp().request('/teste/checkout', { method: 'POST' }, testEnv);
    expect(res.status).toBe(200);
  });
});

describe('erros inesperados', () => {
  it('respondem 500 genérico e não logam a mensagem (pode ter dado pessoal)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await buildApp().request('/teste/erro', {}, testEnv);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: 'internal', message: 'Algo deu errado. Tente de novo em instantes.' },
    });
    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).not.toContain('79999991234');
    expect(logged).toContain('"error":"Error"');
    log.mockRestore();
  });
});
