'use client';

import { useSyncExternalStore } from 'react';
import { cartSessionSchema, type CartSession } from '@sparks/shared';

// O schema fica no shared (apps/web não tem zod). Nada aqui é confiável para cobrança (R3.3).
// Sem tokens nem segredos no storage.
export const CART_SESSION_KEY = 'sparks-cart-session';
const CHANGE_EVENT = 'sparks-cart-session-change';

export const EMPTY_CART_SESSION: CartSession = {
  cep: '',
  addressType: 'urban',
  couponCode: null,
  giftWrap: null,
  shipping: null,
};

function read(): string {
  try {
    return localStorage.getItem(CART_SESSION_KEY) ?? '';
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
function parse(raw: string): CartSession {
  try {
    const parsed = cartSessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_CART_SESSION;
  } catch {
    return EMPTY_CART_SESSION;
  }
}
function write(value: CartSession) {
  try {
    localStorage.setItem(CART_SESSION_KEY, JSON.stringify(cartSessionSchema.parse(value)));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// useSyncExternalStore exige referência estável: guarda o último texto lido.
let lastRaw = '';
let lastValue: CartSession = EMPTY_CART_SESSION;
function snapshot(): CartSession {
  const raw = read();
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastValue = parse(raw);
  }
  return lastValue;
}

export function useCartSession(): CartSession {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY_CART_SESSION);
}
export function updateCartSession(patch: Partial<CartSession>) {
  write({ ...parse(read()), ...patch });
}
export function clearCartSession() {
  try {
    localStorage.removeItem(CART_SESSION_KEY);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
