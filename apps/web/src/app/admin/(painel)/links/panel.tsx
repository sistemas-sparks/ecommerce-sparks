'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  BIO_LINK_MAX_COUNT,
  adminBioLinksResponseSchema,
  bioLinkCreateSchema,
  type AdminBioLink,
} from '@sparks/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { INSTAGRAM_URL } from '@/lib/seo';
import { Button } from '@/ui';
import { useAdmin } from '../../_lib/admin-context';
import { formatPhone, moveId } from '../../_lib/site-content';
import '../../_components/content-admin.css';

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

type Data = { links: AdminBioLink[]; whatsapp: string | null };
type Editing = { kind: 'new' } | { kind: 'edit'; link: AdminBioLink } | null;
type Errors = Partial<Record<'label' | 'href' | 'general', string>>;

function LinkForm({
  link,
  getToken,
  onSaved,
  onCancel,
}: {
  link: AdminBioLink | null;
  getToken: () => Promise<string>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(link?.label ?? '');
  const [href, setHref] = useState(link?.href ?? '');
  const [active, setActive] = useState(link?.active ?? true);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = bioLinkCreateSchema.safeParse({ label, href, active });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'label' || key === 'href') next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      await apiFetch(link ? `/admin/bio-links/${link.id}` : '/admin/bio-links', {
        method: link ? 'PATCH' : 'POST',
        token: await getToken(),
        body: JSON.stringify(
          link ? { ...parsed.data, expectedUpdatedAt: link.updatedAt } : parsed.data,
        ),
      });
      onSaved();
    } catch (err) {
      setErrors({ general: errorMessage(err, 'Não foi possível salvar o link.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="content-form" onSubmit={(event) => void submit(event)} noValidate>
      <h2>{link ? 'Editar link' : 'Novo link'}</h2>
      {errors.general && (
        <p role="alert" className="content-error">
          {errors.general}
        </p>
      )}
      <div className="content-fields">
        <div className="content-field">
          <label htmlFor="link-label">Texto do botão</label>
          <input
            id="link-label"
            value={label}
            maxLength={60}
            required
            disabled={saving}
            aria-invalid={Boolean(errors.label)}
            aria-describedby={errors.label ? 'link-label-erro' : undefined}
            onChange={(event) => setLabel(event.target.value)}
          />
          {errors.label && (
            <span id="link-label-erro" className="content-error">
              {errors.label}
            </span>
          )}
        </div>
        <div className="content-field">
          <label htmlFor="link-href">Para onde o botão leva</label>
          <input
            id="link-href"
            value={href}
            maxLength={2048}
            required
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            disabled={saving}
            aria-invalid={Boolean(errors.href)}
            aria-describedby={`link-href-dica ${errors.href ? 'link-href-erro' : ''}`.trim()}
            onChange={(event) => setHref(event.target.value)}
          />
          <span id="link-href-dica" className="content-hint">
            Um caminho da loja, como /busca/, ou um endereço que comece com https://
          </span>
          {errors.href && (
            <span id="link-href-erro" className="content-error">
              {errors.href}
            </span>
          )}
        </div>
      </div>
      <label className="content-check">
        <input
          type="checkbox"
          checked={active}
          disabled={saving}
          onChange={(event) => setActive(event.target.checked)}
        />
        Link ativo
      </label>
      <div className="content-actions">
        <Button type="submit" loading={saving}>
          {saving ? 'Salvando…' : 'Salvar link'}
        </Button>
        <Button variant="white" disabled={saving} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export function BioLinksPanel() {
  const { getAccessToken } = useAdmin();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [busyId, setBusyId] = useState('');
  const [confirmId, setConfirmId] = useState('');

  const load = useCallback(async () => {
    const { links, whatsapp } = adminBioLinksResponseSchema.parse(
      await apiFetch('/admin/bio-links', { token: await getAccessToken() }),
    );
    return { links, whatsapp };
  }, [getAccessToken]);

  const retry = useCallback(() => {
    setError('');
    void load()
      .then(setData)
      .catch((err) => setError(errorMessage(err, 'Não foi possível carregar os links.')));
  }, [load]);

  useEffect(() => {
    let active = true;
    void load()
      .then((loaded) => active && setData(loaded))
      .catch((err) => active && setError(errorMessage(err, 'Não foi possível carregar os links.')));
    return () => {
      active = false;
    };
  }, [load]);

  async function run(id: string, action: () => Promise<void>, done: string, failed: string) {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      await action();
      setData(await load());
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

  if (!data) {
    return (
      <div>
        <h1 className="content-title">Links da bio</h1>
        {error ? (
          <>
            <p role="alert" className="content-error">
              {error}
            </p>
            <Button onClick={retry}>Tentar de novo</Button>
          </>
        ) : (
          <p role="status">Carregando links…</p>
        )}
      </div>
    );
  }

  const { links, whatsapp } = data;
  const full = links.length >= BIO_LINK_MAX_COUNT;

  return (
    <div>
      <div className="content-head">
        <h1 className="content-title">Links da bio</h1>
        <Link className="content-link" href="/links/" target="_blank" rel="noopener noreferrer">
          Ver a página de links
          <span className="sr-only"> (abre em outra aba)</span>
        </Link>
      </div>
      <dl className="content-fixed">
        <dt>Botão de WhatsApp (sempre o primeiro)</dt>
        <dd>{whatsapp ? formatPhone(whatsapp) : '[A DEFINIR]'}</dd>
        <dt>Botão do Instagram (sempre o segundo)</dt>
        <dd>{INSTAGRAM_URL.replace('https://www.instagram.com/', '@').replace(/\/$/, '')}</dd>
      </dl>
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
      {editing ? (
        <LinkForm
          key={editing.kind === 'edit' ? editing.link.id : 'new'}
          link={editing.kind === 'edit' ? editing.link : null}
          getToken={getAccessToken}
          onSaved={() => {
            setEditing(null);
            void load()
              .then((loaded) => {
                setData(loaded);
                setNotice('Link salvo.');
              })
              .catch((err) => setError(errorMessage(err, 'Não foi possível atualizar a lista.')));
          }}
          onCancel={() => setEditing(null)}
        />
      ) : full ? (
        <p className="content-hint">
          Limite de {BIO_LINK_MAX_COUNT} links seus (com o WhatsApp e o Instagram, são 5 botões).
        </p>
      ) : (
        <Button onClick={() => setEditing({ kind: 'new' })}>Novo link</Button>
      )}
      {links.length === 0 ? (
        !editing && <p>Nenhum link seu cadastrado.</p>
      ) : (
        <ol className="content-list">
          {links.map((link, index) => {
            const busy = busyId === link.id;
            return (
              <li className="content-item content-item-links" key={link.id}>
                <div>
                  <h2>{link.label}</h2>
                  <dl>
                    <div>
                      <dt>Destino</dt>
                      <dd>{link.href}</dd>
                    </div>
                    <div>
                      <dt>Situação</dt>
                      <dd>{link.active ? 'Ativo' : 'Desativado'}</dd>
                    </div>
                  </dl>
                </div>
                <div className="content-actions">
                  {confirmId === link.id ? (
                    <>
                      <p className="content-notice">Excluir “{link.label}”?</p>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void run(
                            link.id,
                            async () => {
                              await call(`/admin/bio-links/${link.id}`, 'DELETE', {
                                expectedUpdatedAt: link.updatedAt,
                              });
                              setConfirmId('');
                            },
                            'Link excluído.',
                            'Não foi possível excluir o link.',
                          )
                        }
                      >
                        Sim, excluir
                      </Button>
                      <Button variant="white" disabled={busy} onClick={() => setConfirmId('')}>
                        Não
                      </Button>
                    </>
                  ) : (
                    <>
                      {([-1, 1] as const).map((delta) => {
                        const ids = moveId(
                          links.map((item) => item.id),
                          index,
                          delta,
                        );
                        return (
                          <Button
                            key={delta}
                            variant="white"
                            disabled={busy || !ids}
                            aria-label={`${delta === -1 ? 'Subir' : 'Descer'} o link ${link.label}`}
                            onClick={() =>
                              ids &&
                              void run(
                                link.id,
                                () => call('/admin/bio-links/order', 'PUT', { ids }),
                                'Ordem atualizada.',
                                'Não foi possível mudar a ordem.',
                              )
                            }
                          >
                            {delta === -1 ? 'Subir' : 'Descer'}
                          </Button>
                        );
                      })}
                      <Button
                        variant="white"
                        disabled={busy}
                        aria-label={`Editar o link ${link.label}`}
                        onClick={() => {
                          setNotice('');
                          setEditing({ kind: 'edit', link });
                        }}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="white"
                        disabled={busy}
                        aria-label={`${link.active ? 'Desativar' : 'Ativar'} o link ${link.label}`}
                        onClick={() =>
                          void run(
                            link.id,
                            () =>
                              call(`/admin/bio-links/${link.id}`, 'PATCH', {
                                label: link.label,
                                href: link.href,
                                active: !link.active,
                                expectedUpdatedAt: link.updatedAt,
                              }),
                            link.active ? 'Link desativado.' : 'Link ativado.',
                            'Não foi possível alterar o link.',
                          )
                        }
                      >
                        {link.active ? 'Desativar' : 'Ativar'}
                      </Button>
                      <Button
                        variant="white"
                        disabled={busy}
                        aria-label={`Excluir o link ${link.label}`}
                        onClick={() => setConfirmId(link.id)}
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
