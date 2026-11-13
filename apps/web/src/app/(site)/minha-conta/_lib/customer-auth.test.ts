// Supabase Auth simulado: um cliente falso registra as chamadas; nada de rede nem de conta real.
import { describe, expect, it, vi } from 'vitest';
import { AUTH_MESSAGES, createCustomerAuth, type AuthClient } from './customer-auth';

function fakeClient(
  over: { session?: unknown; oauthError?: boolean; exchangeError?: boolean } = {},
) {
  const listeners: ((event: string, session: unknown) => void)[] = [];
  const unsubscribe = vi.fn();
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: over.session ?? null } })),
    onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
      listeners.push(cb);
      return { data: { subscription: { unsubscribe } } };
    }),
    signInWithOAuth: vi.fn(async () => ({ error: over.oauthError ? new Error('x') : null })),
    exchangeCodeForSession: vi.fn(async () => ({
      error: over.exchangeError ? new Error('x') : null,
    })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  return { client: { auth } as unknown as AuthClient, auth, listeners, unsubscribe };
}

const SESSION = { access_token: 'jwt-de-teste', user: { email: 'pessoa@teste.dev' } };

describe('login do cliente (Supabase Auth simulado)', () => {
  it('desligado por configuração: o botão não funciona e nada é chamado', async () => {
    const { client, auth } = fakeClient();
    const off = createCustomerAuth(client, false);
    expect(off.enabled).toBe(false);
    await expect(off.signInWithGoogle('https://loja.teste/minha-conta/')).rejects.toThrow(
      AUTH_MESSAGES.failed,
    );
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it('sem Supabase configurado no site: desligado, sem sessão e sem erro', async () => {
    const none = createCustomerAuth(null, true);
    expect(none.enabled).toBe(false);
    expect(await none.getSession()).toBeNull();
    expect(await none.completeSignIn('?code=abc')).toEqual({ done: false, error: null });
    expect(() => none.onChange(() => {})()).not.toThrow();
    await expect(none.signOut()).resolves.toBeUndefined();
  });

  it('ligado: pede o login do Google com retorno para a Minha conta', async () => {
    const { client, auth } = fakeClient();
    const on = createCustomerAuth(client, true);
    expect(on.enabled).toBe(true);
    await on.signInWithGoogle('https://loja.teste/minha-conta/');
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://loja.teste/minha-conta/' },
    });
  });

  it('erro do provedor vira mensagem em português, sem detalhe técnico', async () => {
    const { client } = fakeClient({ oauthError: true });
    await expect(
      createCustomerAuth(client, true).signInWithGoogle('https://loja.teste/minha-conta/'),
    ).rejects.toThrow(AUTH_MESSAGES.failed);
  });

  it('devolve a sessão só com o token de acesso e o e-mail', async () => {
    const { client } = fakeClient({ session: { ...SESSION, refresh_token: 'segredo' } });
    const session = await createCustomerAuth(client, true).getSession();
    expect(session).toEqual({ accessToken: 'jwt-de-teste', email: 'pessoa@teste.dev' });
    expect(JSON.stringify(session)).not.toContain('segredo');
  });

  it('avisa entradas e saídas e permite cancelar o aviso', async () => {
    const { client, listeners, unsubscribe } = fakeClient();
    const seen: unknown[] = [];
    const stop = createCustomerAuth(client, true).onChange((s) => seen.push(s));
    listeners[0]?.('SIGNED_IN', SESSION);
    listeners[0]?.('SIGNED_OUT', null);
    expect(seen).toEqual([{ accessToken: 'jwt-de-teste', email: 'pessoa@teste.dev' }, null]);
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('conclui o retorno do Google trocando o código pela sessão', async () => {
    const { client, auth } = fakeClient();
    const result = await createCustomerAuth(client, true).completeSignIn('?code=abc123&x=1');
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('abc123');
    expect(result).toEqual({ done: true, error: null });
  });

  it('sem código na URL não há o que concluir; com erro do Google, mostra aviso', async () => {
    const { client, auth } = fakeClient();
    const on = createCustomerAuth(client, true);
    expect(await on.completeSignIn('')).toEqual({ done: false, error: null });
    expect(await on.completeSignIn('?error=access_denied&error_description=x')).toEqual({
      done: true,
      error: AUTH_MESSAGES.denied,
    });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('troca de código recusada: mensagem genérica', async () => {
    const { client } = fakeClient({ exchangeError: true });
    expect(await createCustomerAuth(client, true).completeSignIn('?code=ruim')).toEqual({
      done: true,
      error: AUTH_MESSAGES.failed,
    });
  });

  it('sair chama o Supabase', async () => {
    const { client, auth } = fakeClient();
    await createCustomerAuth(client, true).signOut();
    expect(auth.signOut).toHaveBeenCalled();
  });
});
