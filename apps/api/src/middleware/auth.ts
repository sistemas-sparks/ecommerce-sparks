// Validação do JWT do Supabase Auth em cada requisição autenticada (docs/arquitetura.md §6).
// Só chaves assimétricas (JWT Signing Keys do Supabase, ES256/RS256) via JWKS; HS256 é recusado.
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { Jwt } from 'hono/utils/jwt';
import { authClaimsSchema } from '@sparks/shared';
import { MESSAGES, apiError } from '../lib/errors';
import type { AppEnv } from '../types';

const ALLOWED_ALGORITHMS = ['ES256', 'RS256'] as const;
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

export interface AuthUser {
  id: string;
  email: string | null;
  /** Nível de autenticação: aal2 = passou pela verificação em duas etapas. */
  aal: 'aal1' | 'aal2';
  /** Papel definido pelo servidor em app_metadata (o usuário não consegue alterar). */
  appRole: string | null;
}

const unauthorized = () =>
  apiError(401, 'unauthorized', MESSAGES.unauthorized, { 'WWW-Authenticate': 'Bearer' });

async function keysFor(c: Context<AppEnv>, kid: string) {
  const { config, deps } = c.var;
  try {
    let keys = await deps.getJwks(config);
    // Chave nova (rotação): busca o JWKS de novo uma vez.
    if (!keys.some((k) => k.kid === kid)) keys = await deps.getJwks(config, { refresh: true });
    return keys;
  } catch {
    throw apiError(503, 'unavailable', MESSAGES.unavailable);
  }
}

/** Exige um usuário logado (cliente ou admin). Disponível depois em `c.var.user`. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = BEARER.exec(c.req.header('Authorization') ?? '')?.[1];
  if (!token) throw unauthorized();

  let kid: string | undefined;
  try {
    kid = Jwt.decode(token).header.kid;
  } catch {
    throw unauthorized();
  }
  if (!kid) throw unauthorized();

  const keys = await keysFor(c, kid);
  let payload: unknown;
  try {
    payload = await Jwt.verifyWithJwks(token, {
      keys: keys as Parameters<typeof Jwt.verifyWithJwks>[1]['keys'],
      allowedAlgorithms: ALLOWED_ALGORITHMS,
      verification: { iss: `${c.var.config.supabaseUrl}/auth/v1`, aud: 'authenticated' },
    });
  } catch {
    throw unauthorized();
  }

  const claims = authClaimsSchema.safeParse(payload);
  if (!claims.success) throw unauthorized();

  c.set('user', {
    id: claims.data.sub,
    email: claims.data.email ?? null,
    aal: claims.data.aal ?? 'aal1',
    appRole: claims.data.app_metadata?.role ?? null,
  });
  await next();
});
