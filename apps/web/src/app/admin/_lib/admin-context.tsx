'use client';

import { createContext, useContext } from 'react';
import type { AdminMe } from './session';

export interface AdminContextValue {
  me: AdminMe;
  /** Token atual da sessão (renovado automaticamente pelo Supabase) para chamar a API. */
  getAccessToken: () => Promise<string>;
}

export const AdminContext = createContext<AdminContextValue | null>(null);

/** Dados do admin logado. Só existe dentro das páginas protegidas do painel. */
export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error('useAdmin fora do painel protegido');
  return value;
}
