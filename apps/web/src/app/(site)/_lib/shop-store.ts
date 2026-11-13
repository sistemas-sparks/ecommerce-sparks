'use client';

import { useSyncExternalStore } from 'react';
import { cartDraftSchema, favoriteIdsSchema, type CartItemInput } from '@sparks/shared';

export const FAVORITES_KEY = 'sparks-favorites';
export const CART_KEY = 'sparks-cart';
const CHANGE_EVENT = 'sparks-shop-change';
const EMPTY_FAVORITES: string[] = [];
const EMPTY_CART: CartItemInput[] = [];

function read(key: string) {
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
function readFavorites(raw: string): string[] {
  try {
    const parsed = favoriteIdsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_FAVORITES;
  } catch {
    return EMPTY_FAVORITES;
  }
}
function readCart(raw: string): CartItemInput[] {
  try {
    const parsed = cartDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_CART;
  } catch {
    return EMPTY_CART;
  }
}
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Cota cheia ou storage bloqueado: não muda nada e não avisa os ouvintes.
    return false;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return true;
}
export function useFavorites() {
  return readFavorites(
    useSyncExternalStore(
      subscribe,
      () => read(FAVORITES_KEY),
      () => '',
    ),
  );
}
export function useCartDraft() {
  return readCart(
    useSyncExternalStore(
      subscribe,
      () => read(CART_KEY),
      () => '',
    ),
  );
}
export function setFavorite(id: string, selected: boolean) {
  const ids = readFavorites(read(FAVORITES_KEY)).filter((value) => value !== id);
  write(FAVORITES_KEY, favoriteIdsSchema.parse(selected ? [...ids, id] : ids));
}
export function addCartItem(id: string, qty: number, stock: number) {
  const items = readCart(read(CART_KEY));
  const existing = items.find((item) => item.productId === id);
  const nextQty = (existing?.qty ?? 0) + qty;
  if (nextQty > stock || nextQty > 99) throw new Error('Essa quantidade não está disponível.');
  const saved = write(
    CART_KEY,
    cartDraftSchema.parse([
      ...items.filter((item) => item.productId !== id),
      { productId: id, qty: nextQty },
    ]),
  );
  if (!saved) throw new Error('Não foi possível guardar a sacola neste navegador.');
}
export function setCartQty(id: string, qty: number) {
  if (!Number.isInteger(qty)) return;
  if (qty <= 0) return removeCartItem(id);
  const items = readCart(read(CART_KEY));
  const nextQty = Math.min(qty, 99);
  if (!items.some((item) => item.productId === id)) return;
  write(
    CART_KEY,
    cartDraftSchema.parse(
      items.map((item) => (item.productId === id ? { ...item, qty: nextQty } : item)),
    ),
  );
}
export function removeCartItem(id: string) {
  const items = readCart(read(CART_KEY));
  write(CART_KEY, cartDraftSchema.parse(items.filter((item) => item.productId !== id)));
}
export function clearCart() {
  write(CART_KEY, []);
}
