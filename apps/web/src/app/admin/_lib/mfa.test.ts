import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MfaError, type MfaApi, qrImageSource, startMfa, verifyMfa } from './mfa';

// Supabase Auth simulado: nenhuma chamada de rede.
function fakeMfa(overrides: Record<string, unknown> = {}) {
  const mfa = {
    listFactors: vi.fn(async () => ({ data: { all: [], totp: [] }, error: null })),
    unenroll: vi.fn(async () => ({ data: {}, error: null })),
    enroll: vi.fn(async () => ({
      data: {
        id: 'f-new',
        type: 'totp',
        totp: { qr_code: '<svg></svg>', secret: 'SEGREDO', uri: 'otpauth://x' },
      },
      error: null,
    })),
    challengeAndVerify: vi.fn(async () => ({ data: {}, error: null })),
    ...overrides,
  };
  return mfa as typeof mfa & MfaApi;
}

describe('qrImageSource', () => {
  it('aceita data URL de SVG e converte SVG puro', () => {
    expect(qrImageSource('data:image/svg+xml;utf-8,<svg/>')).toBe(
      'data:image/svg+xml;utf-8,<svg/>',
    );
    expect(qrImageSource('<svg a="1"></svg>')).toMatch(
      /^data:image\/svg\+xml;charset=utf-8,%3Csvg/,
    );
  });

  it('recusa qualquer outra coisa (javascript:, html, vazio)', () => {
    expect(qrImageSource('javascript:alert(1)')).toBeNull();
    expect(qrImageSource('<img src=x onerror=alert(1)>')).toBeNull();
    expect(qrImageSource('data:text/html,<script>1</script>')).toBeNull();
    expect(qrImageSource(undefined)).toBeNull();
  });
});

describe('startMfa', () => {
  it('com TOTP já confirmado, só pede o código e nunca cadastra outro', async () => {
    const mfa = fakeMfa({
      listFactors: vi.fn(async () => ({
        data: {
          all: [{ id: 'f1', factor_type: 'totp', status: 'verified' }],
          totp: [{ id: 'f1' }],
        },
        error: null,
      })),
    });
    expect(await startMfa(mfa)).toEqual({ kind: 'verify', factorId: 'f1' });
    expect(mfa.enroll).not.toHaveBeenCalled();
  });

  it('sem TOTP, apaga cadastros abandonados e cadastra um novo', async () => {
    const mfa = fakeMfa({
      listFactors: vi.fn(async () => ({
        data: { all: [{ id: 'velho', factor_type: 'totp', status: 'unverified' }], totp: [] },
        error: null,
      })),
    });
    const start = await startMfa(mfa);
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'velho' });
    expect(mfa.enroll).toHaveBeenCalledWith(expect.objectContaining({ factorType: 'totp' }));
    expect(start).toMatchObject({ kind: 'enroll', factorId: 'f-new', secret: 'SEGREDO' });
  });

  it('erro do Supabase vira falha genérica', async () => {
    const mfa = fakeMfa({
      listFactors: vi.fn(async () => ({ data: null, error: { status: 500 } })),
    });
    await expect(startMfa(mfa)).rejects.toMatchObject({ code: 'generic' });
  });
});

describe('verifyMfa', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('envia o código sem espaços', async () => {
    const mfa = fakeMfa();
    await verifyMfa(mfa, 'f1', ' 123 456 ');
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: '123456' });
  });

  it('código malformado nem chega ao Supabase', async () => {
    const mfa = fakeMfa();
    await expect(verifyMfa(mfa, 'f1', '12ab')).rejects.toBeInstanceOf(MfaError);
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 400, code: 'mfa_verification_failed' }, 'invalid_code'],
    [{ status: 400, code: 'mfa_challenge_expired' }, 'invalid_code'],
    [{ status: 429, code: 'over_request_rate_limit' }, 'too_many'],
    [{ status: 500, code: 'unexpected_failure' }, 'generic'],
  ])('erro %j vira %s', async (error, code) => {
    const mfa = fakeMfa({ challengeAndVerify: vi.fn(async () => ({ data: null, error })) });
    await expect(verifyMfa(mfa, 'f1', '123456')).rejects.toMatchObject({ code });
  });
});
