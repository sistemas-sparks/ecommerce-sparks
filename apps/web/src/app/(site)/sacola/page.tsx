import type { Metadata } from 'next';
import { SectionHeading } from '@/ui';
import { CartPanel } from '@/features/cart/cart-panel';

export const metadata: Metadata = {
  title: 'Sacola',
  robots: { index: false, follow: false },
};

export default function BagPage() {
  return (
    <main id="conteudo" className="site-wrap site-page cart-page">
      <SectionHeading as="h1">Sacola</SectionHeading>
      <CartPanel />
    </main>
  );
}
