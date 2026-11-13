import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './admin.css';

// Painel: fora do Google e sem cache de busca. Toda autorização acontece na API.
export const metadata: Metadata = {
  title: 'Painel · Sparks Papelaria',
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminRootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="min-h-dvh bg-surface">{children}</div>;
}
