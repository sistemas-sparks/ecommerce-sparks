// Regras puras da página de checkout (T-030): validação do formulário, corpo do POST /checkout,
// leitura da resposta e bloqueios. Sem React e sem rede, para testar com Vitest.
// Nada daqui define preço, frete ou total: o servidor recalcula tudo (R3.3). Os valores que o
// navegador mostra vêm da cotação e dos preços que a própria API entregou.
import {
  activeCoupon,
  addressSchema,
  customerSchema,
  isShippingCurrent,
  itemsSignature,
  shippingSignature,
  type AppliedCouponLike,
  type CartItemInput,
  type CartSession,
} from '@sparks/shared';

export type AddressType = CartSession['addressType'];

export const ADDRESS_TYPE_LABELS: Record<AddressType, string> = {
  urban: 'Urbano',
  rural: 'Rural',
  hard_access: 'Difícil acesso',
};

// ---- Formulário ----

export interface FormValues {
  name: string;
  whatsapp: string;
  email: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  uf: string;
  reference: string;
}
export type FieldName = keyof FormValues;
export type FieldErrors = Partial<Record<FieldName | 'cep', string>>;

export const EMPTY_FORM: FormValues = {
  name: '',
  whatsapp: '',
  email: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  uf: '',
  reference: '',
};

/** Ordem dos campos na tela: o foco vai para o primeiro com erro. */
export const FIELD_ORDER: readonly (FieldName | 'cep')[] = [
  'name',
  'whatsapp',
  'email',
  'cep',
  'street',
  'number',
  'complement',
  'district',
  'city',
  'uf',
  'reference',
];

/** "79999998888" -> "(79) 99999-8888"; aceita texto parcial e o "+55" colado. */
export function maskWhatsapp(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (digits.length <= 2) return digits;
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  const cut = digits.length > 10 ? 5 : 4;
  if (rest.length <= cut) return `(${ddd}) ${rest}`;
  return `(${ddd}) ${rest.slice(0, cut)}-${rest.slice(cut)}`;
}

const FIELD_NAMES = new Set<string>([...FIELD_ORDER]);

function emptyToUndefined(value: string): string | undefined {
  return value.trim() === '' ? undefined : value;
}

export type ValidationResult =
  | {
      ok: true;
      customer: { name: string; whatsapp: string; email?: string };
      address: AddressPayload;
    }
  | { ok: false; errors: FieldErrors };

export interface AddressPayload {
  cep: string;
  street: string;
  number: string;
  complement?: string;
  district: string;
  city: string;
  uf: string;
  reference?: string;
  addressType: AddressType;
}

/** Valida com os mesmos schemas da API (packages/shared); as mensagens já vêm em português. */
export function validateForm(
  values: FormValues,
  cep: string,
  addressType: AddressType,
): ValidationResult {
  const customer = customerSchema.safeParse({
    name: values.name,
    whatsapp: values.whatsapp,
    email: values.email,
  });
  const address = addressSchema.safeParse({
    cep,
    street: values.street,
    number: values.number,
    complement: emptyToUndefined(values.complement),
    district: values.district,
    city: values.city,
    uf: values.uf,
    reference: emptyToUndefined(values.reference),
    addressType,
  });
  if (customer.success && address.success) {
    const { email, ...rest } = customer.data;
    return {
      ok: true,
      customer: { ...rest, ...(email ? { email } : {}) },
      address: address.data,
    };
  }
  const errors: FieldErrors = {};
  const issues = [
    ...(customer.success ? [] : customer.error.issues),
    ...(address.success ? [] : address.error.issues),
  ];
  for (const issue of issues) {
    const field = String(issue.path[0] ?? '');
    if (FIELD_NAMES.has(field) && !errors[field as FieldName | 'cep']) {
      errors[field as FieldName | 'cep'] = issue.message;
    }
  }
  return { ok: false, errors };
}

export function firstInvalidField(errors: FieldErrors): FieldName | 'cep' | null {
  return FIELD_ORDER.find((field) => errors[field]) ?? null;
}

// ---- Corpo do POST /checkout ----

export interface CheckoutRequestInput {
  draft: readonly CartItemInput[];
  session: Pick<CartSession, 'couponCode' | 'giftWrap' | 'shipping'>;
  /** Cupom que ainda vale para esta sacola (null = não enviar). */
  couponCode: string | null;
  customer: { name: string; whatsapp: string; email?: string };
  address: AddressPayload;
  turnstileToken: string;
}

/**
 * O navegador manda só IDs, quantidades, dados de entrega, cupom, embalagem e a opção de frete
 * escolhida. `shippingQuotedCents` é o preço que a cliente viu: serve só para o servidor comparar
 * com o recálculo e recusar se mudou (R3.3). Pedido com frete "a combinar" não leva opção.
 */
export function buildCheckoutRequest(input: CheckoutRequestInput) {
  const { session } = input;
  return {
    items: input.draft.map((item) => ({ productId: item.productId, qty: item.qty })),
    customer: input.customer,
    address: input.address,
    ...(session.shipping?.mode === 'options'
      ? {
          shippingService: session.shipping.service,
          shippingQuotedCents: session.shipping.priceCents,
        }
      : {}),
    ...(input.couponCode ? { couponCode: input.couponCode } : {}),
    ...(session.giftWrap
      ? {
          giftWrap: {
            productId: session.giftWrap.productId,
            message: session.giftWrap.message,
          },
        }
      : {}),
    turnstileToken: input.turnstileToken,
  };
}

// ---- Resposta do POST /checkout ----

export const AWAITING_QUOTE_MESSAGE =
  'Recebemos seu pedido. A loja vai confirmar o frete pelo WhatsApp antes de qualquer cobrança.';

export const UNEXPECTED_RESPONSE_MESSAGE =
  'Não conseguimos confirmar se o pedido foi criado. Antes de tentar de novo, fale com a loja.';

export type CheckoutOutcome =
  | { kind: 'payment'; code: string; orderUrl: string | null; checkoutUrl: string }
  | {
      kind: 'awaiting_quote';
      code: string;
      orderUrl: string | null;
      totalCents: number;
      message: string;
    };

const MP_HOSTS = ['mercadopago.com', 'mercadopago.com.br'];

/** Só abre o pagamento em HTTPS e em domínio do Mercado Pago (evita redirecionamento aberto). */
export function isMercadoPagoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return MP_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/** Link da página do pedido: só http(s) e caminho /pedido/<código secreto>/. */
export function safeOrderUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return /^\/pedido\/[A-Za-z0-9_-]{43}\/$/.test(url.pathname) ? url.href : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Lê a resposta do servidor sem confiar no formato. null = resposta inesperada. */
export function parseCheckoutResponse(body: unknown): CheckoutOutcome | null {
  if (!isRecord(body)) return null;
  const { code, status, totalCents, message, checkoutUrl } = body;
  if (typeof code !== 'string' || code === '') return null;
  const orderUrl = safeOrderUrl(body.orderUrl);
  if (status === 'awaiting_shipping_quote') {
    if (typeof totalCents !== 'number' || !Number.isInteger(totalCents) || totalCents < 0) {
      return null;
    }
    return {
      kind: 'awaiting_quote',
      code,
      orderUrl,
      totalCents,
      message: typeof message === 'string' && message !== '' ? message : AWAITING_QUOTE_MESSAGE,
    };
  }
  if (status === 'awaiting_payment' && typeof checkoutUrl === 'string') {
    return isMercadoPagoUrl(checkoutUrl) ? { kind: 'payment', code, orderUrl, checkoutUrl } : null;
  }
  return null;
}

/** Erros que pedem para voltar à sacola (carrinho, cupom ou frete mudou). */
const BAG_ERROR_CODES = new Set([
  'product_unavailable',
  'out_of_stock',
  'gift_wrap_unavailable',
  'coupon_invalid',
  'coupon_min_order',
  'invalid_cep',
  'shipping_blocked',
  'shipping_service_required',
  'shipping_changed',
  'totals_changed',
]);
export function errorNeedsBag(code: string): boolean {
  return BAG_ERROR_CODES.has(code);
}

// ---- Bloqueios ----

export type CheckoutBlock =
  | 'empty'
  | 'prices-loading'
  | 'prices-error'
  | 'stock'
  | 'gift-loading'
  | 'gift-error'
  | 'gift-missing'
  | 'shipping';

export interface BlockInput {
  draft: readonly CartItemInput[];
  pricesLoading: boolean;
  pricesError: boolean;
  hasLineProblem: boolean;
  gift: { wanted: boolean; status: 'loading' | 'error' | 'ok'; modelFound: boolean };
  shippingReady: boolean;
}

export function checkoutBlock(input: BlockInput): CheckoutBlock | null {
  if (input.draft.length === 0) return 'empty';
  if (input.pricesError) return 'prices-error';
  if (input.pricesLoading) return 'prices-loading';
  if (input.hasLineProblem) return 'stock';
  if (input.gift.wanted) {
    if (input.gift.status === 'loading') return 'gift-loading';
    if (input.gift.status === 'error') return 'gift-error';
    if (!input.gift.modelFound) return 'gift-missing';
  }
  if (!input.shippingReady) return 'shipping';
  return null;
}

// ---- Frete e cupom ainda válidos ----

export interface ResolveInput {
  draft: readonly CartItemInput[];
  session: CartSession;
  appliedCoupon: (AppliedCouponLike & { discarded?: boolean }) | null;
  quoteSig: string;
}

/**
 * Mesma regra da sacola: o frete e o cupom guardados só valem se foram calculados para a sacola,
 * o CEP e o tipo de endereço de agora. Se algo mudou, a cliente volta à sacola para recalcular.
 */
export function resolveCheckoutSession(input: ResolveInput) {
  const { draft, session } = input;
  const itemsSig = itemsSignature(draft);
  const coupon = activeCoupon(input.appliedCoupon, itemsSig, session.couponCode);
  const fullSig = shippingSignature({
    itemsSig,
    couponCode: coupon?.code ?? null,
    giftWrapProductId: session.giftWrap?.productId ?? null,
    cep: session.cep,
    addressType: session.addressType,
  });
  const cepOk = /^\d{8}$/.test(session.cep);
  const shipping =
    cepOk && session.shipping && isShippingCurrent(input.quoteSig, fullSig)
      ? session.shipping
      : null;
  return { coupon, shipping, cepOk };
}
