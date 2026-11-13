import type { Metadata } from 'next';
import Link from 'next/link';
import { isBannerLive } from '@sparks/shared';
import { ButtonLink, SectionHeading } from '@/ui';
import { JsonLd } from '@/lib/json-ld';
import { SITE_DESCRIPTION, pageMetadata, storeLd, websiteLd } from '@/lib/seo';
import { Brand } from './_components/brand';
import { BannerCarousel } from './_components/banner-carousel';
import { Carousel } from './_components/carousel';
import { Photo } from './_components/photo';
import { Products } from './_components/products';
import { catalog, categories, categoryHref, products } from './_lib/catalog';

export const metadata: Metadata = pageMetadata({
  title: 'Sparks Papelaria | Cadernos, canetas e presentes com afeto',
  description: SITE_DESCRIPTION,
  path: '/',
  absoluteTitle: true,
});

// Instante do build: o HTML estático mostra os banners que estavam no período neste momento.
const BUILD_TIME = Date.now();

const MOMENTS = [
  {
    title: 'Volta às aulas',
    text: 'Réguas, lápis, cadernos e kits para começar organizado.',
    query: 'escolar',
    action: 'Montar a lista',
  },
  {
    title: 'Para presentear',
    text: 'Mimos para aniversários, eventos de escola e datas especiais.',
    query: 'presente',
    action: 'Ver presentes',
  },
  {
    title: 'Para estudar',
    text: 'Canetas, marca-textos e cadernos para os estudos.',
    query: 'caderno',
    action: 'Ver materiais',
  },
  {
    title: 'Para colecionar',
    text: 'Itens fofos para completar a sua coleção.',
    query: 'colecionar',
    action: 'Ver coleção',
  },
];
export default function HomePage() {
  const featured = products.filter((product) => product.featured);
  const photos = products.flatMap((product) => product.images);
  // Banners cadastrados no painel (T-021) chegam pelo snapshot do build, que já traz só os que
  // estavam no ar na data do build (os agendados para depois não vão ao HTML público: o
  // "Publicar" precisa rodar depois da data de início). Sem nenhum, vale o banner padrão do
  // protótipo aprovado. O fim do período é conferido de novo no navegador.
  const banners = catalog.banners;
  const liveAtBuild = banners.filter((banner) => isBannerLive(banner, BUILD_TIME));
  const defaultHero = <Carousel images={photos.slice(0, 3)} />;
  return (
    <main id="conteudo">
      <JsonLd data={websiteLd()} />
      <JsonLd data={storeLd(catalog.contact)} />
      {/* Exatamente um h1 em todos os casos (com ou sem banners, banner sem texto, todos fora do
          período): é o nome da loja; os títulos do banner padrão são h2. */}
      <h1 className="sr-only">Sparks Papelaria</h1>
      <section className="site-wrap site-hero" aria-label="Destaques">
        {banners.length > 0 ? (
          <BannerCarousel banners={banners} initial={liveAtBuild} fallback={defaultHero} />
        ) : (
          defaultHero
        )}
        <ul className="site-trust">
          <li>
            <span aria-hidden="true">♧</span>
            <strong>Embalagem de presente</strong>
          </li>
          <li>
            <span aria-hidden="true">▤</span>
            <strong>Pix e cartão</strong>
          </li>
          <li>
            <span aria-hidden="true">♡</span>
            <strong>Atendimento no WhatsApp</strong>
          </li>
        </ul>
      </section>
      <section className="site-wrap site-section" id="categorias">
        <SectionHeading>Compre por categoria</SectionHeading>
        {categories.length ? (
          <div className="site-categories">
            {categories.map((category, index) => (
              <Link
                href={categoryHref(category.slug)}
                className={`site-category site-category-${index % 6}`}
                key={category.id}
              >
                <Photo image={category.image} />
                <span>{category.name}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="site-empty">Categorias [A DEFINIR]</div>
        )}
      </section>
      <section className="site-wrap site-section" id="novidades">
        <SectionHeading
          description="Achados fresquinhos para a sua mesa e mochila."
          action={
            <Link className="site-text-link" href="/busca/">
              Ver todos os produtos
            </Link>
          }
        >
          Novidades
        </SectionHeading>
        <Products products={(featured.length ? featured : products).slice(0, 8)} />
      </section>
      <section className="site-wrap site-section">
        <SectionHeading>Para cada momento</SectionHeading>
        <div className="site-moments">
          {MOMENTS.map((moment, index) => (
            <Link
              className={`site-moment site-moment-${index}`}
              href={`/busca/?q=${encodeURIComponent(moment.query)}`}
              key={moment.title}
            >
              <h3>{moment.title}</h3>
              <p>{moment.text}</p>
              <span>{moment.action} ↗</span>
              <Photo image={photos[index]} />
            </Link>
          ))}
        </div>
      </section>
      <section className="site-wrap site-section">
        <div className="site-story">
          <div>
            <h2>Uma pequena faísca pode acender uma grande luz.</h2>
            <p>
              Sparks significa faíscas. Estamos nos pequenos momentos que carregam grandes
              significados: na primeira página de um caderno, no projeto que começa, no presente
              escolhido com carinho. Queremos que abrir uma embalagem Sparks seja como receber um
              abraço.
            </p>
            <ButtonLink href="/quem-somos/" variant="white">
              Conheça a Sparks
            </ButtonLink>
          </div>
          <div className="site-symbol-card">
            <Brand variant="symbol" />
          </div>
        </div>
      </section>
      <section className="site-wrap site-section">
        <SectionHeading
          description="Novidades e bastidores em @sparks_papelaria."
          action={
            <ButtonLink
              href="https://www.instagram.com/sparks_papelaria/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Seguir no Instagram
            </ButtonLink>
          }
        >
          Acompanhe a Sparks
        </SectionHeading>
        <div className="site-instagram">
          {Array.from({ length: 6 }, (_, index) => (
            <Photo image={catalog.instagram_images[index]} key={index} />
          ))}
        </div>
      </section>
    </main>
  );
}
