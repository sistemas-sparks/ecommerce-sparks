import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, type OrderView } from '@sparks/shared';
import {
  deliveryText,
  formatDateTime,
  history,
  reservationText,
  shouldPoll,
  statusMessage,
  tokenFromPath,
  trackingInfo,
} from './order-view-model';

function view(over: Partial<OrderView> = {}): OrderView {
  return {
    code: 'SPK-7F3K2',
    status: 'paid',
    createdAt: '2026-11-10T14:30:00Z',
    paidAt: '2026-11-10T14:35:00Z',
    reservedUntil: null,
    customerFirstName: 'Maria',
    destination: { city: 'Aracaju', uf: 'SE' },
    items: [{ name: 'Caderno', qty: 1, unitPriceCents: 2500 }],
    subtotalCents: 2500,
    discountCents: 0,
    shippingCents: 1200,
    giftWrapCents: 0,
    totalCents: 3700,
    shipping: { label: 'Entrega local', carrier: null, daysMin: 1, daysMax: 2 },
    paymentMethod: 'pix',
    trackingCode: null,
    events: [],
    linkedToAccount: false,
    ...over,
  };
}

describe('mensagens de status (PRD §4.3)', () => {
  it('todo status tem título e texto em português', () => {
    for (const status of ORDER_STATUSES) {
      const m = statusMessage(status);
      expect(m.title.length).toBeGreaterThan(3);
      expect(m.text.length).toBeGreaterThan(10);
    }
  });

  it('aguardando frete: avisa que nada foi cobrado e que a loja confirma pelo WhatsApp', () => {
    const m = statusMessage('awaiting_shipping_quote');
    expect(m.text).toContain('Nada foi cobrado');
    expect(m.text).toContain('WhatsApp');
  });

  it('aguardando pagamento não afirma que está pago', () => {
    const m = statusMessage('awaiting_payment');
    expect(m.title).toBe('Aguardando pagamento');
    expect(m.text).not.toMatch(/pagamento confirmado/i);
  });

  it('expirado orienta quem pagou depois do prazo, sem prometer estorno', () => {
    const m = statusMessage('expired');
    expect(m.text).toContain('Se você chegou a pagar');
    expect(m.text).not.toMatch(/estorn|reembols/i);
  });

  it('só aguardando pagamento consulta o servidor de novo', () => {
    expect(ORDER_STATUSES.filter(shouldPoll)).toEqual(['awaiting_payment']);
  });
});

describe('datas no fuso da loja', () => {
  it('mostra horário de São Paulo, não UTC', () => {
    expect(formatDateTime('2026-11-10T14:30:00Z')).toBe('10/11/2026 às 11:30');
    // Meia-noite UTC ainda é o dia anterior em São Paulo.
    expect(formatDateTime('2026-11-11T01:15:00Z')).toBe('10/11/2026 às 22:15');
  });
  it('data inválida não quebra a página', () => {
    expect(formatDateTime('ontem')).toBe('ontem');
  });
});

describe('reserva dos itens', () => {
  const waiting = view({ status: 'awaiting_payment', reservedUntil: '2026-11-10T15:00:00Z' });
  it('mostra até quando vale', () => {
    const now = new Date('2026-11-10T14:40:00Z').getTime();
    expect(reservationText(waiting, now)).toBe(
      'Seus itens ficam reservados até 10/11/2026 às 12:00.',
    );
  });
  it('depois do prazo, avisa sem inventar estado', () => {
    const now = new Date('2026-11-10T15:10:00Z').getTime();
    expect(reservationText(waiting, now)).toContain('O prazo da reserva acabou');
  });
  it('não aparece em outros status', () => {
    expect(reservationText(view({ reservedUntil: '2026-11-10T15:00:00Z' }))).toBeNull();
  });
});

describe('entrega e rastreio', () => {
  it('serviço e prazo', () => {
    expect(deliveryText(view())).toBe('Entrega local · 1 a 2 dias úteis');
    expect(
      deliveryText(
        view({ shipping: { label: 'SEDEX', carrier: 'Correios', daysMin: 3, daysMax: 3 } }),
      ),
    ).toBe('SEDEX · Correios · 3 dias úteis');
  });
  it('frete a combinar não mostra entrega', () => {
    expect(deliveryText(view({ shipping: null, shippingCents: null }))).toBeNull();
  });
  it('Correios: só a página oficial, sem o código na URL; outra transportadora: só o código, sem link', () => {
    const correios = trackingInfo(
      view({
        status: 'shipped',
        trackingCode: 'AB123456789BR',
        shipping: { label: 'PAC', carrier: 'Correios', daysMin: 5, daysMax: 8 },
      }),
    );
    expect(correios).toEqual({
      code: 'AB123456789BR',
      href: 'https://rastreamento.correios.com.br/',
      carrier: 'Correios',
    });
    const other = trackingInfo(
      view({
        trackingCode: 'JD0001',
        shipping: { label: '.Package', carrier: 'Jadlog', daysMin: 5, daysMax: 8 },
      }),
    );
    expect(correios?.href).not.toContain('AB123456789BR');
    expect(other?.href).toBeNull();
    expect(other?.code).toBe('JD0001');
  });
  it('código de rastreio com caracteres estranhos é ignorado', () => {
    expect(trackingInfo(view({ trackingCode: '"><script>x</script>' }))).toBeNull();
    expect(trackingInfo(view({ trackingCode: null }))).toBeNull();
  });
});

describe('histórico', () => {
  it('usa os eventos do servidor, com nomes em português', () => {
    const h = history(
      view({
        events: [
          { status: 'awaiting_payment', at: '2026-11-10T14:30:00Z' },
          { status: 'paid', at: '2026-11-10T14:35:00Z' },
        ],
      }),
    );
    expect(h.map((e) => e.label)).toEqual(['Aguardando pagamento', 'Pago']);
  });
  it('sem eventos, mostra ao menos o status atual', () => {
    expect(history(view())).toEqual([{ label: 'Pago', at: '2026-11-10T14:30:00Z' }]);
  });
});

describe('link exclusivo na URL', () => {
  const token = 'A'.repeat(43);
  it('lê o código secreto do caminho, com ou sem barra final', () => {
    expect(tokenFromPath(`/pedido/${token}/`)).toBe(token);
    expect(tokenFromPath(`/pedido/${token}`)).toBe(token);
  });
  it('recusa caminhos que não são um link de pedido', () => {
    for (const path of ['/pedido/', '/pedido/curto/', `/pedido/${token}x/`, `/outra/${token}/`]) {
      expect(tokenFromPath(path)).toBeNull();
    }
    // O parâmetro que o Mercado Pago anexa fica na query e não participa do caminho.
    expect(tokenFromPath(new URL(`https://x.dev/pedido/${token}/?status=approved`).pathname)).toBe(
      token,
    );
  });
});
