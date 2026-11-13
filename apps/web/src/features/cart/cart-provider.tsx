'use client';

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

interface CartDrawerState {
  isOpen: boolean;
  /** Abre o painel e guarda o elemento que o abriu, para devolver o foco ao fechar. */
  open: (origin?: HTMLElement | null) => void;
  close: () => void;
  /** Elemento que abriu o painel (usado pelo `CartDrawer` ao fechar). */
  originRef: { current: HTMLElement | null };
}

const CartDrawerContext = createContext<CartDrawerState | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const originRef = useRef<HTMLElement | null>(null);
  // Funções estáveis: o CartDrawer fecha ao mudar de rota e não pode refazer o efeito ao abrir.
  const [actions] = useState(() => ({
    open: (origin?: HTMLElement | null) => {
      originRef.current =
        origin ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setIsOpen(true);
    },
    close: () => setIsOpen(false),
  }));
  const value = useMemo<CartDrawerState>(
    () => ({ isOpen, ...actions, originRef }),
    [isOpen, actions],
  );
  return <CartDrawerContext.Provider value={value}>{children}</CartDrawerContext.Provider>;
}

export function useCartDrawer(): CartDrawerState {
  const ctx = useContext(CartDrawerContext);
  if (!ctx) throw new Error('useCartDrawer precisa estar dentro de <CartProvider>.');
  return ctx;
}
