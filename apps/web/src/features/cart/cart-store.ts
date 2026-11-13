'use client';

// Fachada fina: quantidades ficam no shop-store; escolhas (CEP, cupom, frete) na sessão.
export {
  useCartDraft,
  addCartItem,
  setCartQty,
  removeCartItem,
  clearCart,
} from '@/app/(site)/_lib/shop-store';
export { useCartSession, updateCartSession, clearCartSession } from './session';
export { cartSessionSchema, type CartSession } from '@sparks/shared';

import { clearCart } from '@/app/(site)/_lib/shop-store';
import { clearCartSession } from './session';
import { setAppliedCoupon, setQuoteSig } from './cart-local';

/** Esvazia a sacola e as escolhas (usado depois de um pedido criado). */
export function resetCart() {
  clearCart();
  clearCartSession();
  setAppliedCoupon(null);
  setQuoteSig(null);
}
