// Acesso ao painel (R3.8): JWT válido + papel `admin` em app_metadata + verificação em duas etapas
// (TOTP, claim `aal` = aal2), tudo conferido no servidor.
// O papel em app_metadata só pode ser definido pelo servidor (service_role), nunca pelo próprio usuário.
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { MESSAGES, apiError } from '../lib/errors';
import { requireUser } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

export const ADMIN_ROLE = 'admin';
/** Código de erro que a tela de login do painel entende (não mudar sem mudar o site). */
export const MFA_REQUIRED_CODE = 'mfa_required';

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.var.user;
  if (user.appRole !== ADMIN_ROLE) {
    throw apiError(403, 'forbidden', MESSAGES.forbidden);
  }
  // O papel vem primeiro: quem não é admin nunca descobre que existe a segunda etapa.
  // Admin só com a senha (aal1) recebe `mfa_required`; a tela de login usa esse código para
  // abrir o cadastro ou a verificação do TOTP. Nenhuma rota /admin/* responde antes disso.
  if (user.aal !== 'aal2') {
    throw apiError(403, MFA_REQUIRED_CODE, MESSAGES.mfaRequired);
  }
  await next();
});

/** Proteção de todas as rotas /admin/*: limite de requisições, login e papel admin. */
export const adminGuards = [
  rateLimit({ bucket: 'admin', max: 120, windowSeconds: 60 }),
  requireUser,
  requireAdmin,
] as const;

/** Rotas de sessão do painel. */
export const adminAuthRoutes = new Hono<AppEnv>().get('/me', (c) => {
  const { id, email, aal } = c.var.user;
  return c.json({ id, email, aal });
});
