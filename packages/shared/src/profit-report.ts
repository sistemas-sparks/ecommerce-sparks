// Relatório de lucro simples (T-020): cálculo puro sobre as somas que o banco devolve.
// Sem rede, sem banco, sem float para dinheiro (R4.1).
//
// REGRAS (documentadas em docs/memoria.md, T-020):
// 1. Entram pedidos pagos, em separação, enviados e entregues (PROFIT_REPORT_STATUSES in schemas/admin-reports), pela data do
//    pagamento em Brasília. Não pagos, expirados, cancelados e devolvidos ficam de fora.
// 2. Vendas = preço × quantidade gravados no pedido (snapshot). Custo = custo gravado no item,
//    nunca o cadastro atual do produto.
// 3. Item com custo gravado igual a zero é tratado como "sem custo informado": o banco guarda 0 quando
//    a lojista não preenche o custo (products.cost_cents default 0), então não dá para diferenciar de
//    um custo zero de verdade. Esses itens ficam FORA do lucro e da margem (nunca viram lucro de 100%).
// 4. Desconto de cupom é do pedido, não do item: o banco o rateia, em centavos inteiros e sem perder
//    centavo (maior resto, proporcional às vendas dos itens com e sem custo de cada pedido; ver a
//    migration). Só a parte dos itens COM custo é abatida do lucro; a parte dos itens SEM custo é
//    abatida das "vendas sem custo", que ficam fora do lucro. O desconto total aparece como linha
//    própria. Identidade (total e por período): vendas − vendas sem custo (líquidas do desconto delas)
//    − descontos − custo = lucro. A tabela por produto é ANTES dos descontos.
// 5. Frete cobrado e embalagem de presente cobrada aparecem separados e não entram no lucro: o custo
//    da etiqueta e da embalagem não é registrado em lugar nenhum.
// 6. Margem = lucro ÷ vendas com custo (depois do desconto, no total e por período; antes, por
//    produto), em décimos de ponto percentual, arredondando ao mais próximo e metade para longe do
//    zero (1,25 → 1,3; −1,25 → −1,3). Sem base positiva, não há margem (null).
import { escapeCsvCell } from './csv';
import { formatBRL } from './money';
import {
  type ProfitGroup,
  type ProfitProductRow,
  type ProfitReport,
  type ProfitReportQuery,
  type ProfitSeriesRow,
  type ProfitTotals,
} from './schemas/admin-reports';

/** Somas por período, como a função SQL devolve (centavos e unidades inteiros). */
export interface ProfitRawBucket {
  bucket: string;
  orders: number;
  units: number;
  salesCents: number;
  /** Vendas dos itens com custo informado. */
  salesCostedCents: number;
  /** Custo (custo unitário × quantidade) dos itens com custo informado. */
  costCents: number;
  unitsUncosted: number;
  salesUncostedCents: number;
  /** Desconto de cupom total dos pedidos (inclui a parte rateada aos itens sem custo). */
  discountCents: number;
  /** Parte do desconto rateada aos itens sem custo (a SQL rateia em inteiros, sem perder centavo). */
  discountUncostedCents: number;
  shippingCents: number;
  giftWrapCents: number;
}

export interface ProfitRawProduct {
  key: string;
  name: string;
  units: number;
  salesCents: number;
  salesCostedCents: number;
  costCents: number;
  unitsUncosted: number;
}

export interface ProfitRaw {
  buckets: ProfitRawBucket[];
  products: ProfitRawProduct[];
  /** Quantos produtos distintos existem no período (a lista vem cortada em 500). */
  productsCount: number;
}

export const PRODUCT_LIST_LIMIT = 500;

/**
 * Fórmula que vale no total e em cada linha por período. "Sem custo" = vendas dos itens sem custo
 * informado, já sem a parte do desconto rateada a elas; "Descontos" = desconto de cupom total.
 */
export const PROFIT_FORMULA = 'Lucro = Vendas − Sem custo − Descontos − Custo';

/**
 * Margem em décimos de ponto percentual (123 = 12,3%): lucro ÷ base, arredondado ao mais próximo,
 * metade para longe do zero. Só aritmética de inteiros. Sem base positiva devolve null.
 */
export function marginPermille(profitCents: number, baseCents: number): number | null {
  if (!Number.isSafeInteger(profitCents) || !Number.isSafeInteger(baseCents)) {
    throw new RangeError('centavos devem ser inteiros');
  }
  if (baseCents <= 0) return null;
  const scaled = Math.abs(profitCents) * 1000;
  if (!Number.isSafeInteger(scaled)) throw new RangeError('valor grande demais para a margem');
  // round-half-up de scaled / base, em inteiros: floor((2·scaled + base) / (2·base)).
  const rounded = Math.floor((2 * scaled + baseCents) / (2 * baseCents));
  const value = profitCents < 0 ? -rounded : rounded;
  return value === 0 ? 0 : value; // evita -0
}

const percentFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** 123 → "12,3%". Sem margem (null) → "—". */
export function formatMargin(value: number | null): string {
  return value === null ? '—' : `${percentFormatter.format(value / 10)}%`;
}

/** Valor em reais com vírgula e sinal, sem símbolo nem separador de milhar: -1250 → "-12,50". */
export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('centavos devem ser inteiros');
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Real com sinal para lucro: negativo sai como "-R$ 12,50" (formatBRL só aceita centavos >= 0). */
export function formatSignedBRL(cents: number): string {
  return cents < 0 ? `-${formatBRL(-cents)}` : formatBRL(cents);
}

function profitOf(salesCostedCents: number, costCents: number, discountCents = 0): number {
  return salesCostedCents - costCents - discountCents;
}

function seriesRow(key: string, raw: ProfitRawBucket | undefined): ProfitSeriesRow {
  const r = raw ?? {
    orders: 0,
    salesCents: 0,
    salesCostedCents: 0,
    costCents: 0,
    salesUncostedCents: 0,
    discountCents: 0,
    discountUncostedCents: 0,
  };
  const discountCosted = r.discountCents - r.discountUncostedCents;
  const profitCents = profitOf(r.salesCostedCents, r.costCents, discountCosted);
  return {
    key,
    orders: r.orders,
    salesCents: r.salesCents,
    discountCents: r.discountCents,
    costCents: r.costCents,
    uncostedSalesCents: r.salesUncostedCents - r.discountUncostedCents,
    profitCents,
    marginPermille: marginPermille(profitCents, r.salesCostedCents - discountCosted),
  };
}

/** Todas as chaves de período entre as duas datas (inclusive), em ordem. */
export function bucketKeys(from: string, to: string, groupBy: ProfitGroup): string[] {
  const keys: string[] = [];
  if (groupBy === 'day') {
    const end = Date.parse(`${to}T00:00:00Z`);
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
      keys.push(new Date(t).toISOString().slice(0, 10));
    }
    return keys;
  }
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const last = to.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    keys.push(key);
    if (key >= last) return keys;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}

/** Monta a resposta do relatório a partir das somas do banco. */
export function buildProfitReport(query: ProfitReportQuery, raw: ProfitRaw): ProfitReport {
  const byKey = new Map(raw.buckets.map((b) => [b.bucket, b]));
  const series = bucketKeys(query.from, query.to, query.groupBy).map((key) =>
    seriesRow(key, byKey.get(key)),
  );

  // Totais: somas das somas (nunca média de margens).
  const sum = (pick: (b: ProfitRawBucket) => number) =>
    raw.buckets.reduce((acc, b) => acc + pick(b), 0);
  const salesCents = sum((b) => b.salesCents);
  const salesCostedCents = sum((b) => b.salesCostedCents);
  const costCents = sum((b) => b.costCents);
  const discountCents = sum((b) => b.discountCents);
  const discountUncostedCents = sum((b) => b.discountUncostedCents);
  const discountCosted = discountCents - discountUncostedCents;
  const profitCents = profitOf(salesCostedCents, costCents, discountCosted);
  const totals: ProfitTotals = {
    orders: sum((b) => b.orders),
    units: sum((b) => b.units),
    salesCents,
    discountCents,
    netSalesCents: salesCents - discountCents,
    costCents,
    uncosted: {
      units: sum((b) => b.unitsUncosted),
      salesCents: sum((b) => b.salesUncostedCents) - discountUncostedCents,
    },
    profitCents,
    marginPermille: marginPermille(profitCents, salesCostedCents - discountCosted),
    shippingCents: sum((b) => b.shippingCents),
    giftWrapCents: sum((b) => b.giftWrapCents),
  };

  const products: ProfitProductRow[] = raw.products.map((p) => {
    const costedUnits = p.units - p.unitsUncosted;
    const hasCost = costedUnits > 0;
    const profit = hasCost ? profitOf(p.salesCostedCents, p.costCents) : null;
    return {
      key: p.key,
      name: p.name,
      units: p.units,
      salesCents: p.salesCents,
      costCents: hasCost ? p.costCents : null,
      profitCents: profit,
      marginPermille: profit === null ? null : marginPermille(profit, p.salesCostedCents),
      unitsWithoutCost: p.unitsUncosted,
    };
  });

  return {
    period: { from: query.from, to: query.to, groupBy: query.groupBy },
    totals,
    series,
    products,
    productsTruncated: raw.productsCount > raw.products.length,
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
// Texto vira célula com escapeCsvCell: o que começa com = + - @ (ou tab/CR) ganha um apóstrofo e
// vira texto, então um nome de produto como "=HYPERLINK(...)" nunca roda como fórmula.
// Números saem de inteiros que o próprio servidor calculou (centavos e décimos), nunca de texto
// digitado; por isso um lucro negativo ("-12,50") sai como número, sem apóstrofo, e a planilha soma.

const NUMERIC_CELL = /^-?\d+(?:,\d{1,2})?$/;

/** Célula numérica: só aceita o formato que centsToDecimal/permille produzem. */
function num(text: string): string {
  if (!NUMERIC_CELL.test(text)) throw new RangeError('célula numérica inválida');
  return text;
}
const money = (cents: number) => num(centsToDecimal(cents));
const percent = (value: number | null) =>
  value === null
    ? ''
    : num(`${value < 0 ? '-' : ''}${Math.trunc(Math.abs(value) / 10)},${Math.abs(value) % 10}`);
const NO_COST = 'sem custo';
/** Marca de ordem de bytes UTF-8: o Excel só abre os acentos certos com ela. */
const BOM = String.fromCharCode(0xfeff);

/** Relatório em CSV (separador ";", como a importação), com BOM para o Excel abrir os acentos. */
export function profitReportToCsv(report: ProfitReport): string {
  const t = report.totals;
  const line = (cells: ReadonlyArray<{ text: string } | string>) =>
    cells.map((c) => (typeof c === 'string' ? c : escapeCsvCell(c.text))).join(';');
  const text = (value: string) => ({ text: value });
  const label = report.period.groupBy === 'day' ? 'Dia' : 'Mês';

  const rows: string[] = [
    line([text('Relatório de lucro')]),
    line([text('De'), text(report.period.from), text('Até'), text(report.period.to)]),
    line([
      text('Pedidos pagos, em separação, enviados e entregues; período pela data do pagamento.'),
    ]),
    '',
    line([text('Totais'), text('R$')]),
    line([text(PROFIT_FORMULA)]),
    line([text('Vendas de produtos'), money(t.salesCents)]),
    line([text('Descontos de cupom'), money(-t.discountCents)]),
    line([text('Vendas líquidas'), money(t.netSalesCents)]),
    line([text('Custo dos produtos'), money(t.costCents)]),
    line([text('Lucro'), money(t.profitCents)]),
    line([text('Margem (%)'), percent(t.marginPermille)]),
    line([
      text('Vendas sem custo informado, já sem o desconto delas (fora do lucro)'),
      money(t.uncosted.salesCents),
    ]),
    line([text('Frete cobrado (fora do lucro)'), money(t.shippingCents)]),
    line([text('Embalagem de presente cobrada (fora do lucro)'), money(t.giftWrapCents)]),
    '',
    line([
      text(label),
      text('Pedidos'),
      text('Vendas (R$)'),
      text('Sem custo (R$)'),
      text('Descontos (R$)'),
      text('Custo (R$)'),
      text('Lucro (R$)'),
      text('Margem (%)'),
    ]),
    ...report.series.map((s) =>
      line([
        text(s.key),
        String(s.orders),
        money(s.salesCents),
        money(s.uncostedSalesCents),
        money(s.discountCents),
        money(s.costCents),
        money(s.profitCents),
        percent(s.marginPermille),
      ]),
    ),
    '',
    line([
      text('Produto'),
      text('Quantidade'),
      text('Vendas (R$)'),
      text('Custo (R$)'),
      text('Lucro antes dos descontos (R$)'),
      text('Margem (%)'),
      text('Unidades sem custo'),
    ]),
    ...report.products.map((p) =>
      line([
        text(p.name),
        String(p.units),
        money(p.salesCents),
        p.costCents === null ? text(NO_COST) : money(p.costCents),
        p.profitCents === null ? text(NO_COST) : money(p.profitCents),
        percent(p.marginPermille),
        String(p.unitsWithoutCost),
      ]),
    ),
  ];
  return `${BOM}${rows.join('\r\n')}\r\n`;
}
