import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SectionHeading } from '@/ui';
import { JsonLd } from '@/lib/json-ld';
import { breadcrumbLd, pageMetadata } from '@/lib/seo';
import { Products } from '../../_components/products';
import { categories, categoryHref, products } from '../../_lib/catalog';

export const dynamicParams = false;
export const dynamic = 'force-static';
export function generateStaticParams() {
  // Next 16.4 exige ao menos um parâmetro no export. Este slug reservado gera só 404,
  // sem criar categorias fictícias enquanto o catálogo estiver vazio.
  return categories.length
    ? categories.map((category) => ({ slug: category.slug }))
    : [{ slug: '_empty' }];
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = categories.find((entry) => entry.slug === slug);
  if (!category) return {};
  return pageMetadata({
    title: category.name,
    description: `${category.name} na Sparks Papelaria: veja os produtos, escolha com carinho e compre com Pix ou cartão.`,
    path: categoryHref(category.slug),
    image: category.image,
  });
}
export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = categories.find((entry) => entry.slug === slug);
  if (!category) notFound();
  return (
    <main id="conteudo" className="site-wrap site-page">
      <JsonLd
        data={breadcrumbLd([
          { name: 'Início', path: '/' },
          { name: category.name, path: categoryHref(category.slug) },
        ])}
      />
      <nav aria-label="Caminho da página" className="site-breadcrumb">
        <Link href="/">Início</Link>
        <span aria-hidden="true">/</span>
        <span>{category.name}</span>
      </nav>
      <SectionHeading as="h1">{category.name}</SectionHeading>
      <Products
        products={products.filter((product) => product.category_id === category.id)}
        empty="Esta categoria ainda não tem produtos disponíveis."
      />
    </main>
  );
}
