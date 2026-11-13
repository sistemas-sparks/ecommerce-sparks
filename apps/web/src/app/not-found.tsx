import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, SectionHeading } from '@/ui';
import SiteLayout from './(site)/layout';
import { categories, categoryHref } from './(site)/_lib/catalog';

// O Next já responde 404 com noindex; o título deixa claro o que aconteceu.
export const metadata: Metadata = { title: 'Página não encontrada', robots: { index: false } };

export default function NotFound() {
  return (
    <SiteLayout>
      <main id="conteudo" className="site-wrap site-page">
        <SectionHeading as="h1" description="O endereço pode ter mudado ou o produto saiu da loja.">
          Página não encontrada
        </SectionHeading>
        <p>
          <ButtonLink href="/">Voltar para o início</ButtonLink>{' '}
          <ButtonLink href="/busca/" variant="white">
            Buscar produtos
          </ButtonLink>
        </p>
        {categories.length > 0 && (
          <nav aria-label="Categorias">
            <h2>Ou escolha uma categoria</h2>
            <ul>
              {categories.map((category) => (
                <li key={category.id}>
                  <Link href={categoryHref(category.slug)}>{category.name}</Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </main>
    </SiteLayout>
  );
}
