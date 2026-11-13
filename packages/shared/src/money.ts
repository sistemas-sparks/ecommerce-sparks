// Dinheiro sempre em centavos inteiros (R4.1). Nenhuma função daqui usa float para valores.

export type Cents = number;

export function isCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function assertCents(value: unknown, label = 'valor'): asserts value is Cents {
  if (!isCents(value)) {
    throw new RangeError(`${label} deve ser um inteiro de centavos >= 0`);
  }
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) {
    assertCents(value);
    total += value;
  }
  assertCents(total, 'soma');
  return total;
}

/** Multiplica um preço unitário pela quantidade, conferindo os limites. */
export function multiplyCents(unitCents: Cents, qty: number): Cents {
  assertCents(unitCents, 'preço unitário');
  if (!Number.isSafeInteger(qty) || qty < 0) {
    throw new RangeError('quantidade deve ser um inteiro >= 0');
  }
  const total = unitCents * qty;
  assertCents(total, 'total do item');
  return total;
}

/**
 * Porcentagem de um valor em centavos.
 * Regra de arredondamento: SEMPRE PARA BAIXO (floor), para que um desconto nunca passe do anunciado.
 * Ex.: 10% de R$ 0,99 = 9 centavos (9,9 arredondado para baixo).
 */
export function percentOf(cents: Cents, percent: number): Cents {
  assertCents(cents);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new RangeError('porcentagem deve ser um inteiro entre 0 e 100');
  }
  const product = cents * percent;
  if (!Number.isSafeInteger(product)) {
    throw new RangeError('valor grande demais para calcular a porcentagem');
  }
  return Math.floor(product / 100);
}

const brlFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formata centavos como moeda brasileira, por exemplo 1250 → "R$ 12,50". */
export function formatBRL(cents: Cents): string {
  assertCents(cents);
  // Divisão só para exibição: o Intl recebe reais, e centavos inteiros / 100 é exato até 2 casas.
  return brlFormatter.format(cents / 100);
}

const BRL_INPUT = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/**
 * Converte texto digitado no formato brasileiro em centavos, sem passar por float.
 * Aceita "12", "12,5", "12,50", "1.234,56" e "R$ 12,50". Devolve null se o texto for inválido.
 */
export function parseBRLToCents(input: string): Cents | null {
  const text = input.replace(/^\s*R\$\s*/, '').trim();
  const match = BRL_INPUT.exec(text);
  if (!match) return null;

  const [integerPart = '', decimalPart = ''] = text.split(',');
  const reais = Number(integerPart.replaceAll('.', ''));
  const centavos = Number(decimalPart.padEnd(2, '0'));
  const total = reais * 100 + centavos;
  return isCents(total) ? total : null;
}
