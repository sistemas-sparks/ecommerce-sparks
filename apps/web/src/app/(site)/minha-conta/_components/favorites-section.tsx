'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError } from '@/lib/api';
import { Button } from '@/ui';
import { fetchAccountFavorites, saveAccountFavorites } from '../../pedido/_lib/api';
import { setFavorite, useFavorites } from '../../_lib/shop-store';
import { mergeFavorites } from '../_lib/profile-form';

/**
 * Favoritos: no aparelho ficam sempre (como na vitrine). Aqui a pessoa decide juntar os do
 * aparelho com os da conta, para tê-los em outro celular ou computador.
 */
export function FavoritesSection({ accessToken }: { accessToken: string }) {
  const local = useFavorites();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const sync = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const remote = await fetchAccountFavorites(accessToken);
      const merged = mergeFavorites(local, remote);
      const saved = await saveAccountFavorites(merged, accessToken);
      // Traz para o aparelho o que só estava na conta.
      for (const id of saved) if (!local.includes(id)) setFavorite(id, true);
      setMessage({
        text: `${saved.length} favorito(s) sincronizado(s) com a conta.`,
        error: false,
      });
    } catch (err) {
      setMessage({
        text: err instanceof ApiError ? err.message : 'Não foi possível sincronizar agora.',
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="order-section" aria-labelledby="favorites-title">
      <h2 id="favorites-title" className="order-section-title">
        Favoritos
      </h2>
      <p>
        {local.length === 0
          ? 'Você ainda não favoritou produtos neste aparelho.'
          : `${local.length} produto(s) favoritado(s) neste aparelho.`}{' '}
        <Link className="order-link" href="/busca/?favoritos=1">
          Ver favoritos
        </Link>
      </p>
      <div className="order-actions">
        <Button variant="plum" loading={busy} onClick={() => void sync()}>
          Sincronizar com a conta
        </Button>
        {message ? (
          <p
            role={message.error ? 'alert' : 'status'}
            className={message.error ? 'order-error' : 'order-muted'}
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </section>
  );
}
