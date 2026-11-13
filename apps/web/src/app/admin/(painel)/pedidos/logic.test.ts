import { ORDER_STATUSES, type AdminOrderDetail } from '@sparks/shared';
import { describe, expect, it } from 'vitest';
import {
  actorLabel,
  addressLines,
  cancelConfirmText,
  giftCardText,
  nextStatuses,
  previewTotal,
  reaisToCents,
  shippingSummary,
  whatsappLink,
  whatsappMessage,
} from './logic';

// formatBRL usa espaço não separável depois do R$.
const plain = (text: string) => text.replace(/ /g, ' ');

function order(overrides: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'SPK-7F3K2',
    status: 'paid',
    createdAt: '2026-11-10T12:00:00.000Z',
    paidAt: null,
    reservedUntil: null,
    customer: { name: 'Ana Maria Souza', whatsapp: '79999991234', email: null },
    address: {
      cep: '49000000',
      street: 'Rua A',
      number: '10',
      complement: 'Apto 2',
      district: 'Centro',
      city: 'Aracaju',
      uf: 'SE',
      reference: null,
    },
    addressType: 'urban',
    items: [{ name: 'Caderno', qty: 2, unitPriceCents: 2500 }],
    subtotalCents: 5000,
    discountCents: 500,
    couponCode: null,
    giftWrap: { name: 'Embalagem', cents: 300, message: 'Feliz aniversário!' },
    shipping: { cents: 4000, label: 'Rodonaves', carrier: null, daysMin: 5, daysMax: 9 },
    totalCents: 8800,
    paymentMethod: null,
    paymentId: null,
    paymentUrl: null,
    trackingCode: null,
    events: [],
    ...overrides,
  };
}

describe('próximos status', () => {
  it('seguem a máquina de transições e nunca oferecem pago, expirado ou aguardando', () => {
    expect(nextStatuses('paid')).toEqual(['preparing', 'canceled']);
    expect(nextStatuses('preparing')).toEqual(['shipped', 'canceled']);
    expect(nextStatuses('shipped')).toEqual(['delivered', 'returned']);
    expect(nextStatuses('delivered')).toEqual(['returned']);
    expect(nextStatuses('awaiting_shipping_quote')).toEqual(['canceled']);
    expect(nextStatuses('awaiting_payment')).toEqual(['canceled']);
    for (const final of ['canceled', 'expired', 'returned'] as const) {
      expect(nextStatuses(final)).toEqual([]);
    }
  });
});

describe('valor do frete digitado', () => {
  it('converte reais em centavos inteiros', () => {
    expect(reaisToCents('40')).toBe(4000);
    expect(reaisToCents('40,5')).toBe(4050);
    expect(reaisToCents('R$ 1.250,90')).toBe(125090);
    expect(reaisToCents('0,07')).toBe(7);
    expect(reaisToCents('0')).toBe(0);
  });
  it('recusa o que é ambíguo ou inválido', () => {
    for (const bad of ['', 'abc', '12,345', '12.5', '-3', '1,2,3', '1e3']) {
      expect(reaisToCents(bad)).toBeNull();
    }
  });
  it('mostra o total estimado com subtotal, desconto, embalagem e frete', () => {
    expect(previewTotal(order(), 4000)).toBe(8800);
    expect(previewTotal(order({ giftWrap: null }), 0)).toBe(4500);
  });
});

describe('Avisar no WhatsApp', () => {
  it('monta o link wa.me com o 55 e a mensagem codificada', () => {
    const msg = whatsappMessage(order({ status: 'paid' }));
    const link = whatsappLink('79999991234', msg)!;
    expect(link.startsWith('https://wa.me/5579999991234?text=')).toBe(true);
    expect(decodeURIComponent(link.split('?text=')[1]!)).toBe(msg);
    expect(msg).toContain('Olá, Ana!');
    expect(msg).toContain('SPK-7F3K2');
  });
  it('aceita fixo de 10 dígitos e recusa número malformado', () => {
    expect(whatsappLink('7932111234', 'oi')).toContain('wa.me/557932111234');
    for (const bad of ['', '123', '00999991234', '5579999991234x1']) {
      expect(whatsappLink(bad, 'oi')).toBeNull();
    }
  });
  it('tem uma mensagem para cada status, sem e-mail nem dado inventado', () => {
    for (const status of ORDER_STATUSES) {
      const msg = whatsappMessage(order({ status }));
      expect(msg).toContain('SPK-7F3K2');
      expect(msg).not.toMatch(/@|undefined|null/);
    }
  });
  it('envia o rastreio quando enviado', () => {
    const msg = whatsappMessage(order({ status: 'shipped', trackingCode: 'AB123456789BR' }));
    expect(msg).toContain('AB123456789BR');
    expect(whatsappMessage(order({ status: 'shipped' }))).not.toContain('rastreio');
  });
  it('inclui o valor, o frete e o link de pagamento no pedido liberado', () => {
    const msg = whatsappMessage(
      order({
        status: 'awaiting_payment',
        paymentUrl: 'https://www.mercadopago.com.br/checkout/pref-1',
        reservedUntil: '2026-11-14T15:00:00.000Z',
      }),
    );
    expect(plain(msg)).toContain('R$ 88,00');
    expect(plain(msg)).toContain('R$ 40,00');
    expect(msg).toContain('https://www.mercadopago.com.br/checkout/pref-1');
    expect(msg).toContain('14/11/2026');
  });
  it('pedido aguardando frete avisa que nada foi cobrado', () => {
    expect(whatsappMessage(order({ status: 'awaiting_shipping_quote' }))).toContain(
      'Nada foi cobrado',
    );
  });
});

describe('cartão de presente', () => {
  it('é texto puro de no máximo 140 caracteres, sem quebras', () => {
    expect(giftCardText('  Feliz\n\naniversário!  ')).toBe('Feliz aniversário!');
    expect(giftCardText('a'.repeat(300))).toHaveLength(140);
    expect(giftCardText(null)).toBe('');
  });
  it('conta emoji como um caractere e não parte o par', () => {
    const text = giftCardText('💜'.repeat(200));
    expect([...text]).toHaveLength(140);
    expect(text).not.toContain('�');
  });
  it('mantém marcação como texto (quem exibe é o React, que escapa)', () => {
    expect(giftCardText('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('textos de apoio', () => {
  it('nomeia o autor sem mostrar o identificador do usuário', () => {
    expect(actorLabel('admin:00000000-0000-4000-8000-0000000000aa')).toBe('Painel');
    expect(actorLabel('webhook')).toBe('Mercado Pago');
    expect(actorLabel('cron')).toBe('Sistema (prazo)');
  });
  it('cancelar pedido pago cita valor e número do pagamento para o estorno manual', () => {
    const text = plain(
      cancelConfirmText(order({ paidAt: '2026-11-11T10:00:00.000Z', paymentId: '1234567890' })),
    );
    expect(text).toContain('estorne R$ 88,00 do pagamento 1234567890 no Mercado Pago');
    expect(cancelConfirmText(order({ paidAt: '2026-11-11T10:00:00.000Z' }))).toContain(
      'do pagamento deste pedido',
    );
    expect(cancelConfirmText(order())).not.toMatch(/estorn/);
  });
  it('resume endereço e frete', () => {
    expect(addressLines(order().address)).toEqual([
      'Rua A, 10 · Apto 2',
      'Centro · Aracaju - SE',
      'CEP 49000-000',
    ]);
    expect(plain(shippingSummary(order().shipping))).toBe(
      'Rodonaves · R$ 40,00 · 5 a 9 dias úteis',
    );
    expect(
      shippingSummary({ cents: null, label: null, carrier: null, daysMin: null, daysMax: null }),
    ).toBe('A combinar');
  });
});
