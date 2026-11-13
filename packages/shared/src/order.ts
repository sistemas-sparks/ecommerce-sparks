// Tipos e regras de pedido compartilhados entre API e site.
// O trigger de status no banco (supabase/migrations) espelha ORDER_TRANSITIONS: mude os dois juntos.

export const ORDER_STATUSES = [
  'awaiting_shipping_quote',
  'awaiting_payment',
  'paid',
  'preparing',
  'shipped',
  'delivered',
  'expired',
  'canceled',
  'returned',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_shipping_quote: 'Aguardando frete',
  awaiting_payment: 'Aguardando pagamento',
  paid: 'Pago',
  preparing: 'Em separação',
  shipped: 'Enviado',
  delivered: 'Entregue',
  expired: 'Expirado',
  canceled: 'Cancelado',
  returned: 'Devolvido',
};

/** Transições permitidas. Estados finais não saem para lugar nenhum. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  awaiting_shipping_quote: ['awaiting_payment', 'canceled'],
  awaiting_payment: ['paid', 'expired', 'canceled'],
  paid: ['preparing', 'canceled'],
  preparing: ['shipped', 'canceled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  expired: [],
  canceled: [],
  returned: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export const ADDRESS_TYPES = ['urban', 'rural', 'hard_access'] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number];

export const PAYMENT_METHODS = ['pix', 'credit_card', 'debit_card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const SHIPPING_SERVICES = ['local', 'economy', 'express'] as const;
export type ShippingService = (typeof SHIPPING_SERVICES)[number];

export const SHIPPING_SERVICE_LABELS: Record<ShippingService, string> = {
  local: 'Entrega local',
  economy: 'Econômico',
  express: 'Expresso',
};

// Código do pedido: "SPK-" + 5 caracteres sem ambíguos (sem 0, 1, I, L, O).
export const ORDER_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ORDER_CODE_LENGTH = 5;
export const ORDER_CODE_REGEX = /^SPK-[2-9A-HJKMNP-Z]{5}$/;

/**
 * Gera um código de pedido com aleatoriedade criptográfica (rejection sampling, sem viés).
 * A unicidade é garantida pelo banco (UNIQUE); em caso de colisão, gerar outro.
 */
export function generateOrderCode(
  getRandomValues: (array: Uint8Array) => Uint8Array = (a) => crypto.getRandomValues(a),
): string {
  const size = ORDER_CODE_ALPHABET.length;
  const limit = 256 - (256 % size);
  let code = '';
  while (code.length < ORDER_CODE_LENGTH) {
    const bytes = getRandomValues(new Uint8Array(16));
    for (const byte of bytes) {
      if (byte < limit && code.length < ORDER_CODE_LENGTH) {
        code += ORDER_CODE_ALPHABET[byte % size];
      }
    }
  }
  return `SPK-${code}`;
}
