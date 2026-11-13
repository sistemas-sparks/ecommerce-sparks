// Converte a linha do banco no pedido que o cliente enxerga. Fica de fora tudo o que não precisa
// aparecer (WhatsApp, e-mail, endereço completo, ids internos, notas da loja): R3.7.
import {
  SHIPPING_SERVICE_LABELS,
  type OrderRow,
  type OrderSummary,
  type OrderView,
  type ShippingService,
} from '@sparks/shared';

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}

function shippingLabel(row: OrderRow): string | null {
  if (row.shipping_label) return row.shipping_label;
  // Pedidos antigos, de antes do frete híbrido, só têm o código do serviço.
  const legacy = row.shipping_service as ShippingService | null;
  return legacy && legacy in SHIPPING_SERVICE_LABELS ? SHIPPING_SERVICE_LABELS[legacy] : null;
}

export function toOrderView(row: OrderRow): OrderView {
  const events = [...row.order_events].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const city = row.address.city?.trim();
  const uf = row.address.uf?.trim();
  return {
    code: row.code,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    reservedUntil: row.status === 'awaiting_payment' ? row.reserved_until : null,
    customerFirstName: firstName(row.customer_name),
    destination: city && uf ? { city, uf } : null,
    items: row.order_items.map((i) => ({
      name: i.name_snapshot,
      qty: i.qty,
      unitPriceCents: i.unit_price_cents,
    })),
    subtotalCents: row.subtotal_cents,
    discountCents: row.discount_cents,
    shippingCents: row.shipping_cents,
    giftWrapCents: row.gift_wrap_cents,
    totalCents: row.total_cents,
    shipping:
      row.shipping_cents === null
        ? null
        : {
            label: shippingLabel(row),
            carrier: row.shipping_carrier,
            daysMin: row.shipping_days_min,
            daysMax: row.shipping_days_max,
          },
    paymentMethod: row.payment_method,
    trackingCode: row.tracking_code,
    events: events.map((e) => ({ status: e.to_status, at: e.created_at })),
    linkedToAccount: row.customer_user_id !== null,
  };
}

export function toOrderSummary(row: OrderRow): OrderSummary {
  return {
    code: row.code,
    status: row.status,
    createdAt: row.created_at,
    totalCents: row.total_cents,
    itemCount: row.order_items.reduce((sum, i) => sum + i.qty, 0),
  };
}
