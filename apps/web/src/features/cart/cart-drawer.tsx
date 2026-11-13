'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { CartPanel } from './cart-panel';
import { useCartDrawer } from './cart-provider';
import './cart.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

export function CartDrawer() {
  const { isOpen, close, originRef } = useCartDrawer();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // Fechamento por navegação: não devolve o foco ao ícone (a página nova cuida do foco).
  const skipFocusReturn = useRef(false);
  const isOpenRef = useRef(isOpen);
  const lastPathname = useRef(pathname);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  // Fecha ao mudar de rota.
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    if (isOpenRef.current) skipFocusReturn.current = true;
    close();
  }, [pathname, close]);

  // Foco: vai para "Fechar" ao abrir e volta ao elemento de origem ao fechar (só se manual ou Esc).
  useEffect(() => {
    if (isOpen) {
      wasOpen.current = true;
      skipFocusReturn.current = false;
      closeRef.current?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      const origin = originRef.current;
      if (!skipFocusReturn.current && origin?.isConnected) origin.focus();
      skipFocusReturn.current = false;
    }
  }, [isOpen, originRef]);

  // Trava a rolagem do body enquanto aberto.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  // Esc e foco preso no documento: continuam valendo se o foco cair no body.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const nodes = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const inside = dialog.contains(active) && active !== dialog;
      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    // Se o elemento focado some (ex.: "Remover" no último item), devolve o foco ao diálogo.
    const onFocusOut = () => {
      requestAnimationFrame(() => {
        const dialog = dialogRef.current;
        if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
      });
    };
    const dialog = dialogRef.current;
    document.addEventListener('keydown', onKeyDown);
    dialog?.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      dialog?.removeEventListener('focusout', onFocusOut);
    };
  }, [isOpen, close]);

  if (!isOpen) return null;

  const closeForNavigation = () => {
    skipFocusReturn.current = true;
    close();
  };

  return (
    <>
      <div className="cart-scrim" onClick={close} aria-hidden="true" />
      <div
        ref={dialogRef}
        className="cart-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-drawer-title"
        tabIndex={-1}
      >
        <div className="cart-drawer-head">
          <h2 id="cart-drawer-title">Sacola</h2>
          <button ref={closeRef} type="button" className="cart-drawer-close" onClick={close}>
            <span className="sr-only">Fechar sacola</span>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="cart-drawer-body">
          <CartPanel onNavigate={closeForNavigation} />
        </div>
      </div>
    </>
  );
}
