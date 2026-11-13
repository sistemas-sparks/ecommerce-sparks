import { formatBRL, type CartViewTotals } from '@sparks/shared';

export type CartShippingState = 'chosen' | 'consult' | 'none';

export interface CartTotalsProps {
  totals: CartViewTotals;
  shippingState: CartShippingState;
}

export function CartTotals({ totals, shippingState }: CartTotalsProps) {
  const shippingLabel =
    shippingState === 'consult'
      ? 'A combinar'
      : shippingState === 'none'
        ? 'Calcule o frete'
        : totals.shippingCents === 0
          ? 'Grátis'
          : formatBRL(totals.shippingCents ?? 0);
  return (
    <section className="cart-section" aria-labelledby="cart-totals-title">
      <h3 id="cart-totals-title" className="cart-title">
        Resumo
      </h3>
      <dl className="cart-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{formatBRL(totals.subtotalCents)}</dd>
        </div>
        {totals.discountCents > 0 && (
          <div>
            <dt>Desconto</dt>
            <dd>−{formatBRL(totals.discountCents)}</dd>
          </div>
        )}
        {totals.giftWrapCents > 0 && (
          <div>
            <dt>Embalagem</dt>
            <dd>{formatBRL(totals.giftWrapCents)}</dd>
          </div>
        )}
        <div>
          <dt>Frete</dt>
          <dd>{shippingLabel}</dd>
        </div>
        <div className="cart-total-final">
          <dt>{shippingState === 'consult' ? 'Total sem frete' : 'Total'}</dt>
          <dd>{formatBRL(totals.totalCents)}</dd>
        </div>
      </dl>
      <p className="cart-hint">O valor final é confirmado no pagamento.</p>
    </section>
  );
}
