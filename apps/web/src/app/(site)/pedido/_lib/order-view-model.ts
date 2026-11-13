// Textos e formatação do pedido para o cliente. Só funções puras (testadas em order-view-model.test.ts).
// A página mostra o que o servidor devolveu: nada aqui decide pagamento ou status (R3.3).
import {
  ORDER_STATUS_LABELS,
  formatDays,
  type OrderStatus,
  type OrderView,
  type PaymentMethod,
} from '@sparks/shared';

export interface StatusMessage {
  title: string;
  text: string;
}

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
};

const FALLBACK_STORE_CONTACT = 'fale com a loja';

const STATUS_MESSAGES: Record<OrderStatus, StatusMessage> = {
  awaiting_shipping_quote: {
    title: 'Aguardando confirmação do frete',
    text: 'Recebemos seu pedido. A loja vai confirmar o frete pelo WhatsApp antes de qualquer cobrança. Nada foi cobrado até agora.',
  },
  awaiting_payment: {
    title: 'Aguardando pagamento',
    text: 'Assim que o pagamento for confirmado, o pedido passa para pago e esta página se atualiza. A confirmação de Pix e cartão pode levar alguns instantes.',
  },
  paid: {
    title: 'Pagamento confirmado',
    text: 'A loja vai separar o seu pedido e avisar pelo WhatsApp quando ele for enviado.',
  },
  preparing: {
    title: 'Em separação',
    text: 'Estamos separando e embalando o seu pedido.',
  },
  shipped: {
    title: 'Pedido enviado',
    text: 'Seu pedido já saiu da loja e está a caminho.',
  },
  delivered: {
    title: 'Pedido entregue',
    text: `Seu pedido foi entregue. Se algo não saiu como esperado, ${FALLBACK_STORE_CONTACT}.`,
  },
  expired: {
    title: 'Prazo de pagamento encerrado',
    text: `O pagamento não foi confirmado a tempo e os itens voltaram ao estoque. Se você chegou a pagar, ${FALLBACK_STORE_CONTACT} pelo WhatsApp para resolvermos.`,
  },
  canceled: {
    title: 'Pedido cancelado',
    text: `Este pedido foi cancelado. Em caso de dúvida, ${FALLBACK_STORE_CONTACT} pelo WhatsApp.`,
  },
  returned: {
    title: 'Pedido devolvido',
    text: `Este pedido foi devolvido. Em caso de dúvida, ${FALLBACK_STORE_CONTACT} pelo WhatsApp.`,
  },
};

export function statusMessage(status: OrderStatus): StatusMessage {
  return STATUS_MESSAGES[status];
}

/** Só enquanto aguarda pagamento a página pergunta de novo ao servidor. */
export function shouldPoll(status: OrderStatus): boolean {
  return status === 'awaiting_payment';
}

const SAO_PAULO = 'America/Sao_Paulo';

/** "10/11/2026 às 08:30", no fuso da loja. Data inválida volta como veio. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} às ${get('hour')}:${get('minute')}`;
}

export function formatDate(iso: string): string {
  return formatDateTime(iso).split(' às ')[0] ?? iso;
}

/** Quanto tempo os itens ficam reservados (só aguardando pagamento e ainda no prazo). */
export function reservationText(view: OrderView, now: number = Date.now()): string | null {
  if (view.status !== 'awaiting_payment' || !view.reservedUntil) return null;
  const until = new Date(view.reservedUntil).getTime();
  if (Number.isNaN(until)) return null;
  if (until <= now) {
    return 'O prazo da reserva acabou. Se o pagamento não for confirmado, o pedido expira.';
  }
  return `Seus itens ficam reservados até ${formatDateTime(view.reservedUntil)}.`;
}

export function paymentLabel(method: PaymentMethod | null): string | null {
  return method ? PAYMENT_LABELS[method] : null;
}

/** "Entrega local · 1 a 2 dias úteis". null enquanto o frete está a combinar. */
export function deliveryText(view: OrderView): string | null {
  const shipping = view.shipping;
  if (!shipping) return null;
  const parts: string[] = [];
  const name = [shipping.label, shipping.carrier]
    .filter((v): v is string => Boolean(v))
    .filter((v, i, all) => all.indexOf(v) === i)
    .join(' · ');
  if (name) parts.push(name);
  if (shipping.daysMin !== null && shipping.daysMax !== null) {
    parts.push(formatDays(shipping.daysMin, shipping.daysMax));
  }
  return parts.length ? parts.join(' · ') : null;
}

// Página inicial oficial de rastreamento dos Correios. Não montamos link com o código do objeto
// porque o formato da URL pública atual não foi confirmado (docs/memoria.md, Pendências).
const CORREIOS_TRACKING_URL = 'https://rastreamento.correios.com.br/';
const TRACKING_CODE = /^[A-Za-z0-9-]{5,40}$/;

export interface TrackingInfo {
  code: string;
  /** Página oficial de rastreamento, só quando for dos Correios (sem o código na URL). */
  href: string | null;
  carrier: string | null;
}

/**
 * Código de rastreio informado pela loja. Mostramos sempre o código (com botão de copiar). Só os
 * Correios têm endereço oficial conhecido; para as outras transportadoras não criamos link, pois
 * não dá para verificar o endereço de cada uma ([A DEFINIR] com a lojista).
 */
export function trackingInfo(view: OrderView): TrackingInfo | null {
  if (!view.trackingCode || !TRACKING_CODE.test(view.trackingCode)) return null;
  const carrier = view.shipping?.carrier ?? null;
  const isCorreios = /correios/i.test(`${carrier ?? ''} ${view.shipping?.label ?? ''}`);
  return {
    code: view.trackingCode,
    href: isCorreios ? CORREIOS_TRACKING_URL : null,
    carrier,
  };
}

export interface HistoryEntry {
  label: string;
  at: string;
}

/** Histórico do pedido, do mais antigo para o mais novo. */
export function history(view: OrderView): HistoryEntry[] {
  const entries = view.events.map((e) => ({ label: ORDER_STATUS_LABELS[e.status], at: e.at }));
  if (entries.length > 0) return entries;
  return [{ label: ORDER_STATUS_LABELS[view.status], at: view.createdAt }];
}

/** Link exclusivo na URL /pedido/<token>/ (aceita ou não a barra final). */
export function tokenFromPath(pathname: string): string | null {
  const match = /^\/pedido\/([A-Za-z0-9_-]{43})\/?$/.exec(pathname);
  return match?.[1] ?? null;
}
