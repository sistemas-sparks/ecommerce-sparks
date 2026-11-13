// Regras puras da tela de pedidos (T-019): sem React, sem rede. Dinheiro em centavos (R4.1).
// O telefone do cliente só existe no navegador da lojista: aqui ele vira o link do WhatsApp e
// nunca é gravado nem enviado a lugar nenhum (R2.4 e R3.7).
import {
  ADMIN_STATUS_TARGETS,
  ORDER_TRANSITIONS,
  formatBRL,
  type AdminOrderDetail,
  type AdminStatusTarget,
  type OrderStatus,
} from '@sparks/shared';

const TIME_ZONE = 'America/Sao_Paulo';
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));

/** Próximos status que a lojista pode escolher, na ordem do fluxo (a máquina é a do shared). */
export function nextStatuses(status: OrderStatus): AdminStatusTarget[] {
  const allowed = new Set<OrderStatus>(ORDER_TRANSITIONS[status]);
  return ADMIN_STATUS_TARGETS.filter((s) => allowed.has(s));
}

export const ACTION_LABELS: Record<AdminStatusTarget, string> = {
  preparing: 'Começar a separar',
  shipped: 'Marcar como enviado',
  delivered: 'Marcar como entregue',
  returned: 'Registrar devolução',
  canceled: 'Cancelar pedido',
};

/** Quem fez a mudança, sem expor o identificador interno do usuário. */
export function actorLabel(actor: string): string {
  if (actor.startsWith('admin')) return 'Painel';
  if (actor === 'webhook') return 'Mercado Pago';
  if (actor === 'cron') return 'Sistema (prazo)';
  if (actor === 'checkout') return 'Compra no site';
  return 'Sistema';
}

/** "12,50" ou "1.250,5" em centavos inteiros, sem float. Vazio ou inválido = null. */
export function reaisToCents(input: string): number | null {
  const text = input.trim().replace(/^R\$\s*/, '');
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(text)) return null;
  const [whole = '', fraction = ''] = text.replace(/\./g, '').split(',');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0') || '0');
}

export function addressLines(address: AdminOrderDetail['address']): string[] {
  const street = [address.street, address.number].filter(Boolean).join(', ');
  const place = [address.district, [address.city, address.uf].filter(Boolean).join(' - ')]
    .filter(Boolean)
    .join(' · ');
  return [
    [street, address.complement].filter(Boolean).join(' · '),
    place,
    address.cep ? `CEP ${address.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2')}` : '',
    address.reference ? `Referência: ${address.reference}` : '',
  ].filter(Boolean);
}

export const ADDRESS_TYPE_LABELS = {
  urban: 'Urbano',
  rural: 'Rural',
  hard_access: 'Difícil acesso',
} as const;

export function shippingSummary(shipping: AdminOrderDetail['shipping']): string {
  if (shipping.cents === null) return 'A combinar';
  const name = [shipping.label, shipping.carrier].filter(Boolean).join(' · ');
  const days =
    shipping.daysMin === null || shipping.daysMax === null
      ? ''
      : shipping.daysMin === shipping.daysMax
        ? `${shipping.daysMax} dias úteis`
        : `${shipping.daysMin} a ${shipping.daysMax} dias úteis`;
  return [name, formatBRL(shipping.cents), days].filter(Boolean).join(' · ');
}

/** Total que aparece na tela antes de liberar. Quem manda no valor é o servidor. */
export function previewTotal(order: AdminOrderDetail, shippingCents: number): number {
  return order.subtotalCents - order.discountCents + shippingCents + (order.giftWrap?.cents ?? 0);
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/**
 * Mensagem pronta do "Avisar no WhatsApp". Só afirma o que o sistema sabe; nada de promessa de
 * estorno, prazo de entrega ou política da loja que não esteja cadastrada.
 */
export function whatsappMessage(order: AdminOrderDetail): string {
  const hello = `Olá, ${firstName(order.customer.name)}! Aqui é da Sparks Papelaria.`;
  const code = order.code;
  switch (order.status) {
    case 'awaiting_shipping_quote':
      return `${hello} Recebemos o seu pedido ${code} e estamos calculando o frete para o seu endereço. Nada foi cobrado. Em breve passamos o valor e o prazo.`;
    case 'awaiting_payment': {
      const total = formatBRL(order.totalCents);
      const freight =
        order.shipping.cents === null
          ? ''
          : ` O frete ficou em ${formatBRL(order.shipping.cents)}.`;
      const link = order.paymentUrl
        ? ` Para pagar com Pix ou cartão, use este link: ${order.paymentUrl}`
        : '';
      const until = order.reservedUntil
        ? ` Os itens ficam reservados até ${formatDateTime(order.reservedUntil)}.`
        : '';
      return `${hello} O seu pedido ${code} está pronto para pagamento.${freight} Total: ${total}.${link}${until}`;
    }
    case 'paid':
      return `${hello} Recebemos o pagamento do pedido ${code}. Obrigada! Já vamos separar os seus itens.`;
    case 'preparing':
      return `${hello} Estamos separando o seu pedido ${code}.`;
    case 'shipped':
      return order.trackingCode
        ? `${hello} O seu pedido ${code} foi enviado. Código de rastreio: ${order.trackingCode}.`
        : `${hello} O seu pedido ${code} foi enviado.`;
    case 'delivered':
      return `${hello} O seu pedido ${code} foi entregue. Esperamos que goste!`;
    case 'canceled':
      return `${hello} O seu pedido ${code} foi cancelado. Se tiver alguma dúvida, é só responder esta mensagem.`;
    case 'expired':
      return `${hello} O prazo de pagamento do pedido ${code} terminou e os itens voltaram ao estoque. Se ainda quiser, é só fazer um novo pedido pelo site.`;
    case 'returned':
      return `${hello} Registramos a devolução do pedido ${code}. Qualquer dúvida, é só responder esta mensagem.`;
  }
}

/**
 * Texto da confirmação de cancelamento. Pedido pago: o sistema devolve o estoque, mas o dinheiro
 * só volta se a lojista estornar no Mercado Pago (o valor e o número do pagamento ficam à vista).
 */
export function cancelConfirmText(
  order: Pick<AdminOrderDetail, 'paidAt' | 'paymentId' | 'totalCents'>,
): string {
  if (!order.paidAt) return 'Cancelar o pedido? Os itens voltam ao estoque.';
  const payment = order.paymentId ? `do pagamento ${order.paymentId}` : 'do pagamento deste pedido';
  return `Cancelar o pedido? Os itens voltam ao estoque. O dinheiro não volta sozinho: depois, estorne ${formatBRL(order.totalCents)} ${payment} no Mercado Pago.`;
}

/** Link wa.me com a mensagem pronta. O número vem do pedido (10 ou 11 dígitos, sem o 55). */
export function whatsappLink(whatsapp: string, message: string): string | null {
  const digits = whatsapp.replace(/\D/g, '');
  if (!/^[1-9][1-9]9?\d{8}$/.test(digits)) return null;
  return `https://wa.me/55${digits}?text=${encodeURIComponent(message)}`;
}

/** "(79) 99999-1234" para a lojista conferir o número. */
export function formatPhone(whatsapp: string): string {
  const d = whatsapp.replace(/\D/g, '');
  return d.length === 11
    ? d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
    : d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
}

export const GIFT_MESSAGE_MAX = 140;
/** Texto do cartão como texto puro: quebras e espaços sobrando saem, nunca vira HTML. */
export function giftCardText(message: string | null | undefined): string {
  return [...(message ?? '').replace(/\s+/g, ' ').trim()].slice(0, GIFT_MESSAGE_MAX).join('');
}
