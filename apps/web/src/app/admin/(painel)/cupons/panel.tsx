'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  couponAdminListSchema,
  couponAdminRowSchema,
  couponStateLabel,
  getCouponState,
  type CouponAdminRow,
} from '@sparks/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { Button } from '@/ui';
import { useAdmin } from '../../_lib/admin-context';
import { CouponForm } from './coupon-form';
import { discountLabel, minOrderLabel, usesLabel, validityLabel } from './format';
import './coupons.css';

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

type Editing = { kind: 'new' } | { kind: 'edit'; coupon: CouponAdminRow } | null;

export function CouponsPanel() {
  const { getAccessToken } = useAdmin();
  const [coupons, setCoupons] = useState<CouponAdminRow[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [busyId, setBusyId] = useState('');
  const [confirmId, setConfirmId] = useState('');

  const load = useCallback(async () => {
    return couponAdminListSchema.parse(
      await apiFetch('/admin/coupons', { token: await getAccessToken() }),
    ).coupons;
  }, [getAccessToken]);

  const retry = useCallback(() => {
    setError('');
    void load()
      .then(setCoupons)
      .catch((err) => setError(errorMessage(err, 'Não foi possível carregar os cupons.')));
  }, [load]);

  useEffect(() => {
    let active = true;
    void load()
      .then((loaded) => {
        if (active) setCoupons(loaded);
      })
      .catch((err) => {
        if (active) setError(errorMessage(err, 'Não foi possível carregar os cupons.'));
      });
    return () => {
      active = false;
    };
  }, [load]);

  function saved(row: CouponAdminRow) {
    setCoupons((current) => {
      const list = current ?? [];
      return list.some((c) => c.id === row.id)
        ? list.map((c) => (c.id === row.id ? row : c))
        : [row, ...list];
    });
    setEditing(null);
    setError('');
    setNotice('Cupom salvo.');
  }

  async function toggleActive(coupon: CouponAdminRow) {
    setBusyId(coupon.id);
    setError('');
    setNotice('');
    try {
      const body = {
        type: coupon.type,
        value: coupon.value,
        minOrderCents: coupon.minOrderCents,
        maxUses: coupon.maxUses,
        startsAt: coupon.startsAt,
        endsAt: coupon.endsAt,
        active: !coupon.active,
      };
      const row = couponAdminRowSchema.parse(
        await apiFetch(`/admin/coupons/${coupon.id}`, {
          method: 'PATCH',
          token: await getAccessToken(),
          body: JSON.stringify(body),
        }),
      );
      setCoupons((current) => (current ?? []).map((c) => (c.id === row.id ? row : c)));
      setNotice(row.active ? `${row.code} ativado.` : `${row.code} desativado.`);
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível alterar o cupom.'));
    } finally {
      setBusyId('');
    }
  }

  async function remove(coupon: CouponAdminRow) {
    setBusyId(coupon.id);
    setError('');
    setNotice('');
    try {
      await apiFetch(`/admin/coupons/${coupon.id}`, {
        method: 'DELETE',
        token: await getAccessToken(),
      });
      setCoupons((current) => (current ?? []).filter((c) => c.id !== coupon.id));
      setConfirmId('');
      setNotice(`${coupon.code} excluído.`);
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível excluir o cupom.'));
    } finally {
      setBusyId('');
    }
  }

  if (!coupons) {
    return (
      <div>
        <h1 className="coupons-title">Cupons</h1>
        {error ? (
          <>
            <p role="alert" className="coupons-error">
              {error}
            </p>
            <Button onClick={retry}>Tentar de novo</Button>
          </>
        ) : (
          <p role="status">Carregando cupons…</p>
        )}
      </div>
    );
  }

  return (
    <div className="coupons-panel">
      <div className="coupons-head">
        <h1 className="coupons-title">Cupons</h1>
        {!editing && coupons.length > 0 && (
          <Button onClick={() => setEditing({ kind: 'new' })}>Novo cupom</Button>
        )}
      </div>
      {error && (
        <p role="alert" className="coupons-error">
          {error}
        </p>
      )}
      <p role="status" className="coupons-notice">
        {notice}
      </p>
      {editing && (
        <CouponForm
          key={editing.kind === 'edit' ? editing.coupon.id : 'new'}
          coupon={editing.kind === 'edit' ? editing.coupon : null}
          getToken={getAccessToken}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      )}
      {coupons.length === 0 && !editing ? (
        <div>
          <p>Nenhum cupom cadastrado.</p>
          <Button onClick={() => setEditing({ kind: 'new' })}>Novo cupom</Button>
        </div>
      ) : (
        <ul className="coupons-list">
          {coupons.map((coupon) => {
            const state = getCouponState(coupon);
            const busy = busyId === coupon.id;
            return (
              <li key={coupon.id}>
                <h2 className="coupons-code">{coupon.code}</h2>
                <dl>
                  <div>
                    <dt>Desconto</dt>
                    <dd>{discountLabel(coupon)}</dd>
                  </div>
                  <div>
                    <dt>Compra mínima</dt>
                    <dd>{minOrderLabel(coupon.minOrderCents)}</dd>
                  </div>
                  <div>
                    <dt>Usos</dt>
                    <dd>{usesLabel(coupon)}</dd>
                  </div>
                  <div>
                    <dt>Validade</dt>
                    <dd>{validityLabel(coupon.startsAt, coupon.endsAt)}</dd>
                  </div>
                  <div>
                    <dt>Situação</dt>
                    <dd>{couponStateLabel[state]}</dd>
                  </div>
                </dl>
                {confirmId === coupon.id ? (
                  <div className="coupons-actions">
                    <p className="coupons-confirm">Excluir {coupon.code}?</p>
                    <Button disabled={busy} onClick={() => void remove(coupon)}>
                      Sim, excluir
                    </Button>
                    <Button variant="white" disabled={busy} onClick={() => setConfirmId('')}>
                      Não
                    </Button>
                  </div>
                ) : (
                  <div className="coupons-actions">
                    <Button
                      variant="white"
                      disabled={busy}
                      onClick={() => {
                        setNotice('');
                        setEditing({ kind: 'edit', coupon });
                      }}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="white"
                      disabled={busy}
                      onClick={() => void toggleActive(coupon)}
                    >
                      {coupon.active ? 'Desativar' : 'Ativar'}
                    </Button>
                    <Button variant="white" disabled={busy} onClick={() => setConfirmId(coupon.id)}>
                      Excluir
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
