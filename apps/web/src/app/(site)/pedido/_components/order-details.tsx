import type { ReactNode } from 'react';
import { formatBRL, type OrderView } from '@sparks/shared';
import { whatsappHref } from '../../_lib/catalog';
import {
  deliveryText,
  formatDateTime,
  history,
  paymentLabel,
  reservationText,
  statusMessage,
  trackingInfo,
} from '../_lib/order-view-model';
import { CopyCodeButton } from './copy-code-button';
import '../order.css';

export const ORDER_HEADING_ID = 'order-heading';

/**
 * Pedido como o servidor devolveu, sem "Pagar" nem ações que mudem o pedido. Todo texto vindo do
 * banco (nome do produto, rastreio) é renderizado como texto comum: React escapa o conteúdo.
 */
export function OrderDetails({
  order,
  nested = false,
  children,
}: {
  order: OrderView;
  /** Dentro de outra seção com título h2 (ex.: Meus pedidos): os títulos descem um nível. */
  nested?: boolean;
  children?: ReactNode;
}) {
  const Title = nested ? 'h3' : 'h2';
  const Sub = nested ? 'h4' : 'h3';
  const message = statusMessage(order.status);
  const reservation = reservationText(order);
  const tracking = trackingInfo(order);
  const delivery = deliveryText(order);
  const payment = paymentLabel(order.paymentMethod);
  const awaitingQuote = order.status === 'awaiting_shipping_quote';
  const alert = order.status === 'canceled' || order.status === 'expired';

  return (
    <article aria-labelledby={ORDER_HEADING_ID}>
      <header className="order-head">
        <p className="order-eyebrow">Pedido</p>
        <Title id={ORDER_HEADING_ID} className="order-code" tabIndex={-1}>
          {order.code}
        </Title>
        <p className="order-muted">
          Feito em {formatDateTime(order.createdAt)}
          {order.customerFirstName ? ` · ${order.customerFirstName}` : ''}
        </p>
      </header>

      <section className="order-status" data-tone={alert ? 'alert' : undefined}>
        <Sub className="order-status-title">{message.title}</Sub>
        <p>{message.text}</p>
        {reservation ? <p className="order-muted">{reservation}</p> : null}
      </section>

      {tracking ? (
        <section className="order-section" aria-labelledby="order-tracking-title">
          <Sub id="order-tracking-title" className="order-section-title">
            Rastreio
          </Sub>
          <p>
            Código: <strong>{tracking.code}</strong>
            {tracking.carrier ? ` (${tracking.carrier})` : ''}
          </p>
          <p>
            <CopyCodeButton code={tracking.code} />
          </p>
          {tracking.href ? (
            <p>
              <a
                className="order-link"
                href={tracking.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir o rastreamento dos Correios
              </a>
              <span className="order-muted"> (cole o código lá)</span>
            </p>
          ) : (
            <p className="order-muted">Use o código no site da transportadora.</p>
          )}
        </section>
      ) : null}

      <section className="order-section" aria-labelledby="order-items-title">
        <Sub id="order-items-title" className="order-section-title">
          Itens
        </Sub>
        <ul className="order-items">
          {order.items.map((item, index) => (
            <li key={`${index}-${item.name}`} className="order-item">
              <span className="order-item-name">{item.name}</span>
              <span className="order-item-total">{formatBRL(item.unitPriceCents * item.qty)}</span>
              <span className="order-muted">
                {item.qty} × {formatBRL(item.unitPriceCents)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="order-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{formatBRL(order.subtotalCents)}</dd>
          </div>
          {order.discountCents > 0 ? (
            <div>
              <dt>Desconto</dt>
              <dd>− {formatBRL(order.discountCents)}</dd>
            </div>
          ) : null}
          {order.giftWrapCents > 0 ? (
            <div>
              <dt>Embalagem de presente</dt>
              <dd>{formatBRL(order.giftWrapCents)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Frete</dt>
            <dd>
              {order.shippingCents === null
                ? 'A combinar'
                : order.shippingCents === 0
                  ? 'Grátis'
                  : formatBRL(order.shippingCents)}
            </dd>
          </div>
          <div className="order-total-line">
            <dt>{awaitingQuote ? 'Total sem frete' : 'Total'}</dt>
            <dd>{formatBRL(order.totalCents)}</dd>
          </div>
        </dl>
      </section>

      <section className="order-section" aria-labelledby="order-delivery-title">
        <Sub id="order-delivery-title" className="order-section-title">
          Entrega e pagamento
        </Sub>
        <dl className="order-facts">
          {order.destination ? (
            <div>
              <dt>Destino</dt>
              <dd>
                {order.destination.city}, {order.destination.uf}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Entrega</dt>
            <dd>{delivery ?? 'A combinar pela loja'}</dd>
          </div>
          {payment ? (
            <div>
              <dt>Pagamento</dt>
              <dd>
                {payment}
                {order.paidAt ? ` · ${formatDateTime(order.paidAt)}` : ''}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="order-section" aria-labelledby="order-history-title">
        <Sub id="order-history-title" className="order-section-title">
          Acompanhamento
        </Sub>
        <ol className="order-history">
          {history(order).map((entry, index) => (
            <li key={`${index}-${entry.at}`}>
              <span>{entry.label}</span>
              <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
            </li>
          ))}
        </ol>
      </section>

      <div className="order-section">
        <div className="order-actions">
          {children}
          {whatsappHref ? (
            <a className="order-link" href={whatsappHref} target="_blank" rel="noopener noreferrer">
              Falar com a loja no WhatsApp
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
