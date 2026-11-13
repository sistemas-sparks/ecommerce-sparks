'use client';

// Relatório de lucro simples (T-020). O período fica no endereço (/admin/relatorios/?from=&to=&groupBy=),
// então o botão Voltar e o link guardado mostram o mesmo relatório. Todo cálculo vem pronto da API;
// aqui só se formata e se exporta o CSV.
import {
  formatBRL,
  formatMargin,
  formatSignedBRL,
  PROFIT_FORMULA,
  profitReportToCsv,
  type ProfitReport,
} from '@sparks/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api';
import { Button } from '@/ui';
import { useAdmin } from '../../_lib/admin-context';
import {
  CHART,
  PRESET_LABELS,
  bucketLabel,
  chartBars,
  csvFileName,
  filtersFromParams,
  filtersQuery,
  formatDay,
  noMarginText,
  presetRange,
  rowsWithSales,
  validateFilters,
  type Preset,
  type ReportFilters,
} from './logic';
import { fetchProfitReport } from './report-api';
import './relatorios.css';

function saveCsv(report: ProfitReport) {
  const blob = new Blob([profitReportToCsv(report)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = csvFileName(report);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const money = (cents: number) => formatSignedBRL(cents);

function FilterForm({
  filters,
  onApply,
}: {
  filters: ReportFilters;
  onApply: (f: ReportFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const problem = validateFilters(draft);
  const set = (patch: Partial<ReportFilters>) => setDraft((d) => ({ ...d, ...patch }));
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!problem) onApply(draft);
  }
  return (
    <form className="rep-filters" onSubmit={submit} aria-label="Período do relatório">
      <label className="rep-field">
        De
        <input type="date" value={draft.from} onChange={(e) => set({ from: e.target.value })} />
      </label>
      <label className="rep-field">
        Até
        <input type="date" value={draft.to} onChange={(e) => set({ to: e.target.value })} />
      </label>
      <label className="rep-field">
        Agrupar por
        <select
          value={draft.groupBy}
          onChange={(e) => set({ groupBy: e.target.value === 'month' ? 'month' : 'day' })}
        >
          <option value="day">Dia</option>
          <option value="month">Mês</option>
        </select>
      </label>
      <div className="rep-actions">
        <Button type="submit" disabled={problem !== null}>
          Ver relatório
        </Button>
      </div>
      <p className="rep-presets">
        {(Object.keys(PRESET_LABELS) as Preset[]).map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => {
              const next = { ...draft, ...presetRange(preset) };
              setDraft(next);
              onApply(next);
            }}
          >
            {PRESET_LABELS[preset]}
          </button>
        ))}
      </p>
      {problem && (
        <p role="alert" className="rep-error rep-filters-error">
          {problem}
        </p>
      )}
    </form>
  );
}

function Chart({ report }: { report: ProfitReport }) {
  const bars = chartBars(report.series);
  if (report.series.length < 2 || bars.length === 0) return null;
  const unit = report.period.groupBy === 'day' ? 'dia' : 'mês';
  return (
    <figure className="rep-chart">
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Lucro por ${unit}, de ${formatDay(report.period.from)} a ${formatDay(report.period.to)}. Os valores estão na tabela abaixo.`}
      >
        <line
          x1="0"
          x2={CHART.width}
          y1={CHART.baseline}
          y2={CHART.baseline}
          className="rep-chart-base"
        />
        {bars.map((b) => (
          <rect
            key={b.key}
            x={b.x}
            y={b.y}
            width={b.width}
            height={b.height}
            className={b.negative ? 'rep-bar-loss' : 'rep-bar'}
          />
        ))}
      </svg>
      <figcaption>
        <span>{bucketLabel(report.series[0]!.key)}</span>
        <span>Lucro por {unit}</span>
        <span>{bucketLabel(report.series[report.series.length - 1]!.key)}</span>
      </figcaption>
    </figure>
  );
}

function Totals({ report }: { report: ProfitReport }) {
  const t = report.totals;
  return (
    <>
      <section aria-labelledby="rep-result" className="rep-result">
        <h2 id="rep-result">Lucro no período</h2>
        <p className={`rep-profit${t.profitCents < 0 ? ' rep-profit-loss' : ''}`}>
          {money(t.profitCents)}
        </p>
        <p className="rep-margin">
          {t.marginPermille === null
            ? noMarginText(t)
            : `Margem de ${formatMargin(t.marginPermille)} sobre as vendas com custo informado`}
        </p>
      </section>

      <dl className="rep-sums">
        <div>
          <dt>
            Vendas de produtos ({t.orders} {t.orders === 1 ? 'pedido' : 'pedidos'})
          </dt>
          <dd>{formatBRL(t.salesCents)}</dd>
        </div>
        <div>
          <dt>Descontos de cupom</dt>
          <dd>{t.discountCents > 0 ? `-${formatBRL(t.discountCents)}` : formatBRL(0)}</dd>
        </div>
        <div>
          <dt>Custo dos produtos</dt>
          <dd>{t.costCents > 0 ? `-${formatBRL(t.costCents)}` : formatBRL(0)}</dd>
        </div>
        <div>
          <dt>Vendas sem custo informado, sem o desconto delas (fora do lucro)</dt>
          <dd>{formatBRL(t.uncosted.salesCents)}</dd>
        </div>
      </dl>

      {t.uncosted.units > 0 && (
        <p className="rep-warning" role="note">
          {t.uncosted.units}{' '}
          {t.uncosted.units === 1 ? 'unidade vendida está' : 'unidades vendidas estão'} sem custo e{' '}
          {t.uncosted.units === 1 ? 'ficou' : 'ficaram'} fora do lucro.{' '}
          <Link href="/admin/produtos/">Preencher os custos nos produtos</Link>
        </p>
      )}

      <section aria-labelledby="rep-outside" className="rep-outside">
        <h2 id="rep-outside">Recebido fora do lucro</h2>
        <dl className="rep-sums">
          <div>
            <dt>Frete cobrado dos clientes</dt>
            <dd>{formatBRL(t.shippingCents)}</dd>
          </div>
          <div>
            <dt>Embalagem de presente cobrada</dt>
            <dd>{formatBRL(t.giftWrapCents)}</dd>
          </div>
        </dl>
        <p className="rep-hint">
          O custo da etiqueta e o da embalagem não são registrados, por isso ficam de fora da conta.
        </p>
      </section>
    </>
  );
}

function PeriodTable({ report }: { report: ProfitReport }) {
  const rows = rowsWithSales(report.series);
  const label = report.period.groupBy === 'day' ? 'Dia' : 'Mês';
  return (
    <section aria-labelledby="rep-by-period" className="rep-section">
      <h2 id="rep-by-period">Por {label.toLowerCase()}</h2>
      <p className="rep-hint">{PROFIT_FORMULA}</p>
      <table className="rep-table">
        <thead>
          <tr>
            <th scope="col">{label}</th>
            <th scope="col">Pedidos</th>
            <th scope="col">Vendas</th>
            <th scope="col">Sem custo</th>
            <th scope="col">Descontos</th>
            <th scope="col">Custo</th>
            <th scope="col">Lucro</th>
            <th scope="col">Margem</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.key}>
              <th scope="row">{bucketLabel(s.key)}</th>
              <td data-label="Pedidos">{s.orders}</td>
              <td data-label="Vendas">{formatBRL(s.salesCents)}</td>
              <td data-label="Sem custo">{money(s.uncostedSalesCents)}</td>
              <td data-label="Descontos">{formatBRL(s.discountCents)}</td>
              <td data-label="Custo">{formatBRL(s.costCents)}</td>
              <td data-label="Lucro">{money(s.profitCents)}</td>
              <td data-label="Margem">{formatMargin(s.marginPermille)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ProductTable({ report }: { report: ProfitReport }) {
  return (
    <section aria-labelledby="rep-by-product" className="rep-section">
      <h2 id="rep-by-product">Por produto</h2>
      <p className="rep-hint">
        Lucro antes dos descontos de cupom, com o nome e o custo gravados em cada pedido.
      </p>
      <table className="rep-table">
        <thead>
          <tr>
            <th scope="col">Produto</th>
            <th scope="col">Qtd.</th>
            <th scope="col">Vendas</th>
            <th scope="col">Custo</th>
            <th scope="col">Lucro</th>
            <th scope="col">Margem</th>
          </tr>
        </thead>
        <tbody>
          {report.products.map((p) => (
            <tr key={p.key}>
              <th scope="row">
                {p.name}
                {p.unitsWithoutCost > 0 && (
                  <span className="rep-nocost">
                    {p.unitsWithoutCost === p.units
                      ? 'sem custo informado'
                      : `${p.unitsWithoutCost} un. sem custo`}
                  </span>
                )}
              </th>
              <td data-label="Qtd.">{p.units}</td>
              <td data-label="Vendas">{formatBRL(p.salesCents)}</td>
              <td data-label="Custo">
                {p.costCents === null ? 'sem custo' : formatBRL(p.costCents)}
              </td>
              <td data-label="Lucro">{p.profitCents === null ? '—' : money(p.profitCents)}</td>
              <td data-label="Margem">{formatMargin(p.marginPermille)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.productsTruncated && (
        <p className="rep-hint">
          A lista mostra os 500 produtos que mais venderam. Os totais acima incluem todos.
        </p>
      )}
    </section>
  );
}

export function ReportPanel() {
  const { getAccessToken } = useAdmin();
  const router = useRouter();
  const params = useSearchParams();
  const filters = filtersFromParams(params);
  const key = filtersQuery(filters);
  const invalid = validateFilters(filters);

  const [loaded, setLoaded] = useState<{ key: string; report: ProfitReport } | null>(null);
  const [failed, setFailed] = useState<{ key: string; text: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const go = useCallback(
    (next: ReportFilters) => router.push(`/admin/relatorios/${filtersQuery(next)}`),
    [router],
  );

  useEffect(() => {
    if (invalid) return;
    let active = true;
    void getAccessToken()
      .then((token) => fetchProfitReport(token, filters))
      .then((report) => {
        if (active) setLoaded({ key, report });
      })
      .catch((err) => {
        if (active) {
          setFailed({
            key,
            text: err instanceof ApiError ? err.message : 'Não foi possível carregar o relatório.',
          });
        }
      });
    return () => {
      active = false;
    };
    // `key` resume os filtros; `attempt` força nova tentativa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt, invalid, getAccessToken]);

  const report = loaded?.key === key ? loaded.report : null;
  const error = invalid ?? (failed?.key === key ? failed.text : '');

  return (
    <div className="rep-panel">
      <h1 className="rep-title">Relatório de lucro</h1>
      <FilterForm key={key} filters={filters} onApply={go} />

      {error ? (
        <div>
          <p role="alert" className="rep-error">
            {error}
          </p>
          {!invalid && (
            <Button
              onClick={() => {
                setFailed(null);
                setAttempt((n) => n + 1);
              }}
            >
              Tentar de novo
            </Button>
          )}
        </div>
      ) : !report ? (
        <p role="status">Calculando o relatório…</p>
      ) : report.totals.orders === 0 ? (
        <p>
          Nenhuma venda paga entre {formatDay(report.period.from)} e {formatDay(report.period.to)}.
          Pedidos aguardando pagamento, cancelados e devolvidos não entram.
        </p>
      ) : (
        <>
          <p className="rep-period">
            {formatDay(report.period.from)} a {formatDay(report.period.to)}
          </p>
          <Totals report={report} />
          <Chart report={report} />
          <PeriodTable report={report} />
          <ProductTable report={report} />
          <div className="rep-export">
            <Button variant="white" onClick={() => saveCsv(report)}>
              Baixar CSV
            </Button>
            <p className="rep-hint">
              Entram pedidos pagos, em separação, enviados e entregues, pela data do pagamento.
              Margem arredondada em décimos de ponto percentual.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
