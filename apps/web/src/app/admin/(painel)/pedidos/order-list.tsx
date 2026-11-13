'use client';

import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  PAYMENT_ALERT_LABELS,
  formatBRL,
  type AdminOrderList,
  type AdminPaymentAlert,
} from '@sparks/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api';
import { Button } from '@/ui';
import { useAdmin } from '../../_lib/admin-context';
import { formatDateTime } from './logic';
import { EMPTY_FILTERS, fetchAlerts, fetchOrders, listQuery, type ListFilters } from './orders-api';

const message = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

function FilterForm({
  filters,
  onApply,
}: {
  filters: ListFilters;
  onApply: (f: ListFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const set = (patch: Partial<ListFilters>) => setDraft((d) => ({ ...d, ...patch }));
  function submit(event: FormEvent) {
    event.preventDefault();
    onApply({ ...draft, page: 1 });
  }
  return (
    <form className="orders-filters" onSubmit={submit} role="search" aria-label="Filtrar pedidos">
      <label className="orders-field">
        Código
        <input
          value={draft.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="SPK-7F3K2"
          maxLength={10}
          autoCapitalize="characters"
          autoComplete="off"
        />
      </label>
      <label className="orders-field">
        Status
        <select value={draft.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Todos</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="orders-field">
        De
        <input type="date" value={draft.from} onChange={(e) => set({ from: e.target.value })} />
      </label>
      <label className="orders-field">
        Até
        <input type="date" value={draft.to} onChange={(e) => set({ to: e.target.value })} />
      </label>
      <div className="orders-actions">
        <Button type="submit">Filtrar</Button>
        <Button variant="white" onClick={() => onApply(EMPTY_FILTERS)}>
          Limpar
        </Button>
      </div>
    </form>
  );
}

function Alerts({ alerts }: { alerts: AdminPaymentAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <section aria-labelledby="orders-alerts" className="orders-alerts">
      <h2 id="orders-alerts">Pagamentos que pedem atenção</h2>
      <p>O estorno é feito no painel do Mercado Pago. Aqui você só confere.</p>
      <ul>
        {alerts.map((a, i) => (
          <li key={`${a.paymentId ?? 'x'}-${i}`}>
            <strong>{PAYMENT_ALERT_LABELS[a.result]}</strong>
            <span>
              {a.orderId && a.orderCode ? (
                <Link href={`/admin/pedidos/?id=${a.orderId}`}>{a.orderCode}</Link>
              ) : (
                'Pedido não encontrado'
              )}
              {a.paidCents !== null && <> · pago {formatBRL(a.paidCents)}</>}
              {a.orderTotalCents !== null && <> · pedido {formatBRL(a.orderTotalCents)}</>}
              {a.paymentId && <> · pagamento {a.paymentId}</>} · {formatDateTime(a.at)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function OrderList({ filters }: { filters: ListFilters }) {
  const { getAccessToken } = useAdmin();
  const router = useRouter();
  const key = listQuery(filters);
  const [loaded, setLoaded] = useState<{ key: string; list: AdminOrderList } | null>(null);
  const [failed, setFailed] = useState<{ key: string; text: string } | null>(null);
  const [alerts, setAlerts] = useState<AdminPaymentAlert[]>([]);
  const [attempt, setAttempt] = useState(0);

  const go = useCallback(
    (next: ListFilters) => router.push(`/admin/pedidos/${listQuery(next)}`),
    [router],
  );

  useEffect(() => {
    let active = true;
    void getAccessToken()
      .then((token) => fetchOrders(token, filters))
      .then((list) => {
        if (active) setLoaded({ key, list });
      })
      .catch((err) => {
        if (active) setFailed({ key, text: message(err, 'Não foi possível carregar os pedidos.') });
      });
    return () => {
      active = false;
    };
    // `key` resume os filtros; `attempt` força nova tentativa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt, getAccessToken]);

  useEffect(() => {
    let active = true;
    void getAccessToken()
      .then(fetchAlerts)
      .then((found) => {
        if (active) setAlerts(found);
      })
      .catch(() => {
        // Os alertas são um extra: a lista continua útil sem eles.
      });
    return () => {
      active = false;
    };
  }, [getAccessToken]);

  const list = loaded?.key === key ? loaded.list : null;
  const error = failed?.key === key ? failed.text : '';

  return (
    <div className="orders-panel">
      <h1 className="orders-title">Pedidos</h1>
      <Alerts alerts={alerts} />
      {list && (list.pending.awaitingShippingQuote > 0 || list.pending.paid > 0) && (
        <p className="orders-todo">
          {list.pending.awaitingShippingQuote > 0 && (
            <button
              type="button"
              onClick={() => go({ ...EMPTY_FILTERS, status: 'awaiting_shipping_quote' })}
            >
              {list.pending.awaitingShippingQuote} aguardando o seu frete
            </button>
          )}
          {list.pending.paid > 0 && (
            <button type="button" onClick={() => go({ ...EMPTY_FILTERS, status: 'paid' })}>
              {list.pending.paid} {list.pending.paid === 1 ? 'pago' : 'pagos'} para separar
            </button>
          )}
        </p>
      )}
      <FilterForm key={key} filters={filters} onApply={go} />

      {error ? (
        <div>
          <p role="alert" className="orders-error">
            {error}
          </p>
          <Button
            onClick={() => {
              setFailed(null);
              setAttempt((n) => n + 1);
            }}
          >
            Tentar de novo
          </Button>
        </div>
      ) : !list ? (
        <p role="status">Carregando pedidos…</p>
      ) : list.orders.length === 0 ? (
        <p>{key ? 'Nenhum pedido com esses filtros.' : 'Nenhum pedido ainda.'}</p>
      ) : (
        <>
          <ul className="orders-list">
            {list.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/pedidos/?id=${o.id}`} className="orders-row">
                  <span className="orders-row-code">{o.code}</span>
                  <span className="orders-row-status">{ORDER_STATUS_LABELS[o.status]}</span>
                  <span className="orders-row-name">{o.customerName}</span>
                  <span className="orders-row-meta">
                    {o.itemCount} {o.itemCount === 1 ? 'item' : 'itens'}
                    {o.hasGiftMessage && ' · cartão de presente'}
                    {' · '}
                    {formatDateTime(o.createdAt)}
                  </span>
                  <span className="orders-row-total">{formatBRL(o.totalCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <nav className="orders-pager" aria-label="Páginas de pedidos">
            <Button
              variant="white"
              disabled={list.page <= 1}
              onClick={() => go({ ...filters, page: filters.page - 1 })}
            >
              Anteriores
            </Button>
            <span>Página {list.page}</span>
            <Button
              variant="white"
              disabled={!list.hasMore}
              onClick={() => go({ ...filters, page: filters.page + 1 })}
            >
              Próximos
            </Button>
          </nav>
        </>
      )}
    </div>
  );
}
