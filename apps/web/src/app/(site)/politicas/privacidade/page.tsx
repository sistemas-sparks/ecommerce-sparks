import type { Metadata } from 'next';
import { SectionHeading } from '@/ui';
import { POLICY_PAGES_INDEXABLE, noIndex, pageMetadata } from '@/lib/seo';

export const metadata: Metadata = {
  ...pageMetadata({
    title: 'Privacidade',
    description:
      'Política de privacidade da Sparks Papelaria: como os dados de quem compra na loja são usados e protegidos.',
    path: '/politicas/privacidade/',
  }),
  robots: POLICY_PAGES_INDEXABLE ? undefined : noIndex,
};

export default function PrivacyPage() {
  return (
    <main id="conteudo" className="site-wrap site-page site-prose">
      <SectionHeading as="h1">Privacidade</SectionHeading>
      <p>Política de privacidade aprovada pela loja: [A DEFINIR]</p>
      <h2>Responsável e contato</h2>
      <p>Razão social, CNPJ confirmado e canal de contato: [A DEFINIR]</p>
      <h2>Tratamento de dados</h2>
      <p>Finalidades, bases legais, compartilhamento, retenção e direitos: [A DEFINIR]</p>
    </main>
  );
}
