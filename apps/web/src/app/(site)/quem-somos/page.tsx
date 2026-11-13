import type { Metadata } from 'next';
import { SectionHeading } from '@/ui';
import { pageMetadata } from '@/lib/seo';
import { Brand } from '../_components/brand';

export const metadata: Metadata = pageMetadata({
  title: 'Quem somos',
  description:
    'Sparks significa faíscas: uma papelaria afetiva que quer iluminar pequenos momentos, do primeiro caderno ao presente escolhido com carinho.',
  path: '/quem-somos/',
});

// Texto fornecido pela cliente em marca/briefing/essencia.md.
export default function AboutPage() {
  return (
    <main id="conteudo" className="site-wrap site-page site-prose">
      <SectionHeading as="h1">Quem somos</SectionHeading>
      <div className="site-about-symbol">
        <Brand variant="symbol" />
      </div>
      <p>Sparks, do inglês, significa faíscas, centelhas.</p>
      <p>
        E é exatamente isso que queremos ser: uma centelha divina capaz de despertar sonhos,
        transformar dias e iluminar novos caminhos.
      </p>
      <p>
        A Sparks está presente nos pequenos momentos que carregam grandes significados: na primeira
        página de um caderno, no projeto que começa, no sonho que ganha forma, no presente escolhido
        com carinho, na organização de uma nova fase.
      </p>
      <p>
        Queremos que, ao abrir uma embalagem da Sparks, a pessoa tenha a sensação de receber um
        abraço, um acolhimento, um carinho. Porque acreditamos que papelaria também é afeto.
      </p>
      <p>
        Cada produto pode fazer parte da construção de um sonho. Cada detalhe pode transformar um
        dia. Cada projeto pode mudar um cenário. E cada sonho realizado pode transformar uma
        família.
      </p>
      <p>
        A Sparks existe para transbordar sorrisos, despertar possibilidades e fazer parte das
        histórias que estão sendo construídas.
      </p>
      <h2>Uma pequena faísca pode acender uma grande luz.</h2>
      <p>Sparks Papelaria, onde sonhos começam a ganhar forma.</p>
    </main>
  );
}
