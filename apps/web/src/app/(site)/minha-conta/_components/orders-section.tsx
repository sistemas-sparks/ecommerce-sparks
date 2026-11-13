'use client';

import { useEffect, useState } from 'react';
import { formatBRL, ORDER_STATUS_LABELS, type OrderSummary, type OrderView } from '@sparks/shared';
import { ApiError } from '@/lib/api';
import { Button } from '@/ui';
import { OrderDetails } from '../../pedido/_components/order-details';
import { fetchMyOrder, fetchMyOrders } from '../../pedido/_lib/api';
import { formatDate } from '../../pedido/_lib/order-view-model';

type List =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; orders: OrderSummary[] };

type Detail =
  | { kind: 'loading'; code: string }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'ready'; code: string; order: OrderView };

/** "Meus pedidos": os pedidos guardados nesta conta. */
export function OrdersSection({ accessToken }: { accessToken: string }) {
  const [list, setList] = useState<List>({ kind: 'loading' });
  const [detail, setDetail] = useState<Detail | null>(null);

  useEffect(() => {
    let active = true;
    fetchMyOrders(accessToken)
      .then((orders) => active && setList({ kind: 'ready', orders }))
      .catch(
        (err: unknown) =>
          active &&
          setList({
            kind: 'error',
            message:
              err instanceof ApiError ? err.message : 'Não foi possível carregar os pedidos.',
          }),
      );
    return () => {
      active = false;
    };
  }, [accessToken]);

  const open = async (code: string) => {
    setDetail({ kind: 'loading', code });
    try {
      setDetail({ kind: 'ready', code, order: await fetchMyOrder(code, accessToken) });
    } catch (err) {
      setDetail({
        kind: 'error',
        code,
        message: err instanceof ApiError ? err.message : 'Não foi possível abrir o pedido.',
      });
    }
  };

  return (
    <section className="order-section" aria-labelledby="orders-title">
      <h2 id="orders-title" className="order-section-title">
        Meus pedidos
      </h2>

      {list.kind === 'loading' ? (
        <div role="status" aria-busy="true">
          <div className="order-skeleton" aria-hidden="true" />
          <span className="order-muted">Carregando seus pedidos…</span>
        </div>
      ) : null}

      {list.kind === 'error' ? (
        <p className="order-error" role="alert">
          {list.message}
        </p>
      ) : null}

      {list.kind === 'ready' && list.orders.length === 0 ? (
        <p className="order-muted">
          Você ainda não tem pedidos guardados nesta conta. Para guardar um pedido feito sem login,
          abra o link dele com a conta conectada e use “Guardar na minha conta”.
        </p>
      ) : null}

      {list.kind === 'ready' && list.orders.length > 0 ? (
        <ul className="account-orders">
          {list.orders.map((order) => (
            <li key={order.code} className="account-order">
              <span className="account-order-code">{order.code}</span>
              <Button
                variant="outline"
                aria-expanded={detail?.code === order.code}
                onClick={() =>
                  detail?.code === order.code ? setDetail(null) : void open(order.code)
                }
              >
                {detail?.code === order.code ? 'Fechar' : 'Ver detalhes'}
              </Button>
              <span className="account-order-meta">
                {formatDate(order.createdAt)} · {ORDER_STATUS_LABELS[order.status]} ·{' '}
                {formatBRL(order.totalCents)}
              </span>
              {detail?.code === order.code ? (
                <div className="account-detail">
                  {detail.kind === 'loading' ? (
                    <p role="status" className="order-muted">
                      Abrindo o pedido…
                    </p>
                  ) : null}
                  {detail.kind === 'error' ? (
                    <p role="alert" className="order-error">
                      {detail.message}
                    </p>
                  ) : null}
                  {detail.kind === 'ready' ? <OrderDetails order={detail.order} nested /> : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
