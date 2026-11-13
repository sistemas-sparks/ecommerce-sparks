// T-010 · "Publicar alterações" (painel) e snapshot do catálogo (build do site estático).
// O painel chama POST /admin/publish; a API dispara o deploy hook, no máximo 1 vez a cada 10 min.
// O build roda apps/web/scripts/fetch-catalog.mjs, que lê GET /catalog/snapshot.
import { PUBLISH_MIN_INTERVAL_SECONDS } from '@sparks/shared';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { Bindings } from '../env';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

export const PUBLISH_MESSAGES = {
  notConfigured: 'A publicação automática ainda não foi configurada.',
  tooSoon: (time: string) =>
    `O site foi publicado há pouco. Você pode publicar de novo às ${time}.`,
  failed: 'Não foi possível iniciar a publicação. Tente de novo em instantes.',
};

function publishError(
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: Record<string, string>,
) {
  return new HTTPException(status, {
    res: new Response(JSON.stringify({ error: { code, message, ...(details && { details }) } }), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }),
  });
}

/** URL do deploy hook (secret do Worker). Só HTTPS; sem ela, a publicação fica desligada. */
function deployHookUrl(env: Bindings): string | null {
  const parsed = z.url({ protocol: /^https$/ }).safeParse(env.DEPLOY_HOOK_URL);
  return parsed.success ? parsed.data : null;
}

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
});

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

export const publishAdminRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const last = await c.var.deps.publishRepo(c.var.config).lastPublishAt();
    return c.json({
      configured: deployHookUrl(c.env ?? {}) !== null,
      lastPublishedAt: last,
      nextAllowedAt: last ? addSeconds(last, PUBLISH_MIN_INTERVAL_SECONDS) : null,
    });
  })
  .post('/', async (c) => {
    const hook = deployHookUrl(c.env ?? {});
    if (!hook) throw publishError(503, 'publish_not_configured', PUBLISH_MESSAGES.notConfigured);

    const repo = c.var.deps.publishRepo(c.var.config);
    // Autor pelo id (o e-mail é dado pessoal e não vai para a auditoria).
    const claim = await repo.claim(PUBLISH_MIN_INTERVAL_SECONDS, `admin:${c.var.user.id}`);
    if (!claim.ok) {
      throw publishError(
        429,
        'publish_too_soon',
        PUBLISH_MESSAGES.tooSoon(timeFormatter.format(new Date(claim.next_allowed_at))),
        { nextAllowedAt: claim.next_allowed_at },
      );
    }

    let ok = false;
    try {
      const res = await c.var.deps.fetch(hook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(10000),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      // Devolve a vez: a lojista pode tentar de novo sem esperar os 10 minutos.
      await repo.revert(claim.claimed_at!, claim.previous);
      throw publishError(503, 'publish_failed', PUBLISH_MESSAGES.failed);
    }

    return c.json({ publishedAt: claim.claimed_at, nextAllowedAt: claim.next_allowed_at }, 202);
  });

/** Catálogo público para o build. Os dados são os mesmos que o site mostra; limite generoso. */
export const catalogSnapshotRoutes = new Hono<AppEnv>().get(
  '/snapshot',
  rateLimit({ bucket: 'catalog-snapshot', max: 30, windowSeconds: 3600 }),
  async (c) => c.json(await c.var.deps.publishRepo(c.var.config).snapshot()),
);
