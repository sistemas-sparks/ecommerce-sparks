// Chamadas da página do pedido, da consulta e da conta. Toda resposta passa por Zod (@sparks/shared)
// antes de ser mostrada; o que o servidor devolveu é a única fonte do status do pedido.
import {
  accountFavoritesSchema,
  orderSummaryListSchema,
  orderViewSchema,
  profileSchema,
  type AccountFavorites,
  type OrderSummary,
  type OrderView,
  type Profile,
  type ProfileInput,
} from '@sparks/shared';
import { ApiError, apiFetch } from '@/lib/api';

export const UNEXPECTED_ORDER_RESPONSE =
  'Não conseguimos ler a resposta da loja. Tente de novo em instantes.';

function parseOrThrow<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
  body: unknown,
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success || parsed.data === undefined) {
    throw new ApiError(0, 'unexpected_response', UNEXPECTED_ORDER_RESPONSE);
  }
  return parsed.data;
}

/**
 * Pedido pelo link exclusivo. 404 vira ApiError('order_not_found'). O link é a credencial: vai no
 * corpo do POST, nunca na URL da API (que fica nos logs de requisições do Worker).
 */
export async function fetchOrderByToken(token: string): Promise<OrderView> {
  const body = await apiFetch('/orders/by-token', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
  return parseOrThrow<OrderView>(orderViewSchema, body);
}

/** Pedido por código + WhatsApp. Cada chamada gasta um token do Turnstile (R3.6). */
export async function lookupOrder(input: {
  code: string;
  whatsapp: string;
  turnstileToken: string;
}): Promise<OrderView> {
  const body = await apiFetch('/orders/lookup', { method: 'POST', body: JSON.stringify(input) });
  return parseOrThrow<OrderView>(orderViewSchema, body);
}

/** Guarda na conta o pedido aberto pelo link exclusivo. */
export async function claimOrder(token: string, accessToken: string): Promise<void> {
  await apiFetch('/orders/claim', {
    method: 'POST',
    token: accessToken,
    body: JSON.stringify({ token }),
  });
}

// ---- Conta do cliente ----
export async function fetchMyOrders(accessToken: string): Promise<OrderSummary[]> {
  const body = await apiFetch('/me/orders', { token: accessToken });
  return parseOrThrow<{ orders: OrderSummary[] }>(orderSummaryListSchema, body).orders;
}

export async function fetchMyOrder(code: string, accessToken: string): Promise<OrderView> {
  const body = await apiFetch(`/me/orders/${encodeURIComponent(code)}`, { token: accessToken });
  return parseOrThrow<OrderView>(orderViewSchema, body);
}

export async function fetchProfile(accessToken: string): Promise<Profile> {
  return parseOrThrow<Profile>(
    profileSchema,
    await apiFetch('/me/profile', { token: accessToken }),
  );
}

export async function saveProfile(input: ProfileInput, accessToken: string): Promise<Profile> {
  return parseOrThrow<Profile>(
    profileSchema,
    await apiFetch('/me/profile', {
      method: 'PUT',
      token: accessToken,
      body: JSON.stringify(input),
    }),
  );
}

export async function fetchAccountFavorites(accessToken: string): Promise<string[]> {
  const body = await apiFetch('/me/favorites', { token: accessToken });
  return parseOrThrow<AccountFavorites>(accountFavoritesSchema, body).ids;
}

export async function saveAccountFavorites(ids: string[], accessToken: string): Promise<string[]> {
  const body = await apiFetch('/me/favorites', {
    method: 'PUT',
    token: accessToken,
    body: JSON.stringify({ ids }),
  });
  return parseOrThrow<AccountFavorites>(accountFavoritesSchema, body).ids;
}
