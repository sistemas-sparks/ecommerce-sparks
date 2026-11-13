'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PublicCategory } from '@sparks/shared';
import { useCartDrawer } from '@/features/cart/cart-provider';
import { BagIcon, HeartIcon } from '@/ui';
import { useCartDraft, useFavorites } from '../_lib/shop-store';
import { Brand } from './brand';

export function Header({ categories }: { categories: PublicCategory[] }) {
  const [compact, setCompact] = useState(false);
  const favorites = useFavorites();
  const cart = useCartDraft();
  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0);
  const pathname = usePathname();
  const drawer = useCartDrawer();
  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 70);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header className={`site-header ${compact ? 'site-compact' : ''}`}>
      <a className="site-skip" href="#conteudo">
        Ir para o conteúdo
      </a>
      <div className="site-wrap site-header-row">
        <Link href="/" className="site-brand-link" aria-label="Sparks Papelaria, início">
          <Brand />
        </Link>
        <form action="/busca/" className="site-search" role="search">
          <label className="sr-only" htmlFor="site-search">
            Buscar produtos
          </label>
          <input
            id="site-search"
            type="search"
            name="q"
            maxLength={120}
            placeholder="Busque por caneta, caderno, lápis…"
          />
          <button type="submit" aria-label="Buscar">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              aria-hidden="true"
            >
              <circle cx="10" cy="10" r="7" />
              <path d="m16 16 5 5" />
            </svg>
          </button>
        </form>
        <div className="site-actions">
          <Link
            href="/busca/?favoritos=1"
            className="site-icon-link"
            aria-label={`Favoritos${favorites.length ? `: ${favorites.length}` : ''}`}
          >
            <HeartIcon />
            {favorites.length > 0 && <span className="site-count">{favorites.length}</span>}
          </Link>
          <Link
            href="/sacola/"
            prefetch={false}
            className="site-icon-link"
            aria-label={`Abrir sacola${cartCount ? `: ${cartCount} itens` : ''}`}
            aria-haspopup="dialog"
            onClick={(event) => {
              const plain =
                event.button === 0 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey;
              if (!plain || pathname.startsWith('/sacola')) return;
              event.preventDefault();
              drawer.open(event.currentTarget);
            }}
          >
            <BagIcon />
            {cartCount > 0 && <span className="site-count">{cartCount}</span>}
          </Link>
        </div>
      </div>
      <nav className="site-wrap site-nav" aria-label="Categorias">
        {categories.length ? (
          categories.map((category) => (
            <Link key={category.id} href={`/categoria/${category.slug}/`}>
              {category.name}
            </Link>
          ))
        ) : (
          <Link href="/busca/">Todos os produtos</Link>
        )}
      </nav>
    </header>
  );
}
