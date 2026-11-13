// Chamada à API do relatório de lucro. A resposta é validada com o mesmo schema da API.
import { profitReportSchema, type ProfitReport } from '@sparks/shared';
import { apiFetch } from '@/lib/api';
import { filtersQuery, type ReportFilters } from './logic';

export async function fetchProfitReport(
  token: string,
  filters: ReportFilters,
): Promise<ProfitReport> {
  return profitReportSchema.parse(
    await apiFetch(`/admin/reports/profit${filtersQuery(filters)}`, { token }),
  );
}
