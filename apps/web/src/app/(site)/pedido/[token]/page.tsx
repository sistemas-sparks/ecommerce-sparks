import type { Metadata } from 'next';
import { SectionHeading } from '@/ui';
import { OrderByToken } from '../_components/order-by-token';

// Pedido de cada cliente: nunca indexar nem repassar o endereço (que contém o código secreto)
// como origem em links externos.
export const metadata: Metadata = {
  title: 'Seu pedido',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

// O site é estático e os códigos dos links não existem no build. Geramos só esta página-modelo;
// o servidor de arquivos responde /pedido/<código>/ com ela (public/_redirects) e a página lê o
// código do endereço no navegador.
export const dynamicParams = false;
export function generateStaticParams() {
  return [{ token: 'modelo' }];
}

export default function OrderPage() {
  return (
    <main id="conteudo" className="site-wrap site-page order-page">
      <SectionHeading as="h1">Seu pedido</SectionHeading>
      <OrderByToken />
    </main>
  );
}
