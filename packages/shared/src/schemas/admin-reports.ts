// Relatório de lucro simples (T-020): entrada e resposta da API GET /admin/reports/profit.
// Dinheiro em centavos inteiros (R4.1). O lucro pode ser negativo; vendas, custos e descontos não.
import { z } from 'zod';

/**
 * Pedidos que entram no relatório: o dinheiro já entrou e o pedido não voltou.
 * Fora: aguardando frete ou pagamento (ainda não é venda), expirado, cancelado (estoque e valor
 * devolvidos) e devolvido (tratado como reembolsado). O período usa a data do pagamento
 * (`paid_at`) no horário de Brasília. Espelha a função SQL `admin_profit_report`: mude os dois juntos.
 */
export const PROFIT_REPORT_STATUSES = ['paid', 'preparing', 'shipped', 'delivered'] as const;

export const PROFIT_GROUPS = ['day', 'month'] as const;
export type ProfitGroup = (typeof PROFIT_GROUPS)[number];

/** Teto do período (um ano com bissexto): segura o custo da consulta. */
export const MAX_REPORT_DAYS = 366;

const DAY_MS = 86_400_000;
const isoDay = z
  .string({ error: 'Informe a data.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Data inválida.' })
  .refine(
    (v) => {
      const d = new Date(`${v}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
    },
    { error: 'Data inválida.' },
  );

/** Dias corridos entre duas datas ISO (AAAA-MM-DD), contando as duas pontas. */
export function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

export const profitReportQuerySchema = z
  .object({
    from: isoDay,
    to: isoDay,
    groupBy: z.enum(PROFIT_GROUPS, { error: 'Agrupe por dia ou por mês.' }).default('day'),
  })
  .refine((q) => q.to >= q.from, {
    path: ['to'],
    error: 'A data final não pode ser anterior à inicial.',
  })
  .refine((q) => inclusiveDays(q.from, q.to) <= MAX_REPORT_DAYS, {
    path: ['to'],
    error: `O período pode ter no máximo ${MAX_REPORT_DAYS} dias.`,
  });
export type ProfitReportQuery = z.infer<typeof profitReportQuerySchema>;

const cents = z.number().int().min(0);
const signedCents = z.number().int();
/** Margem em décimos de ponto percentual (123 = 12,3%); null quando não há base para calcular. */
const permille = z.number().int().nullable();

export const profitTotalsSchema = z.object({
  orders: z.number().int().min(0),
  units: z.number().int().min(0),
  /** Preço × quantidade de todos os itens, antes dos descontos. */
  salesCents: cents,
  /** Descontos de cupom dos pedidos do período. */
  discountCents: cents,
  /** salesCents − discountCents (receita de produtos). */
  netSalesCents: signedCents,
  /** Custo (snapshot do item) só dos itens que têm custo informado. */
  costCents: cents,
  /**
   * Itens sem custo informado: ficam fora do lucro e da margem. `salesCents` já desconta a parte do
   * cupom rateada a esses itens (assim vendas − sem custo − descontos − custo = lucro).
   */
  uncosted: z.object({ units: z.number().int().min(0), salesCents: signedCents }),
  /** Vendas dos itens com custo − parte do desconto desses itens − custo. */
  profitCents: signedCents,
  marginPermille: permille,
  /** Frete cobrado dos clientes: separado, fora do lucro (o custo real da etiqueta não é registrado). */
  shippingCents: cents,
  /** Embalagem de presente cobrada: separada, fora do lucro (o custo dela não é registrado). */
  giftWrapCents: cents,
});
export type ProfitTotals = z.infer<typeof profitTotalsSchema>;

export const profitSeriesRowSchema = z.object({
  /** AAAA-MM-DD (por dia) ou AAAA-MM (por mês). */
  key: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  orders: z.number().int().min(0),
  salesCents: cents,
  discountCents: cents,
  costCents: cents,
  /** Vendas dos itens sem custo, já sem a parte do desconto rateada a eles. */
  uncostedSalesCents: signedCents,
  profitCents: signedCents,
  marginPermille: permille,
});
export type ProfitSeriesRow = z.infer<typeof profitSeriesRowSchema>;

export const profitProductRowSchema = z.object({
  /** Id do produto ou, se ele foi apagado, `n:` + nome gravado no pedido. */
  key: z.string().min(1).max(200),
  /** Nome gravado no pedido mais recente (nunca o cadastro atual). */
  name: z.string().min(1).max(300),
  units: z.number().int().min(1),
  salesCents: cents,
  /** Custo das unidades com custo; null se nenhuma unidade tem custo informado. */
  costCents: cents.nullable(),
  /** Lucro antes dos descontos de cupom; null se nenhuma unidade tem custo informado. */
  profitCents: signedCents.nullable(),
  marginPermille: permille,
  unitsWithoutCost: z.number().int().min(0),
});
export type ProfitProductRow = z.infer<typeof profitProductRowSchema>;

export const profitReportSchema = z.object({
  period: z.object({ from: isoDay, to: isoDay, groupBy: z.enum(PROFIT_GROUPS) }),
  totals: profitTotalsSchema,
  series: z.array(profitSeriesRowSchema).max(MAX_REPORT_DAYS),
  products: z.array(profitProductRowSchema).max(500),
  /** Verdadeiro se havia mais produtos que o limite da lista (os totais continuam completos). */
  productsTruncated: z.boolean(),
});
export type ProfitReport = z.infer<typeof profitReportSchema>;
