'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError } from '@/lib/api';
import { missingAdminConfig, publicConfig } from '@/lib/public-config';
import { getSupabase } from '@/lib/supabase';
import { Button } from '@/ui';
import { adminLoginSchema } from '@sparks/shared';
import { MfaStep } from '../_components/mfa-step';
import { Turnstile } from '../_components/turnstile';
import { HOME_PATH, LOGIN_NOTICES, type LoginNotice, resolveAdminAccess } from '../_lib/session';

const MESSAGES = {
  invalid: 'E-mail ou senha incorretos.',
  captcha: 'Confirme que você não é um robô e tente de novo.',
  tooMany: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  generic: 'Não foi possível entrar agora. Tente de novo em instantes.',
};

// Aviso vindo da URL (?motivo=...), lido sem quebrar a página estática.
function subscribeNoop() {
  return () => {};
}
function readNotice(): string | null {
  const reason = new URLSearchParams(window.location.search).get('motivo');
  return reason && Object.hasOwn(LOGIN_NOTICES, reason)
    ? LOGIN_NOTICES[reason as LoginNotice]
    : null;
}

const missing = missingAdminConfig();

export default function AdminLoginPage() {
  const router = useRouter();
  const notice = useSyncExternalStore(subscribeNoop, readNotice, () => null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [step, setStep] = useState<'password' | 'mfa'>('password');
  const needsCaptcha = Boolean(publicConfig.turnstileSiteKey);

  // Já logado: a API diz se pode abrir o painel ou se falta a segunda etapa (TOTP).
  useEffect(() => {
    let active = true;
    const supabase = getSupabase();
    supabase?.auth
      .getSession()
      .then(async ({ data }) => {
        if (!data.session) return;
        const access = await resolveAdminAccess(data.session.access_token);
        if (!active) return;
        if (access.state === 'mfa') setStep('mfa');
        else router.replace(HOME_PATH);
      })
      .catch(() => {
        // Sessão sem acesso ao painel ou API fora do ar: fica na tela de e-mail e senha.
      });
    return () => {
      active = false;
    };
  }, [router]);

  const onToken = useCallback((token: string | null) => setCaptchaToken(token), []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = getSupabase();
    if (!supabase || loading || missing.length > 0) return;
    const input = adminLoginSchema.safeParse({ email: email.trim(), password });
    if (!input.success) {
      setError('Confira o e-mail e preencha a senha.');
      return;
    }
    if (needsCaptcha && !captchaToken) {
      setError(MESSAGES.captcha);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        ...input.data,
        options: captchaToken ? { captchaToken } : undefined,
      });
      // Cada token do Turnstile vale uma vez.
      if (needsCaptcha) setCaptchaReset((n) => n + 1);

      if (authError || !data.session) {
        setLoading(false);
        if (authError?.code === 'invalid_credentials') setError(MESSAGES.invalid);
        else if (authError?.code === 'captcha_failed') setError(MESSAGES.captcha);
        else if (authError?.status === 429) setError(MESSAGES.tooMany);
        else setError(MESSAGES.generic);
        return;
      }

      // A API confere o papel admin primeiro; só quem é admin chega à segunda etapa.
      const access = await resolveAdminAccess(data.session.access_token);
      if (access.state === 'mfa') {
        setPassword('');
        setStep('mfa');
        return;
      }
      router.replace(HOME_PATH);
    } catch (err) {
      await supabase.auth.signOut().catch(() => {});
      setLoading(false);
      if (err instanceof ApiError && err.status === 403) setError(LOGIN_NOTICES['sem-acesso']);
      else if (err instanceof ApiError && err.status === 429) setError(MESSAGES.tooMany);
      else setError(err instanceof ApiError ? err.message : MESSAGES.generic);
    } finally {
      setLoading(false);
    }
  }

  // Segunda etapa pronta: a sessão agora é aal2; a API confirma e o painel abre.
  async function onMfaVerified() {
    const supabase = getSupabase();
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    if (!data.session) throw new Error('sem sessão');
    const access = await resolveAdminAccess(data.session.access_token);
    if (access.state !== 'ready') throw new Error('aal2 não confirmado');
    router.replace(HOME_PATH);
  }

  async function onMfaCancel() {
    await getSupabase()
      ?.auth.signOut()
      .catch(() => {});
    setStep('password');
    setError(null);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-12">
      <h1 className="font-display text-5xl leading-none font-extrabold text-plum">
        Painel da loja
      </h1>

      {step === 'mfa' && missing.length === 0 ? (
        <>
          {notice && <p className="mt-6 text-ink">{notice}</p>}
          <MfaStep onVerified={onMfaVerified} onCancel={() => void onMfaCancel()} />
        </>
      ) : missing.length > 0 ? (
        <p role="alert" className="mt-6 text-ink-soft">
          O painel ainda não foi configurado neste ambiente. Faltam as variáveis:{' '}
          <span className="font-bold text-ink">{missing.join(', ')}</span>.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5" noValidate>
          {notice && !error && <p className="text-ink">{notice}</p>}

          <label className="flex flex-col gap-2 font-bold">
            E-mail
            <input
              type="email"
              name="email"
              autoComplete="username"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="admin-input"
            />
          </label>

          <label className="flex flex-col gap-2 font-bold">
            Senha
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="admin-input"
            />
          </label>

          {needsCaptcha && (
            <Turnstile
              siteKey={publicConfig.turnstileSiteKey}
              onToken={onToken}
              resetKey={captchaReset}
            />
          )}

          {error && (
            <p role="alert" className="font-bold text-magenta-dark">
              {error}
            </p>
          )}

          <Button type="submit" loading={loading} disabled={!email || !password}>
            Entrar
          </Button>
        </form>
      )}
    </main>
  );
}
