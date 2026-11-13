import type { Metadata } from 'next';
import { SectionHeading } from '@/ui';
import { POLICY_PAGES_INDEXABLE, noIndex, pageMetadata } from '@/lib/seo';

export const metadata: Metadata = {
  ...pageMetadata({
    title: 'Trocas e devoluções',
    description:
      'Como pedir troca ou devolução de produtos comprados na Sparks Papelaria: canal de atendimento, prazos e condições.',
    path: '/politicas/trocas-e-devolucoes/',
  }),
  robots: POLICY_PAGES_INDEXABLE ? undefined : noIndex,
};

export default function ReturnsPage() {
  return (
    <main id="conteudo" className="site-wrap site-page site-prose">
      <SectionHeading as="h1">Trocas e devoluções</SectionHeading>
      <p>Política da loja: [A DEFINIR]</p>
      <h2>Como solicitar</h2>
      <p>Canal de atendimento e procedimento: [A DEFINIR]</p>
      <h2>Prazos e condições</h2>
      <p>[A DEFINIR]</p>
    </main>
  );
}
