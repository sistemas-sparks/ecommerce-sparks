'use client';

import { useCallback, useEffect, useState } from 'react';
import { getCustomerAuth } from './customer-auth-browser';
import type { CustomerSession } from './customer-auth';

export type CustomerAuthState =
  | { status: 'loading'; session: null }
  | { status: 'signed-out'; session: null }
  | { status: 'signed-in'; session: CustomerSession };

/** Sessão do cliente (se houver) e se o login com Google está ligado neste site. */
export function useCustomerAuth() {
  const auth = getCustomerAuth();
  const [state, setState] = useState<CustomerAuthState>({ status: 'loading', session: null });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const apply = (session: CustomerSession | null) => {
      if (!active) return;
      setState(
        session ? { status: 'signed-in', session } : { status: 'signed-out', session: null },
      );
    };
    // Conclui o retorno do Google (?code=) antes de ler a sessão e limpa o endereço.
    auth
      .completeSignIn(window.location.search)
      .then(({ done, error: message }) => {
        if (done) window.history.replaceState(null, '', window.location.pathname);
        if (active && message) setError(message);
        return auth.getSession();
      })
      .then(apply)
      .catch(() => apply(null));
    const stop = auth.onChange(apply);
    return () => {
      active = false;
      stop();
    };
  }, [auth]);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      await auth.signInWithGoogle(`${window.location.origin}/minha-conta/`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar com o Google.');
    }
  }, [auth]);

  const signOut = useCallback(async () => {
    await auth.signOut();
    setState({ status: 'signed-out', session: null });
  }, [auth]);

  return { ...state, enabled: auth.enabled, error, signIn, signOut };
}
