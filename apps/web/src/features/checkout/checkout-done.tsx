'use client';

import { useEffect, useRef } from 'react';
import { formatBRL } from '@sparks/shared';
import { ButtonLink } from '@/ui';
import type { CheckoutOutcome } from './checkout-logic';

/**
 * Depois do POST /checkout: ou abre o pagamento no Mercado Pago, ou confirma o pedido que está
 * aguardando o frete (nada é cobrado antes da confirmação da loja).
 */
export function CheckoutDone({ outcome }: { outcome: CheckoutOutcome }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const checkoutUrl = outcome.kind === 'payment' ? outcome.checkoutUrl : null;

  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (checkoutUrl) window.location.assign(checkoutUrl);
  }, [checkoutUrl]);

  if (outcome.kind === 'payment') {
    return (
      <section className="checkout-done" aria-labelledby="checkout-done-title">
        <h2 id="checkout-done-title" className="checkout-title" ref={heading} tabIndex={-1}>
          Abrindo o pagamento
        </h2>
        <p role="status">
          Pedido {outcome.code} criado. Estamos levando você ao Mercado Pago, onde o pagamento é
          feito por Pix ou cartão.
        </p>
        <p className="checkout-muted">
          Se a página não abrir sozinha, use o botão abaixo. Guarde o código do pedido.
        </p>
        <div className="checkout-actions">
          <ButtonLink href={outcome.checkoutUrl}>Abrir o pagamento</ButtonLink>
          {outcome.orderUrl ? (
            <a className="checkout-link" href={outcome.orderUrl}>
              Acompanhar o pedido
            </a>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="checkout-done" aria-labelledby="checkout-done-title">
      <h2 id="checkout-done-title" className="checkout-title" ref={heading} tabIndex={-1}>
        Pedido recebido
      </h2>
      <p>
        Pedido <strong>{outcome.code}</strong> · aguardando frete
      </p>
      <p>
        <strong>Nada foi cobrado.</strong> {outcome.message}
      </p>
      <p className="checkout-muted">Total sem frete: {formatBRL(outcome.totalCents)}</p>
      <div className="checkout-actions">
        {outcome.orderUrl ? (
          <a className="sparks-button" data-variant="primary" href={outcome.orderUrl}>
            Acompanhar o pedido
          </a>
        ) : null}
        <ButtonLink href="/" variant="plum">
          Continuar comprando
        </ButtonLink>
      </div>
    </section>
  );
}
