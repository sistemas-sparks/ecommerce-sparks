'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { searchInputSchema, type PublicProduct } from '@sparks/shared';
import { SectionHeading } from '@/ui';
import { useFavorites } from '../_lib/shop-store';
import { Products } from '../_components/products';

function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}
export function Search({ products }: { products: PublicProduct[] }) {
  const params = useSearchParams();
  const parsed = searchInputSchema.safeParse({
    q: params.get('q') ?? '',
    favorites: params.get('favoritos') === '1',
  });
  const [sort, setSort] = useState('name');
  const favorites = useFavorites();
  if (!parsed.success) return <p role="alert">A busca aceita até 120 caracteres.</p>;
  const { q, favorites: onlyFavorites } = parsed.data;
  const terms = normalize(q).split(/\s+/).filter(Boolean);
  const results = products
    .filter(
      (product) =>
        (!onlyFavorites || favorites.includes(product.id)) &&
        terms.every((term) => normalize(`${product.name} ${product.description}`).includes(term)),
    )
    .sort((a, b) =>
      sort === 'price-asc'
        ? a.price_cents - b.price_cents
        : sort === 'price-desc'
          ? b.price_cents - a.price_cents
          : a.name.localeCompare(b.name, 'pt-BR'),
    );
  return (
    <>
      <SectionHeading as="h1">
        {onlyFavorites ? 'Seus favoritos' : q ? `Resultados para “${q}”` : 'Todos os produtos'}
      </SectionHeading>
      <div className="site-results-bar">
        <p role="status">
          {results.length} {results.length === 1 ? 'produto encontrado' : 'produtos encontrados'}
        </p>
        <label>
          Ordenar por{' '}
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="name">Nome</option>
            <option value="price-asc">Menor preço</option>
            <option value="price-desc">Maior preço</option>
          </select>
        </label>
      </div>
      <Products
        products={results}
        empty={
          onlyFavorites
            ? 'Você ainda não salvou nenhum produto nos favoritos.'
            : 'Nenhum produto encontrado. Experimente outra busca.'
        }
      />
    </>
  );
}
