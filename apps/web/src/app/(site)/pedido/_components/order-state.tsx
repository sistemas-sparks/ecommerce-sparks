import type { ReactNode } from 'react';
import '../order.css';

/** Carregando, vazio e erro: um bloco só, com a região certa para leitores de tela. */
export function OrderState({
  title,
  children,
  alert,
  busy,
}: {
  title: string;
  children?: ReactNode;
  alert?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="order-state" role={alert ? 'alert' : 'status'} aria-busy={busy || undefined}>
      <h2 className="order-state-title">{title}</h2>
      {children}
    </div>
  );
}
