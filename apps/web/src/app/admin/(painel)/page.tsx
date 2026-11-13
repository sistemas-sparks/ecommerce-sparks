'use client';

import { PublishSection } from '../_components/publish-section';
import { useAdmin } from '../_lib/admin-context';

// Início do painel. Os módulos (pedidos, produtos, frete, cupons...) entram nas próprias tarefas.
export default function AdminHomePage() {
  const { me } = useAdmin();
  return (
    <>
      <h1 className="font-display text-5xl leading-none font-extrabold text-plum">Início</h1>
      <p className="mt-4 text-ink-soft">Você entrou como {me.email}.</p>
      <PublishSection />
    </>
  );
}
