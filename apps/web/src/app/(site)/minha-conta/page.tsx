import type { Metadata } from 'next';
import { SectionHeading } from '@/ui';
import { AccountView } from './_components/account-view';
import '../pedido/order.css';

export const metadata: Metadata = {
  title: 'Minha conta',
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <main id="conteudo" className="site-wrap site-page order-page">
      <SectionHeading as="h1">Minha conta</SectionHeading>
      <AccountView />
    </main>
  );
}
