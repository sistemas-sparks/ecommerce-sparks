import type { Metadata } from 'next';
import { SectionHeading } from '@/ui';
import { CheckoutView } from '@/features/checkout/checkout-view';

export const metadata: Metadata = {
  title: 'Finalizar compra',
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return (
    <main id="conteudo" className="site-wrap site-page checkout-page">
      <SectionHeading as="h1">Finalizar compra</SectionHeading>
      <CheckoutView />
    </main>
  );
}
