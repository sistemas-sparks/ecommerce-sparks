import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { BIO_BUTTONS_MAX, isExternalHref } from '@sparks/shared';
import { INSTAGRAM_URL, pageMetadata } from '@/lib/seo';
import { catalog, whatsappHref } from '../../(site)/_lib/catalog';
import logo from '../../../../../../marca/logo/logo-original.png';
import './links.css';

// Indexável de propósito: docs/seo.md lista /links no sitemap e só manda noindex em admin, sacola,
// checkout, pedido e minha conta.
export const metadata: Metadata = pageMetadata({
  title: 'Links da Sparks Papelaria',
  description:
    'Fale com a Sparks Papelaria pelo WhatsApp, siga no Instagram e acesse os links da loja.',
  path: '/links/',
});

const CUSTOM_TONES = ['magenta', 'violet', 'magenta'] as const;

/** Rótulo extra para leitores de tela quando o link abre em outra aba. */
const NewTab = () => <span className="sr-only"> (abre em outra aba)</span>;

export default function LinksPage() {
  // WhatsApp e Instagram são fixos (2 dos 5 botões); os links da lojista ocupam o resto.
  const custom = catalog.bio_links.slice(0, BIO_BUTTONS_MAX - 2);
  return (
    <main id="conteudo" className="links-page">
      <Link href="/" className="links-logo" aria-label="Sparks Papelaria, ir para a loja">
        <Image src={logo} alt="Sparks Papelaria" priority sizes="(max-width: 560px) 60vw, 240px" />
      </Link>
      <h1>Papelaria também é afeto.</h1>
      <ul className="links-list">
        {/* Sem número configurado o botão não aparece para o visitante; o [A DEFINIR] fica só no painel. */}
        {whatsappHref && (
          <li>
            <a
              className="links-button"
              data-tone="teal"
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              Conversar no WhatsApp
              <NewTab />
            </a>
          </li>
        )}
        <li>
          <a
            className="links-button"
            data-tone="plum"
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Seguir no Instagram
            <NewTab />
          </a>
        </li>
        {custom.length === 0 && (
          <li>
            <Link className="links-button" data-tone="outline" href="/">
              Visitar a loja
            </Link>
          </li>
        )}
        {custom.map((item, index) => {
          const tone = CUSTOM_TONES[index % CUSTOM_TONES.length];
          return (
            <li key={item.id}>
              {isExternalHref(item.href) ? (
                <a
                  className="links-button"
                  data-tone={tone}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.label}
                  <NewTab />
                </a>
              ) : (
                <Link className="links-button" data-tone={tone} href={item.href}>
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
