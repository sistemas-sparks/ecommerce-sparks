import Image from 'next/image';
import type { CatalogImage } from '@sparks/shared';
import { Clip } from '@/ui';

export function Photo({
  image,
  priority = false,
  sizes = '(max-width: 760px) 50vw, 300px',
}: {
  image?: CatalogImage | null;
  priority?: boolean;
  sizes?: string;
}) {
  if (!image)
    return (
      <div className="site-photo-placeholder" aria-label="Foto [A DEFINIR]" role="img">
        <Clip color="orchid" />
        <span>Foto [A DEFINIR]</span>
      </div>
    );
  return (
    <picture>
      {image.sources.length > 0 && (
        <source
          srcSet={image.sources.map((source) => `${source.url} ${source.width}w`).join(', ')}
          sizes={sizes}
        />
      )}
      <Image
        src={image.url}
        alt={image.alt}
        width={600}
        height={750}
        sizes={sizes}
        priority={priority}
      />
    </picture>
  );
}
