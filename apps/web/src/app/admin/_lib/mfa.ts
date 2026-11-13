// Verificação em duas etapas do painel (R3.8): cadastro e confirmação do TOTP pelo Supabase Auth.
// Quem decide o acesso é a API (exige a claim aal2); aqui só conduzimos a pessoa pelas etapas.
import type { SupabaseClient } from '@supabase/supabase-js';
import { totpCodeSchema } from '@sparks/shared';

export type MfaApi = SupabaseClient['auth']['mfa'];

export type MfaStart =
  | { kind: 'verify'; factorId: string }
  | { kind: 'enroll'; factorId: string; qrSrc: string | null; secret: string };

export type MfaErrorCode = 'invalid_code' | 'too_many' | 'generic';

export class MfaError extends Error {
  constructor(readonly code: MfaErrorCode) {
    super(code);
    this.name = 'MfaError';
  }
}

export const MFA_MESSAGES: Record<MfaErrorCode, string> = {
  invalid_code: 'Código incorreto ou vencido. Confira o aplicativo e tente de novo.',
  too_many: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  generic: 'Não foi possível concluir agora. Tente de novo em instantes.',
};

const SVG_PREFIX = 'data:image/svg+xml';

/** Só aceita SVG em data URL, mostrado em <img> (scripts de SVG não rodam nesse modo). */
export function qrImageSource(qrCode: string | undefined): string | null {
  if (!qrCode) return null;
  if (qrCode.startsWith(SVG_PREFIX)) return qrCode;
  if (!qrCode.trimStart().startsWith('<svg')) return null;
  return `${SVG_PREFIX};charset=utf-8,${encodeURIComponent(qrCode)}`;
}

/**
 * Decide a etapa: com um TOTP já confirmado, só pede o código; sem nenhum, cadastra um novo.
 * Cadastros abandonados (nunca confirmados) são apagados antes, para não acumular.
 * Nunca oferece um segundo cadastro quando já existe um TOTP confirmado.
 */
export async function startMfa(mfa: MfaApi): Promise<MfaStart> {
  const listed = await mfa.listFactors();
  if (listed.error || !listed.data) throw new MfaError('generic');

  const confirmed = listed.data.totp[0];
  if (confirmed) return { kind: 'verify', factorId: confirmed.id };

  for (const factor of listed.data.all) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified') {
      await mfa.unenroll({ factorId: factor.id });
    }
  }

  const enrolled = await mfa.enroll({
    factorType: 'totp',
    friendlyName: `painel-${Date.now()}`,
    issuer: 'Sparks Papelaria',
  });
  if (enrolled.error || !enrolled.data) throw new MfaError('generic');
  return {
    kind: 'enroll',
    factorId: enrolled.data.id,
    qrSrc: qrImageSource(enrolled.data.totp.qr_code),
    secret: enrolled.data.totp.secret,
  };
}

/** Confere o código de 6 dígitos. Em caso de sucesso a sessão passa a ser aal2. */
export async function verifyMfa(mfa: MfaApi, factorId: string, rawCode: string): Promise<void> {
  const code = totpCodeSchema.safeParse(rawCode);
  if (!code.success) throw new MfaError('invalid_code');

  const { error } = await mfa.challengeAndVerify({ factorId, code: code.data });
  if (!error) return;
  if (error.status === 429 || error.code === 'over_request_rate_limit') {
    throw new MfaError('too_many');
  }
  if (error.code === 'mfa_verification_failed' || error.code === 'mfa_challenge_expired') {
    throw new MfaError('invalid_code');
  }
  throw new MfaError('generic');
}
