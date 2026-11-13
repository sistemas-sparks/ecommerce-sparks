// Regras puras da tela de relatórios (T-020): sem React, sem rede. Dinheiro em centavos (R4.1).
import {
  profitReportQuerySchema,
  type ProfitGroup,
  type ProfitReport,
  type ProfitReportQuery,
} from '@sparks/shared';

const TIME_ZONE = 'America/Sao_Paulo';
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Hoje em Brasília, AAAA-MM-DD (a data do servidor da loja, não a do aparelho). */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return dayFormatter.format(now);
}

export type Preset = 'month' | 'last-month' | 'last-30';

export const PRESET_LABELS: Record<Preset, string> = {
  month: 'Este mês',
  'last-month': 'Mês passado',
  'last-30': 'Últimos 30 dias',
};

const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Período de cada atalho, sempre em dias de Brasília. */
export function presetRange(preset: Preset, now: Date = new Date()): { from: string; to: string } {
  const today = todayInSaoPaulo(now);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  if (preset === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  if (preset === 'last-30') {
    return { from: isoOf(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000), to: today };
  }
  const first = Date.UTC(year, month - 2, 1);
  return { from: isoOf(first), to: isoOf(Date.UTC(year, month - 1, 1) - 86_400_000) };
}

export interface ReportFilters {
  from: string;
  to: string;
  groupBy: ProfitGroup;
}

/** Filtros do endereço; o que faltar ou estiver errado cai no mês atual, por dia. */
export function filtersFromParams(
  params: { get(name: string): string | null },
  now: Date = new Date(),
): ReportFilters {
  const fallback = presetRange('month', now);
  const groupBy = params.get('groupBy') === 'month' ? 'month' : 'day';
  return {
    from: params.get('from') ?? fallback.from,
    to: params.get('to') ?? fallback.to,
    groupBy,
  };
}

export function filtersQuery(filters: ReportFilters): string {
  const params = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    groupBy: filters.groupBy,
  });
  return `?${params.toString()}`;
}

/** Confere o período antes de chamar a API (a API confere de novo). Devolve a mensagem ou null. */
export function validateFilters(filters: ReportFilters): string | null {
  const result = profitReportQuerySchema.safeParse(filters);
  return result.success ? null : (result.error.issues[0]?.message ?? 'Confira o período.');
}

export function parsedFilters(filters: ReportFilters): ProfitReportQuery | null {
  const result = profitReportQuerySchema.safeParse(filters);
  return result.success ? result.data : null;
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "2026-11-03" → "03/11"; "2026-11" → "nov/2026". */
export function bucketLabel(key: string): string {
  if (key.length === 7)
    return `${MONTHS[Number(key.slice(5, 7)) - 1] ?? key.slice(5)}/${key.slice(0, 4)}`;
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}

/** "2026-11-03" → "03/11/2026". */
export function formatDay(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export interface Bar {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  negative: boolean;
}

export const CHART = { width: 600, height: 120, baseline: 90 } as const;

/**
 * Barras do lucro por período num SVG de 600×120. A linha de base fica em y=90: o lucro positivo
 * sobe e o negativo desce. A escala é a do maior valor absoluto; sem lucro nenhum, não há barras.
 */
export function chartBars(series: ReportSeries): Bar[] {
  const max = Math.max(0, ...series.map((s) => Math.abs(s.profitCents)));
  if (max === 0 || series.length === 0) return [];
  const slot = CHART.width / series.length;
  const width = Math.max(1, slot * 0.7);
  const up = CHART.baseline - 4;
  const down = CHART.height - CHART.baseline - 4;
  return series.flatMap((s, index) => {
    if (s.profitCents === 0) return [];
    const negative = s.profitCents < 0;
    const height = Math.max(1, (Math.abs(s.profitCents) / max) * (negative ? down : up));
    return [
      {
        key: s.key,
        x: index * slot + (slot - width) / 2,
        y: negative ? CHART.baseline : CHART.baseline - height,
        width,
        height,
        negative,
      },
    ];
  });
}
type ReportSeries = ProfitReport['series'];

/** Só os períodos com pedido entram na tabela; os vazios aparecem apenas no gráfico. */
export const rowsWithSales = (series: ReportSeries) => series.filter((s) => s.orders > 0);

/**
 * Frase quando não há margem. Custo > 0 só existe se houve venda com custo informado (item com custo
 * 0 é "sem custo"); então a base ficou sem saldo por causa dos descontos desses itens.
 */
export function noMarginText(totals: Pick<ProfitReport['totals'], 'costCents'>): string {
  return totals.costCents > 0
    ? 'Sem margem: os descontos igualam ou superam as vendas com custo informado.'
    : 'Sem margem: nenhuma venda com custo informado.';
}

export function csvFileName(report: ProfitReport): string {
  return `lucro-${report.period.from}-a-${report.period.to}.csv`;
}
