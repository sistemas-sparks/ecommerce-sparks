'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Button, IconButton } from './button';
import { Badge } from './card';
import { Clip } from './clip';
import type { ClipColor } from './clip';
import { BagIcon, HeartIcon } from './icons';

export type ProductCardProps = {
  name: string;
  href: string;
  imageSrc?: string;
  imageSrcSet?: string;
  imageAlt?: string;
  // Somente apresentação: o chamador formata os centavos usando packages/shared.
  priceLabel: string;
  badgeLabel?: string;
  clipColor?: ClipColor;
  isFavorite?: boolean;
  isAdding?: boolean;
  unavailable?: boolean;
  availabilityLabel?: string;
  onAdd: () => void;
  onFavoriteChange: (isFavorite: boolean) => void;
};

export function ProductCard({
  name,
  href,
  imageSrc,
  imageSrcSet,
  imageAlt = name,
  priceLabel,
  badgeLabel,
  clipColor,
  isFavorite = false,
  isAdding = false,
  unavailable = false,
  availabilityLabel = 'Indisponível',
  onAdd,
  onFavoriteChange,
}: ProductCardProps) {
  return (
    <article className="sparks-card sparks-product-card">
      <Clip color={clipColor} className="sparks-product-clip" />
      <div className="sparks-product-shot">
        <Link href={href} className="sparks-product-image-link" aria-label={`Ver ${name}`}>
          {imageSrc ? (
            <picture>
              {imageSrcSet && (
                <source srcSet={imageSrcSet} sizes="(max-width: 760px) 50vw, 290px" />
              )}
              <Image
                src={imageSrc}
                alt={imageAlt}
                width={400}
                height={500}
                sizes="(max-width: 760px) calc((100vw - 46px) / 2), (max-width: 1020px) calc((100vw - 76px) / 3), 290px"
                loading="lazy"
              />
            </picture>
          ) : (
            <div className="sparks-product-placeholder" role="img" aria-label="Foto [A DEFINIR]">
              Foto [A DEFINIR]
            </div>
          )}
        </Link>
        {badgeLabel && <Badge>{badgeLabel}</Badge>}
        <IconButton
          className="sparks-product-favorite"
          aria-label={`${isFavorite ? 'Remover dos favoritos:' : 'Favoritar:'} ${name}`}
          aria-pressed={isFavorite}
          onClick={() => onFavoriteChange(!isFavorite)}
        >
          <HeartIcon />
        </IconButton>
      </div>
      <div className="sparks-product-info">
        <h3>
          <Link href={href}>{name}</Link>
        </h3>
        <p className="sparks-product-price">{priceLabel}</p>
        <Button
          disabled={unavailable}
          loading={isAdding}
          onClick={onAdd}
          aria-label={`${unavailable ? 'Indisponível:' : 'Adicionar à sacola:'} ${name}`}
        >
          {!unavailable && !isAdding && <BagIcon />}
          {unavailable ? availabilityLabel : 'Adicionar à sacola'}
        </Button>
      </div>
    </article>
  );
}
