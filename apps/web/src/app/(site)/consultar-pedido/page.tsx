import type { Metadata } from 'next';
import { SectionHeading } from '@/ui';
import { LookupForm } from './_components/lookup-form';
import '../pedido/order.css';

export const metadata: Metadata = {
  title: 'Consultar pedido',
  description: 'Acompanhe o seu pedido da Sparks Papelaria com o código e o WhatsApp da compra.',
  robots: { index: false, follow: true },
  referrer: 'no-referrer',
};

export default function ConsultOrderPage() {
  return (
    <main id="conteudo" className="site-wrap site-page order-page">
      <SectionHeading as="h1">Consultar pedido</SectionHeading>
      <p className="order-intro">
        Informe o código do pedido e o WhatsApp usado na compra. Se você guardou o link do pedido,
        ele também abre direto o acompanhamento.
      </p>
      <LookupForm />
    </main>
  );
}
