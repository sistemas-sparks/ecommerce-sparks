import { checkoutInputSchema, itemsSignature, shippingSignature } from '@sparks/shared';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_FORM,
  buildCheckoutRequest,
  checkoutBlock,
  errorNeedsBag,
  firstInvalidField,
  isMercadoPagoUrl,
  maskWhatsapp,
  parseCheckoutResponse,
  resolveCheckoutSession,
  safeOrderUrl,
  validateForm,
  type BlockInput,
  type FormValues,
} from './checkout-logic';

const PRODUCT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SERVICE = 'own:33333333-3333-4333-8333-333333333333';
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'; // 43 caracteres, como o da API
const ORDER_URL = `https://sparks.example/pedido/${TOKEN}/`;

const filled: FormValues = {
  ...EMPTY_FORM,
  name: 'Maria da Silva',
  whatsapp: '(79) 99999-8888',
  street: 'Rua das Flores',
  number: '120',
  district: 'Centro',
  city: 'Aracaju',
  uf: 'SE',
};

const options = {
  mode: 'options' as const,
  service: SERVICE,
  carrier: null,
  label: 'Entrega local',
  priceCents: 1200,
  daysMin: 1,
  daysMax: 2,
};

describe('maskWhatsapp', () => {
  it('aplica a máscara com 11 e com 10 dígitos', () => {
    expect(maskWhatsapp('79999998888')).toBe('(79) 99999-8888');
    expect(maskWhatsapp('7933334444')).toBe('(79) 3333-4444');
  });
  it('aceita texto parcial, letras e +55 colado', () => {
    expect(maskWhatsapp('7')).toBe('7');
    expect(maskWhatsapp('799')).toBe('(79) 9');
    expect(maskWhatsapp('+55 (79) 99999-8888')).toBe('(79) 99999-8888');
    expect(maskWhatsapp('abc')).toBe('');
  });
});

describe('validateForm', () => {
  it('aceita o formulário completo e devolve os dados limpos', () => {
    const result = validateForm(filled, '49000000', 'urban');
    expect(result).toEqual({
      ok: true,
      customer: { name: 'Maria da Silva', whatsapp: '79999998888' },
      address: {
        cep: '49000000',
        street: 'Rua das Flores',
        number: '120',
        district: 'Centro',
        city: 'Aracaju',
        uf: 'SE',
        addressType: 'urban',
      },
    });
  });

  it('e-mail, complemento e referência são opcionais, mas valem quando preenchidos', () => {
    const result = validateForm(
      {
        ...filled,
        email: ' MARIA@Exemplo.com ',
        complement: 'Casa 2',
        reference: 'Perto da praça',
      },
      '49000000',
      'rural',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.customer.email).toBe('maria@exemplo.com');
    expect(result.address).toMatchObject({
      complement: 'Casa 2',
      reference: 'Perto da praça',
      addressType: 'rural',
    });
  });

  it('devolve uma mensagem em português por campo inválido', () => {
    const result = validateForm(
      { ...filled, name: 'M', whatsapp: '123', email: 'sem-arroba', street: '', uf: '' },
      '49000000',
      'urban',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      ['email', 'name', 'street', 'uf', 'whatsapp'].sort(),
    );
    expect(result.errors.whatsapp).toBe('WhatsApp inválido. Use DDD + número.');
    expect(result.errors.email).toBe('E-mail inválido.');
    expect(firstInvalidField(result.errors)).toBe('name');
  });

  it('CEP inválido da sessão aparece como erro de CEP', () => {
    const result = validateForm(filled, '', 'urban');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.cep).toBeTruthy();
  });
});

describe('buildCheckoutRequest', () => {
  const address = {
    cep: '49000000',
    street: 'Rua das Flores',
    number: '120',
    district: 'Centro',
    city: 'Aracaju',
    uf: 'SE',
    addressType: 'urban' as const,
  };
  const customer = { name: 'Maria da Silva', whatsapp: '79999998888' };
  const draft = [
    { productId: PRODUCT, qty: 2 },
    { productId: OTHER, qty: 1 },
  ];

  it('envia o corpo que a API aceita, com a opção de frete e o preço mostrado', () => {
    const body = buildCheckoutRequest({
      draft,
      session: { couponCode: 'SPARKS10', giftWrap: null, shipping: options },
      couponCode: 'SPARKS10',
      customer,
      address,
      turnstileToken: 'token-turnstile',
    });
    expect(body.shippingService).toBe(SERVICE);
    expect(body.shippingQuotedCents).toBe(1200);
    expect(body.couponCode).toBe('SPARKS10');
    expect(body.items).toEqual(draft);
    expect(checkoutInputSchema.safeParse(body).success).toBe(true);
  });

  it('não envia preço de produto, desconto nem total (R3.3)', () => {
    const body = buildCheckoutRequest({
      draft,
      session: { couponCode: null, giftWrap: null, shipping: options },
      couponCode: null,
      customer,
      address,
      turnstileToken: 't',
    });
    expect(Object.keys(body).sort()).toEqual(
      [
        'address',
        'customer',
        'items',
        'shippingQuotedCents',
        'shippingService',
        'turnstileToken',
      ].sort(),
    );
    for (const item of body.items) expect(Object.keys(item).sort()).toEqual(['productId', 'qty']);
  });

  it('frete a combinar não leva opção de frete, e o schema aceita', () => {
    const body = buildCheckoutRequest({
      draft,
      session: {
        couponCode: null,
        giftWrap: null,
        shipping: { mode: 'consult', message: 'Frete a combinar com a loja.' },
      },
      couponCode: null,
      customer,
      address: { ...address, addressType: 'rural' },
      turnstileToken: 't',
    });
    expect('shippingService' in body).toBe(false);
    expect('shippingQuotedCents' in body).toBe(false);
    expect(checkoutInputSchema.safeParse(body).success).toBe(true);
  });

  it('inclui a embalagem de presente com a mensagem', () => {
    const body = buildCheckoutRequest({
      draft,
      session: {
        couponCode: null,
        giftWrap: { productId: OTHER, message: 'Feliz aniversário!' },
        shipping: options,
      },
      couponCode: null,
      customer,
      address,
      turnstileToken: 't',
    });
    expect(body.giftWrap).toEqual({ productId: OTHER, message: 'Feliz aniversário!' });
    expect(checkoutInputSchema.safeParse(body).success).toBe(true);
  });
});

describe('isMercadoPagoUrl', () => {
  it('aceita HTTPS do Mercado Pago', () => {
    expect(isMercadoPagoUrl('https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=1')).toBe(
      true,
    );
    expect(isMercadoPagoUrl('https://sandbox.mercadopago.com.br/checkout/v1/redirect')).toBe(true);
    expect(isMercadoPagoUrl('https://mercadopago.com/x')).toBe(true);
  });
  it('recusa HTTP, outros domínios, domínios parecidos e credenciais', () => {
    expect(isMercadoPagoUrl('http://www.mercadopago.com.br/x')).toBe(false);
    expect(isMercadoPagoUrl('https://evil.example/mercadopago.com.br')).toBe(false);
    expect(isMercadoPagoUrl('https://mercadopago.com.br.evil.example/')).toBe(false);
    expect(isMercadoPagoUrl('https://notmercadopago.com.br/')).toBe(false);
    expect(isMercadoPagoUrl('https://user:pass@www.mercadopago.com.br/')).toBe(false);
    expect(isMercadoPagoUrl('javascript:alert(1)')).toBe(false);
    expect(isMercadoPagoUrl('não é url')).toBe(false);
  });
});

describe('safeOrderUrl', () => {
  it('aceita só o caminho /pedido/<token>/', () => {
    expect(safeOrderUrl(ORDER_URL)).toBe(ORDER_URL);
    expect(safeOrderUrl(`https://sparks.example/outra/${TOKEN}/`)).toBeNull();
    expect(safeOrderUrl('https://sparks.example/pedido/curto/')).toBeNull();
    expect(safeOrderUrl('javascript:alert(1)')).toBeNull();
    expect(safeOrderUrl(undefined)).toBeNull();
  });
});

describe('parseCheckoutResponse', () => {
  const checkoutUrl = 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=abc';

  it('pedido aguardando pagamento leva ao Mercado Pago', () => {
    expect(
      parseCheckoutResponse({
        code: 'SPK4X7QA',
        token: TOKEN,
        status: 'awaiting_payment',
        totalCents: 5990,
        orderUrl: ORDER_URL,
        checkoutUrl,
      }),
    ).toEqual({ kind: 'payment', code: 'SPK4X7QA', orderUrl: ORDER_URL, checkoutUrl });
  });

  it('pedido aguardando frete não tem link de pagamento e mostra a mensagem do servidor', () => {
    expect(
      parseCheckoutResponse({
        code: 'SPK4X7QA',
        token: TOKEN,
        status: 'awaiting_shipping_quote',
        totalCents: 4000,
        orderUrl: ORDER_URL,
        message: 'Recebemos seu pedido. A loja vai confirmar o frete.',
      }),
    ).toEqual({
      kind: 'awaiting_quote',
      code: 'SPK4X7QA',
      orderUrl: ORDER_URL,
      totalCents: 4000,
      message: 'Recebemos seu pedido. A loja vai confirmar o frete.',
    });
  });

  it('recusa respostas fora do formato e links de pagamento suspeitos', () => {
    expect(parseCheckoutResponse(null)).toBeNull();
    expect(parseCheckoutResponse('ok')).toBeNull();
    expect(parseCheckoutResponse({ code: 'X', status: 'awaiting_payment' })).toBeNull();
    expect(
      parseCheckoutResponse({
        code: 'X',
        status: 'awaiting_payment',
        checkoutUrl: 'https://evil.example/pagar',
      }),
    ).toBeNull();
    expect(
      parseCheckoutResponse({ code: 'X', status: 'awaiting_shipping_quote', totalCents: 1.5 }),
    ).toBeNull();
    expect(parseCheckoutResponse({ code: 'X', status: 'paid', totalCents: 100 })).toBeNull();
  });
});

describe('checkoutBlock', () => {
  const ok: BlockInput = {
    draft: [{ productId: PRODUCT, qty: 1 }],
    pricesLoading: false,
    pricesError: false,
    hasLineProblem: false,
    gift: { wanted: false, status: 'loading', modelFound: false },
    shippingReady: true,
  };
  it('libera quando está tudo certo', () => {
    expect(checkoutBlock(ok)).toBeNull();
  });
  it('bloqueia na ordem: vazia, preço, estoque, embalagem e frete', () => {
    expect(checkoutBlock({ ...ok, draft: [] })).toBe('empty');
    expect(checkoutBlock({ ...ok, pricesError: true, pricesLoading: true })).toBe('prices-error');
    expect(checkoutBlock({ ...ok, pricesLoading: true })).toBe('prices-loading');
    expect(checkoutBlock({ ...ok, hasLineProblem: true })).toBe('stock');
    expect(
      checkoutBlock({ ...ok, gift: { wanted: true, status: 'loading', modelFound: false } }),
    ).toBe('gift-loading');
    expect(
      checkoutBlock({ ...ok, gift: { wanted: true, status: 'error', modelFound: false } }),
    ).toBe('gift-error');
    expect(checkoutBlock({ ...ok, gift: { wanted: true, status: 'ok', modelFound: false } })).toBe(
      'gift-missing',
    );
    expect(checkoutBlock({ ...ok, gift: { wanted: true, status: 'ok', modelFound: true } })).toBe(
      null,
    );
    expect(checkoutBlock({ ...ok, shippingReady: false })).toBe('shipping');
  });
});

describe('resolveCheckoutSession', () => {
  const draft = [{ productId: PRODUCT, qty: 1 }];
  const session = {
    cep: '49000000',
    addressType: 'urban' as const,
    couponCode: null,
    giftWrap: null,
    shipping: options,
  };
  const sigFor = (cep: string) =>
    shippingSignature({
      itemsSig: itemsSignature(draft),
      couponCode: null,
      giftWrapProductId: null,
      cep,
      addressType: 'urban',
    });

  it('mantém o frete cotado para esta sacola e este CEP', () => {
    const result = resolveCheckoutSession({
      draft,
      session,
      appliedCoupon: null,
      quoteSig: sigFor('49000000'),
    });
    expect(result.shipping).toEqual(options);
    expect(result.cepOk).toBe(true);
  });

  it('descarta o frete se o CEP, a sacola ou o tipo mudaram depois da cotação', () => {
    expect(
      resolveCheckoutSession({ draft, session, appliedCoupon: null, quoteSig: sigFor('49000111') })
        .shipping,
    ).toBeNull();
    expect(
      resolveCheckoutSession({
        draft: [{ productId: PRODUCT, qty: 2 }],
        session,
        appliedCoupon: null,
        quoteSig: sigFor('49000000'),
      }).shipping,
    ).toBeNull();
    expect(
      resolveCheckoutSession({ draft, session, appliedCoupon: null, quoteSig: '' }).shipping,
    ).toBeNull();
  });

  it('sem CEP completo não há frete válido', () => {
    const result = resolveCheckoutSession({
      draft,
      session: { ...session, cep: '' },
      appliedCoupon: null,
      quoteSig: sigFor(''),
    });
    expect(result.cepOk).toBe(false);
    expect(result.shipping).toBeNull();
  });

  it('cupom só vale para a sacola em que foi validado', () => {
    const applied = { code: 'SPARKS10', discountCents: 500, itemsSig: itemsSignature(draft) };
    const withCoupon = { ...session, couponCode: 'SPARKS10' };
    expect(
      resolveCheckoutSession({ draft, session: withCoupon, appliedCoupon: applied, quoteSig: '' })
        .coupon,
    ).toEqual(applied);
    expect(
      resolveCheckoutSession({
        draft: [{ productId: PRODUCT, qty: 3 }],
        session: withCoupon,
        appliedCoupon: applied,
        quoteSig: '',
      }).coupon,
    ).toBeNull();
  });
});

describe('errorNeedsBag', () => {
  it('erros de estoque, cupom e frete pedem para voltar à sacola', () => {
    for (const code of ['out_of_stock', 'shipping_changed', 'coupon_invalid', 'totals_changed']) {
      expect(errorNeedsBag(code)).toBe(true);
    }
    for (const code of ['invalid_input', 'too_many_pending', 'payment_unavailable', 'network']) {
      expect(errorNeedsBag(code)).toBe(false);
    }
  });
});
