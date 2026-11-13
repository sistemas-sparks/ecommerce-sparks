'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { buildCartView, type GiftWrapPublic } from '@sparks/shared';
import { products as catalogProducts } from '@/app/(site)/_lib/catalog';
import { useLiveProducts } from '@/app/(site)/_lib/use-live-products';
import { fetchGiftWrap } from '@/features/cart/api';
import { useAppliedCoupon, useQuoteSig } from '@/features/cart/cart-local';
import { useCartDraft, useCartSession } from '@/features/cart/cart-store';
import { publicConfig } from '@/lib/public-config';
import { checkoutBlock, resolveCheckoutSession } from './checkout-logic';

type GiftState =
  { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: GiftWrapPublic };

const noopSubscribe = () => () => {};

/**
 * Lê a sacola do navegador e confirma preço e estoque na API. Os números são só de exibição:
 * o servidor recalcula tudo no POST /checkout (R3.3).
 */
export function useCheckoutCart() {
  // No HTML estático a sacola ainda não foi lida; evita piscar "sacola vazia".
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const draft = useCartDraft();
  const session = useCartSession();
  const appliedCoupon = useAppliedCoupon();
  const quoteSig = useQuoteSig();

  const inCart = useMemo(
    () => catalogProducts.filter((p) => draft.some((item) => item.productId === p.id)),
    [draft],
  );
  const live = useLiveProducts(inCart);
  const pricesLoading = inCart.length > 0 && live.products.length === 0 && !live.error;

  // Embalagem de presente: precisa do preço do modelo escolhido.
  const wantsGift = session.giftWrap !== null;
  const [gift, setGift] = useState<GiftState>({ status: 'loading' });
  const [giftAttempt, setGiftAttempt] = useState(0);
  useEffect(() => {
    if (!wantsGift || !publicConfig.apiUrl) return;
    const controller = new AbortController();
    fetchGiftWrap(controller.signal)
      .then((data) => setGift({ status: 'ok', data }))
      .catch(() => {
        if (!controller.signal.aborted) setGift({ status: 'error' });
      });
    return () => controller.abort();
  }, [wantsGift, giftAttempt]);
  const chosenModel =
    gift.status === 'ok' && gift.data.enabled && session.giftWrap
      ? (gift.data.models.find((m) => m.id === session.giftWrap?.productId) ?? null)
      : null;

  const { coupon, shipping } = resolveCheckoutSession({ draft, session, appliedCoupon, quoteSig });

  const view = buildCartView({
    draft,
    catalogProducts: inCart,
    liveProducts: live.products,
    giftWrapPriceCents: chosenModel?.priceCents ?? null,
    appliedDiscountCents: coupon?.discountCents ?? 0,
    shippingCents: shipping?.mode === 'options' ? shipping.priceCents : null,
    shippingChosen: shipping !== null,
  });

  const block = checkoutBlock({
    draft,
    pricesLoading,
    pricesError: live.error,
    hasLineProblem: view.lines.some((l) => l.status !== 'ok'),
    gift: { wanted: wantsGift, status: gift.status, modelFound: chosenModel !== null },
    shippingReady: shipping !== null,
  });

  return {
    mounted,
    draft,
    session,
    view,
    coupon,
    shipping,
    chosenModel,
    block,
    retryPrices: live.retry,
    retryGift: () => {
      setGift({ status: 'loading' });
      setGiftAttempt((n) => n + 1);
    },
  };
}

export type CheckoutCart = ReturnType<typeof useCheckoutCart>;
