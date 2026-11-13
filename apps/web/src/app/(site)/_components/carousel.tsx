'use client';

import { useState } from 'react';
import { ButtonLink, Clip } from '@/ui';
import type { CatalogImage } from '@sparks/shared';
import { Photo } from './photo';

const SLIDES = [
  {
    title: 'Papelaria também é afeto.',
    text: 'Cadernos, canetas e presentes escolhidos com carinho.',
    label: 'Ver novidades',
    href: '#novidades',
    variant: 'plum' as const,
  },
  {
    title: '[A DEFINIR]',
    text: 'Próxima campanha [A DEFINIR].',
    label: 'Ver presentes',
    href: '/busca/?q=presente',
    variant: 'white' as const,
  },
  {
    title: 'Tudo para a volta às aulas.',
    text: 'Cadernos, lápis e kits escolhidos com carinho.',
    label: 'Ver materiais',
    href: '#categorias',
    variant: 'white' as const,
  },
];
export function Carousel({ images }: { images: CatalogImage[] }) {
  const [index, setIndex] = useState(0);
  return (
    <div
      className="site-carousel"
      role="region"
      aria-roledescription="carrossel"
      aria-label="Banners da loja"
    >
      {SLIDES.map((slide, i) => (
        <div
          className={`site-slide site-slide-${i + 1}`}
          key={slide.title}
          hidden={i !== index}
          role="group"
          aria-roledescription="slide"
          aria-label={`${i + 1} de 3`}
        >
          <div className="site-slide-copy">
            {/* O h1 da home fica em page.tsx (um só em todos os casos); aqui são sempre h2. */}
            <h2>{slide.title}</h2>
            <p>{slide.text}</p>
            <ButtonLink href={slide.href} variant={slide.variant}>
              {slide.label}
            </ButtonLink>
          </div>
          <div className="site-collage" aria-hidden="true">
            {[0, 1, 2].map((position) => (
              <div className={`site-frame site-frame-${position + 1}`} key={position}>
                <Clip color={position === 0 ? 'gold' : position === 1 ? 'teal' : 'orchid'} />
                <Photo image={images[position]} priority={i === 0} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="site-carousel-controls">
        <button
          type="button"
          aria-label="Banner anterior"
          onClick={() => setIndex((index + 2) % 3)}
        >
          ←
        </button>
        <div className="site-carousel-dots">
          {SLIDES.map((slide, i) => (
            <button
              type="button"
              key={slide.title}
              aria-label={`Mostrar banner ${i + 1}`}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => setIndex(i)}
            >
              <span />
            </button>
          ))}
        </div>
        <button type="button" aria-label="Próximo banner" onClick={() => setIndex((index + 1) % 3)}>
          →
        </button>
      </div>
    </div>
  );
}
