import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SectionHeading } from '@/ui';
import { JsonLd } from '@/lib/json-ld';
import { breadcrumbLd, pageMetadata, productDescription, productLd } from '@/lib/seo';
import { Products } from '../../_components/products';
import { products, categories, categoryHref, productHref } from '../../_lib/catalog';
import { ProductDetail } from './detail';

export const dynamicParams = false;
export const dynamic = 'force-static';
export function generateStaticParams() {
  // Slug reservado fora do formato do catálogo; resolve em notFound(), sem produto fictício.
  return products.length
    ? products.map((product) => ({ slug: product.slug }))
    : [{ slug: '_empty' }];
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = products.find((entry) => entry.slug === slug);
  if (!product) return {};
  const category = categories.find((entry) => entry.id === product.category_id);
  return pageMetadata({
    title: product.name,
    description: productDescription(product, category),
    path: productHref(product.slug),
    image: product.images[0],
  });
}
export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = products.find((entry) => entry.slug === slug);
  if (!product) notFound();
  const category = categories.find((entry) => entry.id === product.category_id);
  const related = products
    .filter((entry) => entry.id !== product.id && entry.category_id === product.category_id)
    .slice(0, 4);
  return (
    <main id="conteudo" className="site-wrap site-page">
      <JsonLd data={productLd(product, productHref(product.slug))} />
      <JsonLd
        data={breadcrumbLd([
          { name: 'Início', path: '/' },
          ...(category ? [{ name: category.name, path: categoryHref(category.slug) }] : []),
          { name: product.name },
        ])}
      />
      <nav aria-label="Caminho da página" className="site-breadcrumb">
        <Link href="/">Início</Link>
        {category && (
          <>
            <span aria-hidden="true">/</span>
            <Link href={categoryHref(category.slug)}>{category.name}</Link>
          </>
        )}
        <span aria-hidden="true">/</span>
        <span>{product.name}</span>
      </nav>
      <ProductDetail product={product} />
      {related.length > 0 && (
        <section className="site-section">
          <SectionHeading>Você também pode gostar</SectionHeading>
          <Products products={related} />
        </section>
      )}
    </main>
  );
}
