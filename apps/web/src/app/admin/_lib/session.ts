// Sessão do painel: a API confirma se o usuário logado é admin (o navegador não decide nada).
import { ApiError, apiFetch } from '@/lib/api';
import { adminMeSchema } from '@sparks/shared';

export interface AdminMe {
  id: string;
  email: string | null;
  aal: 'aal1' | 'aal2';
}

export function fetchAdminMe(accessToken: string): Promise<AdminMe> {
  return apiFetch('/admin/me', { token: accessToken }).then((body) => adminMeSchema.parse(body));
}

/** Código que a API devolve quando o admin ainda não passou pela segunda etapa (TOTP). */
export const MFA_REQUIRED_CODE = 'mfa_required';

export function isMfaRequired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && err.code === MFA_REQUIRED_CODE;
}

/**
 * Pergunta à API se a sessão já pode abrir o painel.
 * 'ready' = admin com duas etapas; 'mfa' = é admin, mas falta cadastrar/confirmar o TOTP.
 * Qualquer outra recusa (401, 403 sem acesso, rede) sobe como ApiError.
 */
export async function resolveAdminAccess(
  accessToken: string,
): Promise<{ state: 'ready'; me: AdminMe } | { state: 'mfa' }> {
  try {
    return { state: 'ready', me: await fetchAdminMe(accessToken) };
  } catch (err) {
    if (isMfaRequired(err)) return { state: 'mfa' };
    throw err;
  }
}

export const LOGIN_PATH = '/admin/login/';
export const HOME_PATH = '/admin/';

/** Motivos de volta ao login, mostrados na tela de login. */
export const LOGIN_NOTICES = {
  'sem-acesso': 'Esta conta não tem acesso ao painel.',
  'sessao-expirada': 'Sua sessão terminou. Entre de novo.',
  verificacao: 'Falta a verificação em duas etapas. Digite o código do aplicativo autenticador.',
} as const;
export type LoginNotice = keyof typeof LOGIN_NOTICES;
