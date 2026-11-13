import Image from 'next/image';
import { formatBRL, formatDays, type CartSession, type CartView } from '@sparks/shared';

export interface CheckoutReviewProps {
  view: CartView;
  shipping: NonNullable<CartSession['shipping']>;
  couponCode: string | null;
  giftWrapName: string | null;
  giftMessage: string | null;
}

/**
 * Revisão do pedido. Os valores vêm dos preços e da cotação que a API entregou; o servidor
 * confere tudo de novo ao criar o pedido (R3.3).
 */
export function CheckoutReview({
  view,
  shipping,
  couponCode,
  giftWrapName,
  giftMessage,
}: CheckoutReviewProps) {
  const { totals } = view;
  const consult = shipping.mode === 'consult';
  return (
    <>
      <ul className="checkout-items">
        {view.lines.map((line) => (
          <li key={line.productId} className="checkout-item">
            <div className="checkout-item-photo">
              {line.photo ? (
                <Image src={line.photo.url} alt={line.photo.alt} width={56} height={70} />
              ) : null}
            </div>
            <div className="checkout-item-text">
              <p className="checkout-item-name">{line.name}</p>
              <p className="checkout-muted">
                {line.qty} × {formatBRL(line.unitPriceCents)}
              </p>
            </div>
            <strong className="checkout-item-total">{formatBRL(line.lineCents)}</strong>
          </li>
        ))}
      </ul>

      {giftWrapName ? (
        <p className="checkout-gift">
          <strong>Embalagem de presente:</strong> {giftWrapName}
          {giftMessage ? <span className="checkout-gift-message">“{giftMessage}”</span> : null}
        </p>
      ) : null}

      <dl className="checkout-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{formatBRL(totals.subtotalCents)}</dd>
        </div>
        {totals.discountCents > 0 ? (
          <div>
            <dt>Desconto{couponCode ? ` (${couponCode})` : ''}</dt>
            <dd>−{formatBRL(totals.discountCents)}</dd>
          </div>
        ) : null}
        {totals.giftWrapCents > 0 ? (
          <div>
            <dt>Embalagem</dt>
            <dd>{formatBRL(totals.giftWrapCents)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Frete</dt>
          <dd>
            {shipping.mode === 'consult'
              ? 'A combinar'
              : shipping.priceCents === 0
                ? 'Grátis'
                : formatBRL(shipping.priceCents)}
          </dd>
        </div>
        <div className="checkout-total-final">
          <dt>{consult ? 'Total sem frete' : 'Total'}</dt>
          <dd>{formatBRL(totals.totalCents)}</dd>
        </div>
      </dl>

      {shipping.mode === 'options' ? (
        <p className="checkout-muted">
          {shipping.label}
          {shipping.carrier ? ` · ${shipping.carrier}` : ''} ·{' '}
          {formatDays(shipping.daysMin, shipping.daysMax)}
        </p>
      ) : null}
    </>
  );
}
