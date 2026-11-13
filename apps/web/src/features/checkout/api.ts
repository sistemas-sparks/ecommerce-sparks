import { ApiError, apiFetch } from '@/lib/api';
import {
  UNEXPECTED_RESPONSE_MESSAGE,
  parseCheckoutResponse,
  type CheckoutOutcome,
  type buildCheckoutRequest,
} from './checkout-logic';

/**
 * POST /checkout na nossa API (R2.5). Erros chegam como ApiError com mensagem em português.
 * Cada chamada gasta um token do Turnstile; o servidor recalcula preço, frete e total.
 */
export async function submitCheckout(
  body: ReturnType<typeof buildCheckoutRequest>,
): Promise<CheckoutOutcome> {
  const response = await apiFetch('/checkout', { method: 'POST', body: JSON.stringify(body) });
  const outcome = parseCheckoutResponse(response);
  if (!outcome) throw new ApiError(0, 'unexpected_response', UNEXPECTED_RESPONSE_MESSAGE);
  return outcome;
}
