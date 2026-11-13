'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  activeCoupon,
  buildCartView,
  cepSchema,
  couponCodeSchema,
  isCouponStale,
  isShippingCurrent,
  itemsSignature,
  maskCep,
  shippingSignature,
  type GiftWrapPublic,
} from '@sparks/shared';
import { Turnstile } from '@/app/admin/_components/turnstile';
import { useLiveProducts } from '@/app/(site)/_lib/use-live-products';
import { products as catalogProducts } from '@/app/(site)/_lib/catalog';
import { publicConfig } from '@/lib/public-config';
import { Button, ButtonLink } from '@/ui';
import { fetchGiftWrap, quoteShipping, validateCoupon } from './api';
import {
  removeCartItem,
  setCartQty,
  updateCartSession,
  useCartDraft,
  useCartSession,
} from './cart-store';
import {
  errorMessage,
  setAppliedCoupon,
  setQuoteSig,
  useAppliedCoupon,
  useQuoteSig,
} from './cart-local';
import { CartCoupon } from './cart-coupon';
import { CartGiftWrap } from './cart-gift-wrap';
import { CartItems } from './cart-items';
import { CartShipping, type QuoteView } from './cart-shipping';
import { CartTotals } from './cart-totals';
import './cart.css';

export interface CartPanelProps {
  /** Chamado ao seguir um link (produto, "Continuar comprando", checkout): o painel pode se fechar. */
  onNavigate?: () => void;
}

type GiftState =
  { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: GiftWrapPublic };

const CALC_UNAVAILABLE = 'Cálculo indisponível no momento';

export function CartPanel({ onNavigate }: CartPanelProps) {
  const draft = useCartDraft();
  const session = useCartSession();
  const appliedCoupon = useAppliedCoupon();
  const quoteSig = useQuoteSig();

  const inCart = useMemo(
    () => catalogProducts.filter((p) => draft.some((item) => item.productId === p.id)),
    [draft],
  );
  const live = useLiveProducts(inCart);
  const pricesLoading = draft.length > 0 && live.products.length === 0 && !live.error;
  // Sem dado ao vivo (carregando ou erro): não mostra aviso de estoque.
  const noLiveData = draft.length > 0 && live.products.length === 0;

  // Embalagem de presente (GET /gift-wrap)
  const [giftMessageInvalid, setGiftMessageInvalid] = useState(false);
  const [gift, setGift] = useState<GiftState>({ status: 'loading' });
  const [giftAttempt, setGiftAttempt] = useState(0);
  useEffect(() => {
    if (!publicConfig.apiUrl) return;
    const controller = new AbortController();
    fetchGiftWrap(controller.signal)
      .then((data) => setGift({ status: 'ok', data }))
      .catch(() => {
        if (!controller.signal.aborted) setGift({ status: 'error' });
      });
    return () => controller.abort();
  }, [giftAttempt]);
  const giftModels = gift.status === 'ok' && gift.data.enabled ? gift.data.models : [];
  const chosenModel = session.giftWrap
    ? (giftModels.find((m) => m.id === session.giftWrap?.productId) ?? null)
    : null;

  // Assinaturas: o que muda o desconto (itens) e o que muda o frete (tudo que o servidor usa).
  const itemsSig = itemsSignature(draft);
  const couponStale = isCouponStale(appliedCoupon, itemsSig);
  const couponActive = activeCoupon(appliedCoupon, itemsSig, session.couponCode);
  const fullSig = shippingSignature({
    itemsSig,
    couponCode: couponActive?.code ?? null,
    giftWrapProductId: session.giftWrap?.productId ?? null,
    cep: session.cep,
    addressType: session.addressType,
  });
  const fullSigRef = useRef(fullSig);
  useEffect(() => {
    fullSigRef.current = fullSig;
  }, [fullSig]);
  const itemsSigRef = useRef(itemsSig);
  useEffect(() => {
    itemsSigRef.current = itemsSig;
  }, [itemsSig]);

  // Limpezas que dependem de mudanças feitas fora deste componente (outras telas, outras abas).
  useEffect(() => {
    if (gift.status !== 'ok' || !session.giftWrap) return;
    if (!gift.data.enabled || !chosenModel) updateCartSession({ giftWrap: null, shipping: null });
  }, [gift, session.giftWrap, chosenModel]);
  useEffect(() => {
    if (session.couponCode && (!appliedCoupon || couponStale)) {
      // Cupom descartado porque a sacola mudou: guarda a marca para mostrar o aviso.
      if (appliedCoupon && couponStale) setAppliedCoupon({ ...appliedCoupon, discarded: true });
      updateCartSession({ couponCode: null, shipping: null });
    } else if (!session.couponCode && appliedCoupon && !appliedCoupon.discarded) {
      // Sobra antiga sem cupom na sessão.
      setAppliedCoupon(null);
    }
  }, [session.couponCode, appliedCoupon, couponStale]);
  useEffect(() => {
    if (session.shipping && !isShippingCurrent(quoteSig, fullSig))
      updateCartSession({ shipping: null });
  }, [session.shipping, quoteSig, fullSig]);

  const shipping =
    session.shipping && isShippingCurrent(quoteSig, fullSig) ? session.shipping : null;
  const view = buildCartView({
    draft,
    catalogProducts: inCart,
    liveProducts: live.products,
    giftWrapPriceCents: chosenModel?.priceCents ?? null,
    appliedDiscountCents: couponActive?.discountCents ?? 0,
    shippingCents: shipping?.mode === 'options' ? shipping.priceCents : null,
    shippingChosen: shipping !== null,
  });

  // Turnstile: um token vale uma chamada (R3.6).
  const canCall = Boolean(publicConfig.apiUrl && publicConfig.turnstileSiteKey);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState<'coupon' | 'shipping' | null>(null);
  const waitingToken = canCall && !token;
  const callsDisabled = !canCall || waitingToken || busy !== null;
  const spendToken = () => {
    const value = token;
    setToken(null);
    setResetKey((k) => k + 1);
    return value;
  };

  // Cupom
  const [couponError, setCouponError] = useState<string | null>(null);
  const applyCoupon = async (raw: string) => {
    setCouponError(null);
    const parsed = couponCodeSchema.safeParse(raw);
    if (!parsed.success)
      return setCouponError(parsed.error.issues[0]?.message ?? 'Cupom inválido.');
    const turnstileToken = spendToken();
    if (!turnstileToken) return;
    const requestSig = itemsSig;
    setBusy('coupon');
    try {
      const result = await validateCoupon({
        couponCode: parsed.data,
        items: draft,
        turnstileToken,
      });
      if (itemsSigRef.current !== requestSig)
        return setCouponError('A sacola mudou. Aplique o cupom de novo.');
      setAppliedCoupon({
        code: result.couponCode,
        discountCents: result.discountCents,
        itemsSig: requestSig,
      });
      updateCartSession({ couponCode: result.couponCode, shipping: null });
    } catch (error) {
      setCouponError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };
  const removeCoupon = () => {
    setCouponError(null);
    setAppliedCoupon(null);
    updateCartSession({ couponCode: null, shipping: null });
  };

  // Frete
  const [cepText, setCepText] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ sig: string; view: QuoteView } | null>(null);
  const [shippingError, setShippingError] = useState<string | null>(null);
  const quoteView = quote && quote.sig === fullSig ? quote.view : null;

  const changeCep = (text: string) => {
    const masked = maskCep(text);
    setCepText(masked);
    setShippingError(null);
    const digits = masked.replace(/\D/g, '');
    updateCartSession({ cep: digits.length === 8 ? digits : '', shipping: null });
  };
  const changeAddressType = (addressType: typeof session.addressType) => {
    setShippingError(null);
    updateCartSession({ addressType, shipping: null });
  };
  const calculate = async () => {
    setShippingError(null);
    const cep = cepSchema.safeParse(cepText ?? maskCep(session.cep));
    if (!cep.success) return setShippingError(cep.error.issues[0]?.message ?? 'Confira o CEP.');
    if (session.giftWrap && !chosenModel)
      return setShippingError('Confirmando a embalagem de presente. Tente de novo em instantes.');
    const turnstileToken = spendToken();
    if (!turnstileToken) return;
    // O CEP completo já está na sessão; a assinatura usa o valor que será enviado.
    const requestSig = shippingSignature({
      itemsSig,
      couponCode: couponActive?.code ?? null,
      giftWrapProductId: session.giftWrap?.productId ?? null,
      cep: cep.data,
      addressType: session.addressType,
    });
    setBusy('shipping');
    try {
      const result = await quoteShipping({
        cep: cep.data,
        items: draft,
        addressType: session.addressType,
        couponCode: couponActive?.code,
        giftWrapProductId: chosenModel?.id,
        turnstileToken,
      });
      if (fullSigRef.current !== requestSig) return setShippingError('Calcule o frete de novo.');
      if (result.mode === 'options') {
        setQuote({ sig: requestSig, view: { kind: 'options', options: result.options } });
        const only = result.options.length === 1 ? result.options[0] : undefined;
        if (only) chooseOption(only, requestSig);
        else updateCartSession({ shipping: null });
      } else if (result.mode === 'consult') {
        setQuote({ sig: requestSig, view: { kind: 'consult', message: result.message } });
        setQuoteSig(requestSig);
        updateCartSession({ shipping: { mode: 'consult', message: result.message } });
      } else {
        setQuote({ sig: requestSig, view: { kind: 'message', message: result.message } });
        updateCartSession({ shipping: null });
      }
    } catch (error) {
      setQuote(null);
      updateCartSession({ shipping: null });
      setShippingError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };
  const chooseOption = (
    option: {
      service: string;
      carrier: string | null;
      label: string;
      priceCents: number;
      daysMin: number;
      daysMax: number;
    },
    sig: string = fullSig,
  ) => {
    setQuoteSig(sig);
    updateCartSession({ shipping: { mode: 'options', ...option } });
  };

  // Itens
  const changeQty = (productId: string, qty: number) => setCartQty(productId, qty);
  const remove = (productId: string) => removeCartItem(productId);

  if (view.isEmpty) {
    return (
      <div className="cart-panel cart-empty">
        <p>Sua sacola está vazia.</p>
        <ButtonLink href="/" onClick={onNavigate}>
          Continuar comprando
        </ButtonLink>
      </div>
    );
  }

  const lineProblem = view.lines.some((l) => l.status !== 'ok');
  let blockReason: string | null = null;
  if (live.error) blockReason = 'Não foi possível confirmar os preços.';
  else if (pricesLoading) blockReason = 'Confirmando preços...';
  else if (lineProblem) blockReason = 'Ajuste os itens sem estoque para continuar.';
  else if (session.giftWrap && !chosenModel) blockReason = 'Confirmando a embalagem de presente...';
  else if (session.giftWrap && giftMessageInvalid) blockReason = 'Corrija a mensagem do cartão.';
  else if (!shipping) blockReason = 'Calcule o frete para finalizar.';
  const canCheckout = view.canCheckout && blockReason === null;

  const turnstileUnavailable = !canCall;

  return (
    <div className="cart-panel">
      {live.error ? (
        <div className="cart-section">
          <p className="cart-error" role="alert">
            Não foi possível confirmar os preços e o estoque.
          </p>
          <Button variant="plum" onClick={live.retry}>
            Tentar de novo
          </Button>
        </div>
      ) : null}

      <CartItems
        lines={view.lines}
        loading={noLiveData}
        failed={live.error}
        onQty={changeQty}
        onRemove={remove}
        onNavigate={onNavigate}
      />

      {gift.status === 'error' ? (
        <div className="cart-section">
          <p className="cart-error" role="alert">
            Não foi possível carregar a embalagem de presente.
          </p>
          <button
            type="button"
            className="cart-link-button"
            onClick={() => {
              setGift({ status: 'loading' });
              setGiftAttempt((n) => n + 1);
            }}
          >
            Tentar de novo
          </button>
        </div>
      ) : (
        <CartGiftWrap
          models={giftModels}
          value={session.giftWrap}
          onValidity={setGiftMessageInvalid}
          onChange={(giftWrap) =>
            updateCartSession(
              giftWrap?.productId === session.giftWrap?.productId
                ? { giftWrap }
                : { giftWrap, shipping: null },
            )
          }
        />
      )}

      <CartCoupon
        appliedCode={couponActive?.code ?? null}
        discountCents={couponActive?.discountCents ?? 0}
        stale={appliedCoupon?.discarded === true && !couponActive}
        disabled={callsDisabled}
        busy={busy === 'coupon'}
        waitingToken={waitingToken}
        error={couponError}
        onApply={applyCoupon}
        onRemove={removeCoupon}
      />

      <CartShipping
        cepText={cepText ?? maskCep(session.cep)}
        addressType={session.addressType}
        onCep={changeCep}
        onAddressType={changeAddressType}
        onCalculate={calculate}
        disabled={callsDisabled}
        busy={busy === 'shipping'}
        waitingToken={waitingToken}
        quote={quoteView}
        outdated={quote !== null && quote.sig !== fullSig}
        selectedService={shipping?.mode === 'options' ? shipping.service : null}
        onSelect={(option) => chooseOption(option)}
        error={shippingError}
      />

      {turnstileUnavailable ? (
        <p className="cart-hint" role="status">
          {CALC_UNAVAILABLE}
        </p>
      ) : (
        <div className="cart-turnstile">
          <Turnstile
            siteKey={publicConfig.turnstileSiteKey}
            onToken={setToken}
            resetKey={resetKey}
          />
        </div>
      )}

      <CartTotals
        totals={view.totals}
        shippingState={shipping ? (shipping.mode === 'consult' ? 'consult' : 'chosen') : 'none'}
      />

      <div className="cart-checkout">
        {canCheckout ? (
          <ButtonLink href="/checkout/" onClick={onNavigate}>
            Finalizar compra
          </ButtonLink>
        ) : (
          <>
            <Button disabled aria-describedby="cart-block-reason">
              Finalizar compra
            </Button>
            <p id="cart-block-reason" className="cart-hint">
              {blockReason ?? 'Revise a sacola para continuar.'}
            </p>
          </>
        )}
        <Link href="/" className="cart-link-button" onClick={onNavigate}>
          Continuar comprando
        </Link>
      </div>
    </div>
  );
}
