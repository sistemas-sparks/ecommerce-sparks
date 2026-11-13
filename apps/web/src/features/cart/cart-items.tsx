'use client';

import Image from 'next/image';
import Link from 'next/link';
import { formatBRL, type CartViewLine } from '@sparks/shared';
import { productHref } from '@/app/(site)/_lib/paths';

export interface CartItemsProps {
  lines: CartViewLine[];
  /** Preços ainda não confirmados pela API. */
  loading: boolean;
  /** A consulta falhou: não mostra "Confirmando preço...". */
  failed?: boolean;
  onQty: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
  onNavigate?: () => void;
}

function stockNotice(line: CartViewLine): string | null {
  if (line.status === 'unavailable') return 'Sem estoque';
  if (line.status === 'over_stock') return `Só temos ${line.maxQty}`;
  return null;
}

export function CartItems({
  lines,
  loading,
  failed = false,
  onQty,
  onRemove,
  onNavigate,
}: CartItemsProps) {
  return (
    <ul className="cart-items" aria-busy={loading || undefined}>
      {lines.map((line) => {
        const notice = loading ? null : stockNotice(line);
        const name = line.name || 'Produto indisponível';
        const photo = line.photo;
        return (
          <li key={line.productId} className="cart-item">
            <div className="cart-item-photo">
              {photo ? (
                <Image src={photo.url} alt={photo.alt} width={64} height={80} />
              ) : (
                <span aria-hidden="true" />
              )}
            </div>
            <div className="cart-item-body">
              <h3>
                {line.slug ? (
                  <Link href={productHref(line.slug)} onClick={onNavigate}>
                    {name}
                  </Link>
                ) : (
                  name
                )}
              </h3>
              <p className="cart-item-price">
                {loading
                  ? failed
                    ? null
                    : 'Confirmando preço...'
                  : line.unitPriceCents > 0
                    ? formatBRL(line.unitPriceCents)
                    : null}
              </p>
              {notice && (
                <p className="cart-item-notice" role="alert">
                  {notice}
                </p>
              )}
              <div className="cart-qty">
                <button
                  type="button"
                  aria-label={`Diminuir a quantidade de ${name}`}
                  disabled={line.qty <= 1}
                  onClick={() => onQty(line.productId, line.qty - 1)}
                >
                  −
                </button>
                <span aria-live="polite">{line.qty}</span>
                <button
                  type="button"
                  aria-label={`Aumentar a quantidade de ${name}`}
                  disabled={loading || line.qty >= line.maxQty}
                  onClick={() => onQty(line.productId, line.qty + 1)}
                >
                  +
                </button>
              </div>
            </div>
            <div className="cart-item-side">
              {!loading && line.status !== 'unavailable' && (
                <strong className="cart-item-total">{formatBRL(line.lineCents)}</strong>
              )}
              <button
                type="button"
                className="cart-link-button"
                aria-label={`Remover ${name} da sacola`}
                onClick={() => onRemove(line.productId)}
              >
                Remover
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
