'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatBRL, type PublicProduct } from '@sparks/shared';
import { BagIcon, Button, HeartIcon } from '@/ui';
import { Photo } from '../../_components/photo';
import { useLiveProducts } from '../../_lib/use-live-products';
import { addCartItem, setFavorite, useFavorites } from '../../_lib/shop-store';

export function ProductDetail({ product }: { product: PublicProduct }) {
  const [photo, setPhoto] = useState(0);
  const [qty, setQty] = useState(1);
  const [message, setMessage] = useState('');
  const favorites = useFavorites();
  const live = useLiveProducts([product]);
  const current = live.products.find((entry) => entry.id === product.id);
  const available = Boolean(current?.active && current.stock > 0);
  const limit = Math.min(current?.stock ?? 1, 99);
  const isFavorite = favorites.includes(product.id);
  return (
    <div className="site-product-detail">
      <div>
        <div className="site-product-main-photo">
          <Photo image={product.images[photo]} priority sizes="(max-width: 760px) 100vw, 600px" />
        </div>
        {product.images.length > 1 && (
          <div className="site-thumbnails" aria-label="Fotos do produto">
            {product.images.map((image, index) => (
              <button
                key={image.url}
                type="button"
                aria-label={`Ver foto ${index + 1} de ${product.name}`}
                aria-pressed={photo === index}
                onClick={() => setPhoto(index)}
              >
                <Photo image={image} sizes="80px" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="site-product-copy">
        <h1>{product.name}</h1>
        {product.badge && <p className="site-product-badge">{product.badge}</p>}
        <p className="site-detail-price">
          {formatBRL(current?.price_cents ?? product.price_cents)}
        </p>
        <p>Pagamento por Pix ou cartão pelo Mercado Pago.</p>
        {live.error ? (
          <div role="status" className="site-live-error">
            <p>Não foi possível confirmar preço e disponibilidade agora.</p>
            <Button variant="plum" onClick={live.retry}>
              Tentar de novo
            </Button>
          </div>
        ) : (
          <p role="status">
            {!current
              ? 'Consultando disponibilidade…'
              : available
                ? 'Disponível'
                : 'Produto indisponível no momento.'}
          </p>
        )}
        <div className="site-quantity">
          <span>Quantidade</span>
          <div>
            <button
              type="button"
              aria-label="Diminuir quantidade"
              disabled={qty === 1}
              onClick={() => setQty((value) => value - 1)}
            >
              −
            </button>
            <output aria-label="Quantidade escolhida">{qty}</output>
            <button
              type="button"
              aria-label="Aumentar quantidade"
              disabled={!available || qty >= limit}
              onClick={() => setQty((value) => value + 1)}
            >
              +
            </button>
          </div>
        </div>
        <Button
          disabled={!available || qty > limit}
          onClick={() => {
            if (!current) return;
            try {
              addCartItem(product.id, qty, current.stock);
              setMessage('Produto adicionado à sacola.');
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Não foi possível adicionar.');
            }
          }}
        >
          <BagIcon />
          Adicionar à sacola
        </Button>
        <Button
          variant="white"
          aria-pressed={isFavorite}
          onClick={() => {
            try {
              setFavorite(product.id, !isFavorite);
              setMessage(
                isFavorite ? 'Produto removido dos favoritos.' : 'Produto salvo nos favoritos.',
              );
            } catch {
              setMessage('Não foi possível salvar os favoritos neste navegador.');
            }
          }}
        >
          <HeartIcon />
          {isFavorite ? 'Remover dos favoritos' : 'Favoritar'}
        </Button>
        <p role="status" className="site-feedback">
          {message}
        </p>
        <ul className="site-detail-benefits">
          <li>Embalagem de presente na sacola, quando disponível.</li>
          <li>Frete calculado pelo CEP.</li>
          <li>Compra sem cadastro obrigatório.</li>
        </ul>
        <details open>
          <summary>Detalhes do produto</summary>
          <p className="site-preserve-lines">{product.description || 'Descrição [A DEFINIR]'}</p>
        </details>
        <details>
          <summary>Entrega</summary>
          <p>
            Consulte preço e prazo com seu CEP na sacola. Para endereços rurais ou de difícil
            acesso, o frete é confirmado pela loja antes do pagamento.
          </p>
          <Link className="site-text-link" href="/politicas/entrega/">
            Ver informações de entrega
          </Link>
        </details>
      </div>
    </div>
  );
}
