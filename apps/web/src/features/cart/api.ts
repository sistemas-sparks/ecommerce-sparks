import {
  couponValidateResponseSchema,
  giftWrapPublicSchema,
  hybridShippingQuoteResponseSchema,
  type CartItemInput,
  type CouponValidateResponse,
  type GiftWrapPublic,
} from '@sparks/shared';
import { apiFetch } from '@/lib/api';

type AddressType = 'urban' | 'rural' | 'hard_access';
export type ShippingQuoteResult = ReturnType<typeof hybridShippingQuoteResponseSchema.parse>;

// Só rotas da nossa API (R2.5). Erros (ApiError) sobem sem mudar a mensagem.
export async function fetchGiftWrap(signal?: AbortSignal): Promise<GiftWrapPublic> {
  return giftWrapPublicSchema.parse(await apiFetch('/gift-wrap', { signal }));
}

export async function validateCoupon(input: {
  couponCode: string;
  items: CartItemInput[];
  turnstileToken: string;
}): Promise<CouponValidateResponse> {
  const body = await apiFetch('/coupons/validate', {
    method: 'POST',
    body: JSON.stringify({
      couponCode: input.couponCode,
      items: input.items,
      turnstileToken: input.turnstileToken,
    }),
  });
  return couponValidateResponseSchema.parse(body);
}

export async function quoteShipping(input: {
  cep: string;
  items: CartItemInput[];
  addressType: AddressType;
  couponCode?: string;
  giftWrapProductId?: string;
  turnstileToken: string;
}): Promise<ShippingQuoteResult> {
  const body = await apiFetch('/shipping/quote', {
    method: 'POST',
    body: JSON.stringify({
      cep: input.cep,
      items: input.items,
      addressType: input.addressType,
      ...(input.couponCode ? { couponCode: input.couponCode } : {}),
      ...(input.giftWrapProductId ? { giftWrapProductId: input.giftWrapProductId } : {}),
      turnstileToken: input.turnstileToken,
    }),
  });
  return hybridShippingQuoteResponseSchema.parse(body);
}
