import type { Metadata } from 'next';
import { SectionHeading } from '@/ui';
import { POLICY_PAGES_INDEXABLE, noIndex, pageMetadata } from '@/lib/seo';

export const metadata: Metadata = {
  ...pageMetadata({
    title: 'Entrega',
    description:
      'Como a Sparks Papelaria calcula preço e prazo de entrega pelo CEP, com frete local e envio para todo o Brasil.',
    path: '/politicas/entrega/',
  }),
  robots: POLICY_PAGES_INDEXABLE ? undefined : noIndex,
};

export default function DeliveryPage() {
  return (
    <main id="conteudo" className="site-wrap site-page site-prose">
      <SectionHeading as="h1">Entrega</SectionHeading>
      <p>O preço e o prazo da entrega são calculados pelo CEP na sacola.</p>
      <p>
        Endereços rurais ou de difícil acesso precisam da confirmação do frete pela loja antes do
        pagamento.
      </p>
      <h2>Preparo e envio</h2>
      <p>Prazo de preparo: [A DEFINIR]</p>
      <p>CEP de origem e regiões atendidas: [A DEFINIR]</p>
      <h2>Entrega local e frete grátis</h2>
      <p>Faixas de CEP, preços e condições: [A DEFINIR]</p>
      <h2>Contato</h2>
      <p>WhatsApp para dúvidas: [A DEFINIR]</p>
    </main>
  );
}
