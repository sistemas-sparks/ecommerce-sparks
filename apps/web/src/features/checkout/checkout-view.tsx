'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { resetCart } from '@/features/cart/cart-store';
import { Button, ButtonLink } from '@/ui';
import { CheckoutDone } from './checkout-done';
import { CheckoutForm } from './checkout-form';
import type { CheckoutBlock, CheckoutOutcome } from './checkout-logic';
import { useCheckoutCart } from './use-checkout-cart';
import './checkout.css';

function Notice({ children, alert }: { children: ReactNode; alert?: boolean }) {
  return (
    <div className="checkout-state" role={alert ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

function BagLink() {
  return (
    <Link href="/sacola/" className="sparks-button" data-variant="primary">
      Voltar à sacola
    </Link>
  );
}

function blockedView(block: CheckoutBlock, retryPrices: () => void, retryGift: () => void) {
  switch (block) {
    case 'empty':
      return (
        <Notice>
          <p>Sua sacola está vazia.</p>
          <ButtonLink href="/">Continuar comprando</ButtonLink>
        </Notice>
      );
    case 'prices-loading':
    case 'gift-loading':
      return (
        <Notice>
          <p>Confirmando preços e estoque...</p>
        </Notice>
      );
    case 'prices-error':
      return (
        <Notice alert>
          <p>Não foi possível confirmar os preços e o estoque.</p>
          <Button variant="plum" onClick={retryPrices}>
            Tentar de novo
          </Button>
        </Notice>
      );
    case 'gift-error':
      return (
        <Notice alert>
          <p>Não foi possível confirmar a embalagem de presente.</p>
          <Button variant="plum" onClick={retryGift}>
            Tentar de novo
          </Button>
        </Notice>
      );
    case 'gift-missing':
      return (
        <Notice alert>
          <p>A embalagem de presente escolhida não está mais disponível.</p>
          <BagLink />
        </Notice>
      );
    case 'stock':
      return (
        <Notice alert>
          <p>Algum item da sacola está sem estoque ou indisponível.</p>
          <BagLink />
        </Notice>
      );
    case 'shipping':
      return (
        <Notice>
          <p>Calcule o frete na sacola para finalizar a compra.</p>
          <BagLink />
        </Notice>
      );
  }
}

export function CheckoutView() {
  const cart = useCheckoutCart();
  const [outcome, setOutcome] = useState<CheckoutOutcome | null>(null);

  if (outcome) return <CheckoutDone outcome={outcome} />;
  if (!cart.mounted) {
    return (
      <Notice>
        <p>Carregando...</p>
      </Notice>
    );
  }
  if (cart.block) return blockedView(cart.block, cart.retryPrices, cart.retryGift);

  return (
    <CheckoutForm
      cart={cart}
      onDone={(done) => {
        // O pedido já existe no servidor: esvazia a sacola para não repetir a compra.
        resetCart();
        setOutcome(done);
      }}
    />
  );
}
