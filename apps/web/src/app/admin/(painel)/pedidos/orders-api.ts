// Chamadas à API de pedidos do painel. Toda resposta é validada com o mesmo schema da API.
import {
  adminOrderDetailSchema,
  adminOrderListSchema,
  adminPaymentAlertsSchema,
  type AdminOrderDetail,
  type AdminOrderList,
  type AdminPaymentAlert,
  type AdminStatusTarget,
} from '@sparks/shared';
import { apiFetch } from '@/lib/api';

export interface ListFilters {
  status: string;
  from: string;
  to: string;
  q: string;
  page: number;
}

export const EMPTY_FILTERS: ListFilters = { status: '', from: '', to: '', q: '', page: 1 };

export function listQuery(filters: ListFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.page > 1) params.set('page', String(filters.page));
  const text = params.toString();
  return text ? `?${text}` : '';
}

export async function fetchOrders(token: string, filters: ListFilters): Promise<AdminOrderList> {
  return adminOrderListSchema.parse(
    await apiFetch(`/admin/orders${listQuery(filters)}`, { token }),
  );
}

export async function fetchOrder(token: string, id: string): Promise<AdminOrderDetail> {
  return adminOrderDetailSchema.parse(await apiFetch(`/admin/orders/${id}`, { token }));
}

export async function fetchAlerts(token: string): Promise<AdminPaymentAlert[]> {
  return adminPaymentAlertsSchema.parse(await apiFetch('/admin/orders/payment-alerts', { token }))
    .alerts;
}

export async function changeStatus(
  token: string,
  id: string,
  status: AdminStatusTarget,
  trackingCode?: string,
): Promise<AdminOrderDetail> {
  return adminOrderDetailSchema.parse(
    await apiFetch(`/admin/orders/${id}/status`, {
      method: 'POST',
      token,
      body: JSON.stringify({ status, ...(trackingCode ? { trackingCode } : {}) }),
    }),
  );
}

export async function saveTracking(
  token: string,
  id: string,
  trackingCode: string,
): Promise<AdminOrderDetail> {
  return adminOrderDetailSchema.parse(
    await apiFetch(`/admin/orders/${id}/tracking`, {
      method: 'PUT',
      token,
      body: JSON.stringify({ trackingCode }),
    }),
  );
}

export async function releaseQuote(
  token: string,
  id: string,
  quote: {
    shippingCents: number;
    daysMin: number;
    daysMax: number;
    label?: string;
    carrier?: string;
  },
): Promise<AdminOrderDetail> {
  return adminOrderDetailSchema.parse(
    await apiFetch(`/admin/orders/${id}/quote`, {
      method: 'POST',
      token,
      body: JSON.stringify(quote),
    }),
  );
}
