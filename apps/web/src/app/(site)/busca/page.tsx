import type { Metadata } from 'next';
import { Suspense } from 'react';
import { noIndex, pageMetadata } from '@/lib/seo';
import { products } from '../_lib/catalog';
import { Search } from './search';
// Busca interna fica fora do Google (skill seo-geo-local); decisão final pendente (docs/seo.md §3).
export const metadata: Metadata = {
  ...pageMetadata({
    title: 'Buscar produtos',
    description: 'Busque cadernos, canetas, kits escolares e presentes na Sparks Papelaria.',
    path: '/busca/',
  }),
  robots: noIndex,
};

export default function SearchPage() {
  return (
    <main id="conteudo" className="site-wrap site-page">
      <Suspense fallback={<p role="status">Carregando busca…</p>}>
        <Search products={products} />
      </Suspense>
    </main>
  );
}
