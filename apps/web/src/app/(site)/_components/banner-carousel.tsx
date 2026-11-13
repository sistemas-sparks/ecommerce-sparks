'use client';

// T-021 · Carrossel dos banners cadastrados no painel, logo abaixo do cabeçalho.
// - Imagem 2:1 com width/height e proporção reservada no CSS: sem salto de layout.
// - Só a primeira imagem é carregada com prioridade; as outras ficam ocultas e preguiçosas.
// - Rotação automática só com mais de um banner, sem "prefers-reduced-motion", e com botão para
//   pausar (WCAG 2.2.2). Pausa também ao passar o mouse e enquanto há foco dentro do carrossel.
// - O snapshot já traz só os banners que estavam no ar na data do build (os agendados para depois
//   não vão ao HTML público). O fim do período é conferido de novo no navegador, para o banner sair
//   no dia certo; para um agendado entrar, o "Publicar alterações" precisa rodar após o início.
// - Controles com alvo de 44px sempre; no celular os pontos viram o contador "3 / 10".
import Image from 'next/image';
import Link from 'next/link';
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  BANNER_IMAGE_MAX_WIDTH,
  type PublicBanner,
  bannerImageHeight,
  isBannerLive,
  isExternalHref,
} from '@sparks/shared';

const ROTATE_MS = 6000;
const SIZES = '(max-width: 1240px) calc(100vw - 32px), 1200px';

// Relógio em minutos para conferir o período no navegador. No servidor (e na hidratação) vale 0:
// o HTML estático mostra só os banners que estavam no ar na hora do build (`initial`).
const subscribeMinute = (onChange: () => void) => {
  const timer = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(timer);
};
const minuteNow = () => Math.floor(Date.now() / 60_000);
const serverMinute = () => 0;

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        d={direction === 'left' ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayPause({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      {playing ? (
        <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
      ) : (
        <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
      )}
    </svg>
  );
}

export function BannerCarousel({
  banners,
  initial,
  fallback,
}: {
  /** Banners do snapshot (já no período na data do build). */
  banners: PublicBanner[];
  /** Os que estavam no período quando o site foi gerado: é o que o HTML estático mostra. */
  initial: PublicBanner[];
  /** Mostrado se nenhum banner estiver no período. */
  fallback: ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const [motionOk, setMotionOk] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const minute = useSyncExternalStore(subscribeMinute, minuteNow, serverMinute);
  const items = useMemo(
    () =>
      minute === 0 ? initial : banners.filter((banner) => isBannerLive(banner, minute * 60_000)),
    [minute, banners, initial],
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setMotionOk(!query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const total = items.length;
  const current = total ? Math.min(index, total - 1) : 0;
  const rotating = motionOk && total > 1 && !userPaused && !hovered && !focused;

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % total), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [rotating, total, current]);

  if (total === 0) return <>{fallback}</>;

  const go = (next: number) => setIndex((next + total) % total);

  return (
    <section
      className="banner-carousel"
      aria-roledescription="carrossel"
      aria-label="Banners da loja"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div
        className="banner-stage"
        // Enquanto gira sozinho, o leitor de tela não anuncia cada troca; ao pausar, anuncia.
        aria-live={rotating ? 'off' : 'polite'}
      >
        {items.map((banner, i) => {
          const external = isExternalHref(banner.href);
          const picture = (
            <picture>
              {banner.image.sources.length > 0 && (
                <source
                  srcSet={banner.image.sources
                    .map((source) => `${source.url} ${source.width}w`)
                    .join(', ')}
                  sizes={SIZES}
                />
              )}
              <Image
                src={banner.image.url}
                alt={banner.image.alt}
                width={BANNER_IMAGE_MAX_WIDTH}
                height={bannerImageHeight(BANNER_IMAGE_MAX_WIDTH)}
                sizes={SIZES}
                loading={i === 0 ? 'eager' : 'lazy'}
                fetchPriority={i === 0 ? 'high' : 'auto'}
              />
            </picture>
          );
          return (
            <div
              className="banner-slide"
              key={banner.id}
              hidden={i !== current}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} de ${total}`}
            >
              {external ? (
                <a
                  className="banner-link"
                  href={banner.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {picture}
                </a>
              ) : (
                <Link className="banner-link" href={banner.href}>
                  {picture}
                </Link>
              )}
            </div>
          );
        })}
      </div>
      {total > 1 && (
        <div className="banner-controls" role="group" aria-label="Controles do carrossel">
          {motionOk && (
            <button
              type="button"
              className="banner-control"
              aria-label={userPaused ? 'Retomar a troca de banners' : 'Pausar a troca de banners'}
              onClick={() => setUserPaused((value) => !value)}
            >
              <PlayPause playing={!userPaused} />
            </button>
          )}
          <button
            type="button"
            className="banner-control"
            aria-label="Banner anterior"
            onClick={() => go(current - 1)}
          >
            <Chevron direction="left" />
          </button>
          <span className="banner-counter">
            <span className="sr-only">Banner </span>
            {current + 1} / {total}
          </span>
          <div className="banner-dots">
            {items.map((banner, i) => (
              <button
                type="button"
                key={banner.id}
                aria-label={`Mostrar banner ${i + 1} de ${total}`}
                aria-current={i === current ? 'true' : undefined}
                onClick={() => go(i)}
              >
                <span />
              </button>
            ))}
          </div>
          <button
            type="button"
            className="banner-control"
            aria-label="Próximo banner"
            onClick={() => go(current + 1)}
          >
            <Chevron direction="right" />
          </button>
        </div>
      )}
    </section>
  );
}
