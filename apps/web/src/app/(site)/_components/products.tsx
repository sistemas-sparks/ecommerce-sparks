'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatBRL, type PublicProduct } from '@sparks/shared';
import { Button, ProductCard } from '@/ui';
import { productHref } from '../_lib/paths';
import { addCartItem, setFavorite, useFavorites } from '../_lib/shop-store';
import { useLiveProducts } from '../_lib/use-live-products';

export function Products({
  products,
  empty = 'Os produtos estarão aqui em breve.',
}: {
  products: PublicProduct[];
  empty?: string;
}) {
  const favorites = useFavorites();
  const live = useLiveProducts(products);
  const [message, setMessage] = useState('');
  if (!products.length)
    return (
      <div className="site-empty">
        <p>{empty}</p>
        <Link href="/busca/">Ver todos os produtos</Link>
      </div>
    );
  return (
    <>
      {live.error && (
        <div className="site-live-error" role="status">
          <p>Não foi possível confirmar preço e disponibilidade agora.</p>
          <Button variant="plum" onClick={live.retry}>
            Tentar de novo
          </Button>
        </div>
      )}
      <p className="site-feedback" role="status" aria-live="polite">
        {message}
      </p>
      <div className="site-product-grid">
        {products.map((product, index) => {
          const current = live.products.find((item) => item.id === product.id);
          const photo = product.images[0];
          return (
            <ProductCard
              key={product.id}
              name={product.name}
              href={productHref(product.slug)}
              imageSrc={photo?.url}
              imageAlt={photo?.alt || product.name}
              imageSrcSet={photo?.sources
                .map((source) => `${source.url} ${source.width}w`)
                .join(', ')}
              priceLabel={formatBRL(current?.price_cents ?? product.price_cents)}
              badgeLabel={product.badge ?? undefined}
              clipColor={(['magenta', 'violet', 'gold', 'teal'] as const)[index % 4]}
              isFavorite={favorites.includes(product.id)}
              unavailable={!current?.active || current.stock === 0}
              availabilityLabel={
                !current ? (live.error ? 'Consultar disponibilidade' : 'Aguarde…') : 'Indisponível'
              }
              onFavoriteChange={(selected) => {
                try {
                  setFavorite(product.id, selected);
                  setMessage(
                    selected ? 'Produto salvo nos favoritos.' : 'Produto removido dos favoritos.',
                  );
                } catch {
                  setMessage('Não foi possível salvar os favoritos neste navegador.');
                }
              }}
              onAdd={() => {
                if (!current) return;
                try {
                  addCartItem(product.id, 1, current.stock);
                  setMessage(`${product.name} adicionado à sacola.`);
                } catch (error) {
                  setMessage(
                    error instanceof Error ? error.message : 'Não foi possível adicionar à sacola.',
                  );
                }
              }}
            />
          );
        })}
      </div>
    </>
  );
}
