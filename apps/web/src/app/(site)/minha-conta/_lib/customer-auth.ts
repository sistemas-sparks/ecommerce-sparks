// Login opcional do cliente com Google, pelo Supabase Auth (docs/arquitetura.md §6).
// O módulo recebe o cliente do Supabase por parâmetro: nos testes entra um falso, sem rede.
// O botão só liga com NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED=true; o login real depende de conta
// (Supabase + Google) e é conectado na T-031/T-038. Nenhum segredo passa por aqui.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CustomerSession {
  accessToken: string;
  email: string | null;
}

/** Parte do cliente do Supabase que usamos (facilita o cliente falso nos testes). */
export type AuthClient = Pick<SupabaseClient, 'auth'>;

export interface CustomerAuth {
  /** O botão "Entrar com Google" funciona nesta versão do site? */
  readonly enabled: boolean;
  getSession(): Promise<CustomerSession | null>;
  /** Avisa quando a pessoa entra ou sai. Devolve a função que cancela o aviso. */
  onChange(listener: (session: CustomerSession | null) => void): () => void;
  signInWithGoogle(returnUrl: string): Promise<void>;
  /** Conclui o retorno do Google (?code=...). Devolve false se não havia retorno a concluir. */
  completeSignIn(search: string): Promise<{ done: boolean; error: string | null }>;
  signOut(): Promise<void>;
}

export const AUTH_MESSAGES = {
  failed: 'Não foi possível entrar com o Google. Tente de novo em instantes.',
  denied: 'O login com Google foi cancelado.',
} as const;

function toSession(
  session: { access_token: string; user?: { email?: string | null } } | null,
): CustomerSession | null {
  return session ? { accessToken: session.access_token, email: session.user?.email ?? null } : null;
}

export function createCustomerAuth(client: AuthClient | null, enabledFlag: boolean): CustomerAuth {
  return {
    enabled: Boolean(client) && enabledFlag,

    async getSession() {
      if (!client) return null;
      const { data } = await client.auth.getSession();
      return toSession(data.session);
    },

    onChange(listener) {
      if (!client) return () => {};
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        listener(toSession(session));
      });
      return () => data.subscription.unsubscribe();
    },

    async signInWithGoogle(returnUrl) {
      if (!client || !enabledFlag) throw new Error(AUTH_MESSAGES.failed);
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: returnUrl },
      });
      if (error) throw new Error(AUTH_MESSAGES.failed);
    },

    async completeSignIn(search) {
      if (!client) return { done: false, error: null };
      const params = new URLSearchParams(search);
      if (params.get('error')) return { done: true, error: AUTH_MESSAGES.denied };
      const code = params.get('code');
      if (!code) return { done: false, error: null };
      const { error } = await client.auth.exchangeCodeForSession(code);
      return { done: true, error: error ? AUTH_MESSAGES.failed : null };
    },

    async signOut() {
      await client?.auth.signOut();
    },
  };
}
