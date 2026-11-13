'use client';

// Páginas protegidas do painel. O navegador só exibe: quem decide o acesso é a API (/admin/me),
// e toda rota /admin/* da API confere o login e o papel admin de novo a cada chamada.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { getSupabase } from '@/lib/supabase';
import { Button } from '@/ui';
import { AdminContext, type AdminContextValue } from '../_lib/admin-context';
import { type AdminMe, HOME_PATH, LOGIN_PATH, resolveAdminAccess } from '../_lib/session';

// Itens do menu. Cada tarefa do painel acrescenta o seu quando a tela existir.
const NAV_ITEMS = [
  { href: HOME_PATH, label: 'Início' },
  { href: '/admin/pedidos/', label: 'Pedidos' },
  { href: '/admin/produtos/', label: 'Produtos' },
  { href: '/admin/importar/', label: 'Importar' },
  { href: '/admin/frete/', label: 'Frete' },
  { href: '/admin/cupons/', label: 'Cupons' },
  { href: '/admin/banners/', label: 'Banners' },
  { href: '/admin/links/', label: 'Links da bio' },
  { href: '/admin/relatorios/', label: 'Lucro' },
  { href: '/admin/configuracoes/', label: 'Configurações' },
];

type State =
  { kind: 'checking' } | { kind: 'ready'; me: AdminMe } | { kind: 'error'; message: string };

type LoginReason = 'sem-acesso' | 'sessao-expirada' | 'verificacao';
type CheckResult = Exclude<State, { kind: 'checking' }> | { kind: 'login'; reason?: LoginReason };

/** Confere a sessão no Supabase e o papel admin na API. Não mexe na tela: só devolve o resultado. */
async function checkSession(): Promise<CheckResult> {
  const supabase = getSupabase();
  if (!supabase) return { kind: 'login' };

  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return { kind: 'login' };
    const access = await resolveAdminAccess(data.session.access_token);
    // Falta a segunda etapa: a sessão fica (sem sair) e a tela de login pede o código do TOTP.
    if (access.state === 'mfa') return { kind: 'login', reason: 'verificacao' };
    return { kind: 'ready', me: access.me };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      await supabase.auth.signOut().catch(() => {});
      return { kind: 'login', reason: err.status === 403 ? 'sem-acesso' : 'sessao-expirada' };
    }
    return {
      kind: 'error',
      message: err instanceof ApiError ? err.message : 'Não foi possível abrir o painel.',
    };
  }
}

export default function AdminPanelLayout({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<State>({ kind: 'checking' });

  const goToLogin = useCallback(
    (reason?: LoginReason) =>
      router.replace(reason ? `${LOGIN_PATH}?motivo=${reason}` : LOGIN_PATH),
    [router],
  );

  const apply = useCallback(
    (result: CheckResult) =>
      result.kind === 'login' ? goToLogin(result.reason) : setState(result),
    [goToLogin],
  );

  useEffect(() => {
    let active = true;
    void checkSession().then((result) => {
      if (active) apply(result);
    });
    const subscription = getSupabase()?.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') goToLogin();
    });
    return () => {
      active = false;
      subscription?.data.subscription.unsubscribe();
    };
  }, [apply, goToLogin]);

  function retry() {
    setState({ kind: 'checking' });
    void checkSession().then(apply);
  }

  const context = useMemo<AdminContextValue | null>(() => {
    if (state.kind !== 'ready') return null;
    return {
      me: state.me,
      getAccessToken: async () => {
        const { data } = (await getSupabase()?.auth.getSession()) ?? { data: { session: null } };
        if (!data.session) {
          goToLogin('sessao-expirada');
          throw new ApiError(401, 'unauthorized', 'Sua sessão terminou. Entre de novo.');
        }
        return data.session.access_token;
      },
    };
  }, [state, goToLogin]);

  async function signOut() {
    await getSupabase()?.auth.signOut();
    goToLogin();
  }

  if (state.kind === 'checking') {
    return (
      <p role="status" className="px-4 py-12 text-center text-ink-soft">
        Abrindo o painel…
      </p>
    );
  }

  if (state.kind === 'error') {
    return (
      <main className="mx-auto flex max-w-sm flex-col gap-5 px-4 py-12">
        <p role="alert" className="font-bold text-ink">
          {state.message}
        </p>
        <Button onClick={retry}>Tentar de novo</Button>
      </main>
    );
  }

  return (
    <AdminContext.Provider value={context}>
      <header className="border-b-2 border-line">
        <div className="mx-auto flex min-h-16 max-w-5xl items-center justify-between gap-4 px-4">
          <p className="font-display text-3xl leading-none font-extrabold text-plum">Painel</p>
          <div className="flex items-center gap-4">
            <span className="hidden text-ink-soft tablet:inline">{state.me.email}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="min-h-11 px-1 font-bold text-magenta-dark underline-offset-4 hover:underline"
            >
              Sair
            </button>
          </div>
        </div>
        <nav aria-label="Seções do painel" className="mx-auto max-w-5xl overflow-x-auto px-4">
          <ul className="flex gap-6">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname === item.href.replace(/\/$/, '');
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex min-h-11 items-center border-b-[3px] font-bold ${
                      active ? 'border-magenta text-ink' : 'border-transparent text-ink-soft'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </AdminContext.Provider>
  );
}
