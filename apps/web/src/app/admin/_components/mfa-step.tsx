'use client';

// Segunda etapa do login do painel: cadastro do aplicativo autenticador (primeiro acesso)
// ou digitação do código de 6 dígitos (acessos seguintes).
import { type FormEvent, useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { Button } from '@/ui';
import { MFA_MESSAGES, MfaError, type MfaStart, startMfa, verifyMfa } from '../_lib/mfa';

type Loaded = { status: 'loading' } | { status: 'ready'; start: MfaStart } | { status: 'failed' };

export interface MfaStepProps {
  /** Chamado depois que o código foi aceito (a sessão já é aal2). */
  onVerified: () => void | Promise<void>;
  /** Sai da conta e volta para o e-mail e a senha. */
  onCancel: () => void;
}

export function MfaStep({ onVerified, onCancel }: MfaStepProps) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const mfa = getSupabase()?.auth.mfa;
    if (!mfa) {
      queueMicrotask(() => active && setLoaded({ status: 'failed' }));
      return;
    }
    startMfa(mfa).then(
      (start) => active && setLoaded({ status: 'ready', start }),
      () => active && setLoaded({ status: 'failed' }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const mfa = getSupabase()?.auth.mfa;
    if (!mfa || loaded.status !== 'ready' || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyMfa(mfa, loaded.start.factorId, code);
      await onVerified();
    } catch (err) {
      setCode('');
      setError(MFA_MESSAGES[err instanceof MfaError ? err.code : 'generic']);
    } finally {
      setBusy(false);
    }
  }

  if (loaded.status === 'loading') {
    return (
      <p role="status" className="mt-8 text-ink-soft">
        Preparando a verificação…
      </p>
    );
  }

  if (loaded.status === 'failed') {
    return (
      <div className="mt-8 flex flex-col gap-5">
        <p role="alert" className="font-bold text-magenta-dark">
          {MFA_MESSAGES.generic}
        </p>
        <Button
          type="button"
          onClick={() => {
            setLoaded({ status: 'loading' });
            setAttempt((n) => n + 1);
          }}
        >
          Tentar de novo
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Voltar
        </Button>
      </div>
    );
  }

  const { start } = loaded;
  return (
    <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5" noValidate>
      {start.kind === 'enroll' ? (
        <section aria-labelledby="mfa-enroll-title" className="flex flex-col gap-3">
          <h2 id="mfa-enroll-title" className="text-xl font-extrabold text-ink">
            Proteja o painel com duas etapas
          </h2>
          <p className="text-ink">
            Abra um aplicativo autenticador no celular (como Google Authenticator, Microsoft
            Authenticator ou Authy), escolha adicionar conta e leia o código abaixo. Depois digite
            aqui os 6 números que o aplicativo mostrar.
          </p>
          {start.qrSrc && (
            // QR em SVG (data URL) gerado pelo Supabase Auth; não há outro tipo de origem aqui.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={start.qrSrc}
              alt="Código QR para cadastrar o aplicativo autenticador"
              width={192}
              height={192}
              className="self-center rounded-xl border-2 border-line bg-white p-2"
            />
          )}
          <p className="text-ink-soft">
            Sem câmera? No aplicativo, escolha digitar uma chave e use:{' '}
            <span className="font-bold break-all text-ink select-all">{start.secret}</span>
          </p>
        </section>
      ) : (
        <section aria-labelledby="mfa-verify-title" className="flex flex-col gap-3">
          <h2 id="mfa-verify-title" className="text-xl font-extrabold text-ink">
            Verificação em duas etapas
          </h2>
          <p className="text-ink">Digite o código de 6 números do aplicativo autenticador.</p>
        </section>
      )}

      <label className="flex flex-col gap-2 font-bold">
        Código de 6 números
        <input
          type="text"
          name="totp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={9}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="admin-input"
        />
      </label>

      {error && (
        <p role="alert" className="font-bold text-magenta-dark">
          {error}
        </p>
      )}

      <Button type="submit" loading={busy} disabled={code.replace(/\s/g, '').length < 6}>
        {start.kind === 'enroll' ? 'Confirmar e entrar' : 'Entrar'}
      </Button>
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
        Voltar
      </Button>
    </form>
  );
}
