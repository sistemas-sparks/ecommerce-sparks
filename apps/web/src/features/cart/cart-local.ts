'use client';

import { useSyncExternalStore } from 'react';
import { ApiError } from '@/lib/api';

// Estado de exibição da sacola guardado no navegador (cupom aplicado e assinatura da cotação).
// Nada aqui é confiável para cobrança (R3.3): o servidor recalcula tudo.

export interface AppliedCoupon {
  code: string;
  discountCents: number;
  /** Assinatura dos itens quando o cupom foi validado. */
  itemsSig: string;
  /** Cupom descartado porque a sacola mudou (mostra o aviso). */
  discarded?: boolean;
}

const COUPON_KEY = 'sparks-cart-coupon';
const QUOTE_SIG_KEY = 'sparks-cart-quote-sig';
const CHANGE_EVENT = 'sparks-cart-local-change';

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function parseCoupon(raw: string): AppliedCoupon | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { code, discountCents, itemsSig, discarded } = value as Record<string, unknown>;
    if (
      typeof code === 'string' &&
      typeof itemsSig === 'string' &&
      typeof discountCents === 'number' &&
      Number.isInteger(discountCents) &&
      discountCents >= 0
    ) {
      return { code, discountCents, itemsSig, ...(discarded === true ? { discarded: true } : {}) };
    }
  } catch {
    return null;
  }
  return null;
}

// useSyncExternalStore exige referência estável: guarda o último texto lido.
let lastCouponRaw = '';
let lastCoupon: AppliedCoupon | null = null;
function couponSnapshot(): AppliedCoupon | null {
  const raw = read(COUPON_KEY);
  if (raw !== lastCouponRaw) {
    lastCouponRaw = raw;
    lastCoupon = raw ? parseCoupon(raw) : null;
  }
  return lastCoupon;
}

export function useAppliedCoupon(): AppliedCoupon | null {
  return useSyncExternalStore(subscribe, couponSnapshot, () => null);
}
export function setAppliedCoupon(value: AppliedCoupon | null) {
  write(COUPON_KEY, value ? JSON.stringify(value) : null);
}

/** Assinatura completa da última cotação aceita; se mudar, o frete guardado deixa de valer. */
export function useQuoteSig(): string {
  return useSyncExternalStore(
    subscribe,
    () => read(QUOTE_SIG_KEY),
    () => '',
  );
}
export function setQuoteSig(value: string | null) {
  write(QUOTE_SIG_KEY, value);
}

export { itemsSignature, maskCep, formatDays } from '@sparks/shared';

const GENERIC_ERROR = 'Não foi possível concluir agora. Tente de novo.';

/** Só a mensagem de ApiError (já em português) chega à cliente; o resto vira texto genérico. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError && error.message ? error.message : GENERIC_ERROR;
}
