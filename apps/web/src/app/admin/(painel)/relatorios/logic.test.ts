import { describe, expect, it } from 'vitest';
import {
  bucketLabel,
  chartBars,
  filtersFromParams,
  filtersQuery,
  formatDay,
  noMarginText,
  presetRange,
  rowsWithSales,
  todayInSaoPaulo,
  validateFilters,
} from './logic';

// 02h00 UTC de 01/12/2026 ainda é 23h de 30/11 em Brasília.
const NOW = new Date('2026-12-01T02:00:00Z');

describe('períodos em horário de Brasília', () => {
  it('hoje usa o dia de Brasília, não o de Greenwich', () => {
    expect(todayInSaoPaulo(NOW)).toBe('2026-11-30');
    expect(todayInSaoPaulo(new Date('2026-12-01T12:00:00Z'))).toBe('2026-12-01');
  });
  it('atalhos', () => {
    expect(presetRange('month', NOW)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(presetRange('last-month', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('last-30', NOW)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });
  it('mês passado vira o ano', () => {
    const jan = new Date('2027-01-10T15:00:00Z');
    expect(presetRange('last-month', jan)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('filtros do endereço', () => {
  const params = (q: string) => new URLSearchParams(q);
  it('sem nada: mês atual por dia', () => {
    expect(filtersFromParams(params(''), NOW)).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      groupBy: 'day',
    });
  });
  it('lê datas e agrupamento; agrupamento estranho vira dia', () => {
    expect(filtersFromParams(params('from=2026-01-01&to=2026-03-31&groupBy=month'), NOW)).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
      groupBy: 'month',
    });
    expect(filtersFromParams(params('groupBy=ano'), NOW).groupBy).toBe('day');
  });
  it('monta o endereço e valida o período', () => {
    const f = { from: '2026-11-01', to: '2026-11-30', groupBy: 'day' as const };
    expect(filtersQuery(f)).toBe('?from=2026-11-01&to=2026-11-30&groupBy=day');
    expect(validateFilters(f)).toBeNull();
    expect(validateFilters({ ...f, to: '2026-10-01' })).toMatch(/anterior/);
    expect(validateFilters({ ...f, from: '2024-01-01' })).toMatch(/366/);
    expect(validateFilters({ ...f, from: '' })).not.toBeNull();
  });
});

describe('rótulos', () => {
  it('dia, mês e data completa', () => {
    expect(bucketLabel('2026-11-03')).toBe('03/11');
    expect(bucketLabel('2026-11')).toBe('nov/2026');
    expect(formatDay('2026-11-03')).toBe('03/11/2026');
  });
});

describe('frase de margem vazia', () => {
  it('sem custo informado em nenhuma venda x descontos cobrindo as vendas com custo', () => {
    expect(noMarginText({ costCents: 0 })).toBe('Sem margem: nenhuma venda com custo informado.');
    expect(noMarginText({ costCents: 100 })).toMatch(/descontos igualam ou superam/);
  });
});

describe('gráfico de barras', () => {
  const row = (key: string, profitCents: number, orders = 1) => ({
    key,
    orders,
    salesCents: 0,
    discountCents: 0,
    costCents: 0,
    uncostedSalesCents: 0,
    profitCents,
    marginPermille: null,
  });
  it('lucro sobe e prejuízo desce da linha de base; a escala é a do maior valor', () => {
    const bars = chartBars([row('a', 1000), row('b', -500), row('c', 0, 0), row('d', 500)]);
    expect(bars.map((b) => b.key)).toEqual(['a', 'b', 'd']);
    expect(bars[0]!.height).toBeCloseTo(86);
    expect(bars[1]!.negative).toBe(true);
    expect(bars[1]!.y).toBe(90);
    expect(bars[2]!.height).toBeCloseTo(43);
    expect(bars.every((b) => b.x >= 0 && b.x + b.width <= 600)).toBe(true);
  });
  it('sem lucro nenhum não desenha barras', () => {
    expect(chartBars([row('a', 0), row('b', 0)])).toEqual([]);
    expect(chartBars([])).toEqual([]);
  });
  it('a tabela por período só mostra períodos com pedido', () => {
    expect(rowsWithSales([row('a', 0, 0), row('b', 5, 2)]).map((s) => s.key)).toEqual(['b']);
  });
});
