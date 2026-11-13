'use client';

import { useCallback, useEffect, useState } from 'react';
import { BANNER_MAX_COUNT, adminBannersResponseSchema, type AdminBanner } from '@sparks/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { Button } from '@/ui';
import { useAdmin } from '../../_lib/admin-context';
import { BANNER_STATUS_LABEL, bannerStatus, moveId, periodLabel } from '../../_lib/site-content';
import '../../_components/content-admin.css';
import { BannerForm } from './banner-form';

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

type Editing = { kind: 'new' } | { kind: 'edit'; banner: AdminBanner } | null;

export function BannersPanel() {
  const { getAccessToken } = useAdmin();
  const [banners, setBanners] = useState<AdminBanner[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [busyId, setBusyId] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    return adminBannersResponseSchema.parse(
      await apiFetch('/admin/banners', { token: await getAccessToken() }),
    ).banners;
  }, [getAccessToken]);

  const retry = useCallback(() => {
    setError('');
    void load()
      .then(setBanners)
      .catch((err) => setError(errorMessage(err, 'Não foi possível carregar os banners.')));
  }, [load]);

  useEffect(() => {
    let active = true;
    void load()
      .then((rows) => active && setBanners(rows))
      .catch(
        (err) => active && setError(errorMessage(err, 'Não foi possível carregar os banners.')),
      );
    return () => {
      active = false;
    };
  }, [load]);

  /** Executa a ação, mostra o aviso e recarrega a lista (a versão de cada item muda a cada gravação). */
  async function run(id: string, action: () => Promise<void>, done: string, failed: string) {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      await action();
      setBanners(await load());
      setNotice(done);
    } catch (err) {
      setError(errorMessage(err, failed));
    } finally {
      setBusyId('');
    }
  }

  const call = async (path: string, method: string, body: unknown) =>
    void (await apiFetch(path, {
      method,
      token: await getAccessToken(),
      body: JSON.stringify(body),
    }));

  function toggle(banner: AdminBanner) {
    return run(
      banner.id,
      () =>
        call(`/admin/banners/${banner.id}`, 'PATCH', {
          alt: banner.alt,
          href: banner.href,
          startsAt: banner.startsAt,
          endsAt: banner.endsAt,
          active: !banner.active,
          expectedUpdatedAt: banner.updatedAt,
        }),
      banner.active ? 'Banner desativado.' : 'Banner ativado.',
      'Não foi possível alterar o banner.',
    );
  }

  function move(index: number, delta: -1 | 1) {
    const ids = moveId(
      (banners ?? []).map((banner) => banner.id),
      index,
      delta,
    );
    if (!ids) return;
    return run(
      banners![index]!.id,
      () => call('/admin/banners/order', 'PUT', { ids }),
      'Ordem atualizada.',
      'Não foi possível mudar a ordem.',
    );
  }

  function remove(banner: AdminBanner) {
    return run(
      banner.id,
      async () => {
        await call(`/admin/banners/${banner.id}`, 'DELETE', {
          expectedUpdatedAt: banner.updatedAt,
        });
        setConfirmId('');
      },
      'Banner excluído.',
      'Não foi possível excluir o banner.',
    );
  }

  if (!banners) {
    return (
      <div>
        <h1 className="content-title">Banners</h1>
        {error ? (
          <>
            <p role="alert" className="content-error">
              {error}
            </p>
            <Button onClick={retry}>Tentar de novo</Button>
          </>
        ) : (
          <p role="status">Carregando banners…</p>
        )}
      </div>
    );
  }

  const full = banners.length >= BANNER_MAX_COUNT;

  return (
    <div>
      <div className="content-head">
        <h1 className="content-title">Banners</h1>
        {!editing && !full && banners.length > 0 && (
          <Button onClick={() => setEditing({ kind: 'new' })}>Novo banner</Button>
        )}
      </div>
      {error && (
        <p role="alert" className="content-error">
          {error}
        </p>
      )}
      <p role="status" className="content-notice">
        {notice}
      </p>
      {notice && !error && (
        <p className="content-hint">
          Para a loja mostrar a mudança, use Publicar alterações na página Início.
        </p>
      )}
      {editing && (
        <BannerForm
          key={editing.kind === 'edit' ? editing.banner.id : 'new'}
          banner={editing.kind === 'edit' ? editing.banner : null}
          getToken={getAccessToken}
          onSaved={() => {
            setEditing(null);
            void load()
              .then((rows) => {
                setBanners(rows);
                setNotice('Banner salvo.');
              })
              .catch((err) => setError(errorMessage(err, 'Não foi possível atualizar a lista.')));
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {full && !editing && (
        <p className="content-hint">
          Limite de {BANNER_MAX_COUNT} banners. Exclua um para cadastrar outro.
        </p>
      )}
      {banners.length === 0 && !editing ? (
        <div>
          <p>Nenhum banner cadastrado. Enquanto não houver, a loja mostra o banner padrão.</p>
          <Button onClick={() => setEditing({ kind: 'new' })}>Novo banner</Button>
        </div>
      ) : (
        <ol className="content-list">
          {banners.map((banner, index) => {
            const busy = busyId === banner.id;
            return (
              <li className="content-item" key={banner.id}>
                {/* Miniatura já em WebP no Storage público; não passa pelo otimizador do Next. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="content-thumb"
                  src={banner.sources[0]?.url ?? banner.imageUrl}
                  alt=""
                  width={320}
                  height={160}
                  loading="lazy"
                />
                <div>
                  <h2>Banner {index + 1}</h2>
                  <dl>
                    <div>
                      <dt>Texto alternativo</dt>
                      <dd>{banner.alt}</dd>
                    </div>
                    <div>
                      <dt>Destino</dt>
                      <dd>{banner.href}</dd>
                    </div>
                    <div>
                      <dt>Período</dt>
                      <dd>{periodLabel(banner.startsAt, banner.endsAt)}</dd>
                    </div>
                    <div>
                      <dt>Situação</dt>
                      <dd>{BANNER_STATUS_LABEL[bannerStatus(banner, now)]}</dd>
                    </div>
                  </dl>
                </div>
                <div className="content-actions content-item-actions">
                  {confirmId === banner.id ? (
                    <>
                      <p className="content-notice">Excluir o banner {index + 1}?</p>
                      <Button disabled={busy} onClick={() => void remove(banner)}>
                        Sim, excluir
                      </Button>
                      <Button variant="white" disabled={busy} onClick={() => setConfirmId('')}>
                        Não
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="white"
                        disabled={busy || index === 0}
                        aria-label={`Subir o banner ${index + 1}`}
                        onClick={() => void move(index, -1)}
                      >
                        Subir
                      </Button>
                      <Button
                        variant="white"
                        disabled={busy || index === banners.length - 1}
                        aria-label={`Descer o banner ${index + 1}`}
                        onClick={() => void move(index, 1)}
                      >
                        Descer
                      </Button>
                      <Button
                        variant="white"
                        disabled={busy}
                        aria-label={`Editar o banner ${index + 1}`}
                        onClick={() => {
                          setNotice('');
                          setEditing({ kind: 'edit', banner });
                        }}
                      >
                        Editar
                      </Button>
                      <Button variant="white" disabled={busy} onClick={() => void toggle(banner)}>
                        {banner.active ? 'Desativar' : 'Ativar'}
                      </Button>
                      <Button
                        variant="white"
                        disabled={busy}
                        aria-label={`Excluir o banner ${index + 1}`}
                        onClick={() => setConfirmId(banner.id)}
                      >
                        Excluir
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
