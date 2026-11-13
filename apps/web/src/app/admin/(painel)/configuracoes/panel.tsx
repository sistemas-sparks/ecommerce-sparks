'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  giftWrapAdminSettingsSchema,
  giftWrapSettingsInputSchema,
  type GiftWrapAdminSettings,
} from '@sparks/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { Button } from '@/ui';
import { useAdmin } from '../../_lib/admin-context';
import './settings.css';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function SettingsPanel() {
  const { getAccessToken } = useAdmin();
  const [data, setData] = useState<GiftWrapAdminSettings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    return giftWrapAdminSettingsSchema.parse(
      await apiFetch('/admin/settings', { token: await getAccessToken() }),
    );
  }, [getAccessToken]);

  const retry = useCallback(() => {
    setError('');
    void load()
      .then(setData)
      .catch((err) => setError(errorMessage(err, 'Não foi possível carregar as configurações.')));
  }, [load]);

  useEffect(() => {
    let active = true;
    void load()
      .then((loaded) => {
        if (active) setData(loaded);
      })
      .catch((err) => {
        if (active) setError(errorMessage(err, 'Não foi possível carregar as configurações.'));
      });
    return () => {
      active = false;
    };
  }, [load]);

  async function toggle(next: boolean) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const body = giftWrapSettingsInputSchema.parse({ gift_wrap_enabled: next });
      const saved = giftWrapAdminSettingsSchema.parse(
        await apiFetch('/admin/settings', {
          method: 'PATCH',
          token: await getAccessToken(),
          body: JSON.stringify(body),
        }),
      );
      setData(saved);
      setNotice('Configuração salva.');
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível salvar.'));
    } finally {
      setSaving(false);
    }
  }

  if (!data)
    return (
      <div>
        <h1 className="settings-title">Configurações</h1>
        {error ? (
          <>
            <p role="alert" className="settings-error">
              {error}
            </p>
            <Button onClick={retry}>Tentar de novo</Button>
          </>
        ) : (
          <p role="status">Carregando configurações…</p>
        )}
      </div>
    );

  const enabled = data.gift_wrap_enabled;
  const { total, available } = data.gift_wrap_models;
  return (
    <div className="settings-panel">
      <h1 className="settings-title">Configurações</h1>
      <section>
        <h2>Embalagem de presente</h2>
        <p>
          Quando ligada, o cliente pode escolher um modelo de embalagem na sacola e escrever a
          mensagem do cartão (até 140 caracteres). A mudança vale na hora, sem precisar publicar.
        </p>
        <label className="settings-switch">
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            disabled={saving}
            onChange={(event) => void toggle(event.target.checked)}
          />
          <span className="settings-switch-track" aria-hidden="true" />
          <span>Embalagem de presente: {enabled ? 'ligada' : 'desligada'}</span>
        </label>
        {error && (
          <p role="alert" className="settings-error">
            {error}
          </p>
        )}
        <p role="status">{notice}</p>
        <p>
          {total === 0
            ? 'Nenhum modelo cadastrado.'
            : `${available} ${available === 1 ? 'modelo disponível' : 'modelos disponíveis'} de ${total} ${total === 1 ? 'cadastrado' : 'cadastrados'}`}
        </p>
        {enabled && available === 0 && (
          <p role="alert" className="settings-warning">
            A embalagem está ligada, mas nenhum modelo tem estoque. Os clientes não verão a opção.
          </p>
        )}
        <Link href="/admin/produtos/" className="settings-link">
          Cadastrar e editar os modelos (em Produtos, filtre por &quot;Embalagens de presente&quot;)
        </Link>
      </section>
    </div>
  );
}
