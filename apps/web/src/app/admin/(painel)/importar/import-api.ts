// Chamadas da importação de produtos. Fora do apiFetch porque o corpo é CSV (não JSON)
// e o 422 traz o relatório por linha, que o apiFetch descartaria.
import { apiErrorSchema, type ProductCsvError, type ProductCsvReport } from '@sparks/shared';
import { ApiError } from '@/lib/api';
import { publicConfig } from '@/lib/public-config';

export interface ImportSummary {
  created: number;
  updated: number;
  /** Já existiam e estavam iguais ao arquivo: nada foi gravado. */
  unchanged: number;
}

export type ImportResult =
  | { kind: 'valid'; report: ProductCsvReport }
  | { kind: 'imported'; report: ProductCsvReport; summary: ImportSummary }
  | { kind: 'invalid'; report: ProductCsvReport };

const NETWORK_MESSAGE = 'Sem conexão com a loja. Confira a internet e tente de novo.';
const TIMEOUT_MESSAGE = 'A loja demorou demais para responder. Tente de novo em instantes.';
const BAD_REPLY_MESSAGE = 'A loja respondeu de um jeito inesperado. Tente de novo em instantes.';
const REQUEST_TIMEOUT_MS = 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

function parseError(value: unknown): ProductCsvError | null {
  if (!isRecord(value)) return null;
  const { line, column, message } = value;
  if (!isCount(line) || typeof message !== 'string') return null;
  if (column !== null && typeof column !== 'string') return null;
  return { line, column, message };
}

export function parseReport(value: unknown): ProductCsvReport | null {
  if (!isRecord(value) || !Array.isArray(value.errors)) return null;
  const { ok, totalRows, validRows, truncated } = value;
  if (typeof ok !== 'boolean' || typeof truncated !== 'boolean') return null;
  if (!isCount(totalRows) || !isCount(validRows)) return null;
  const errors = value.errors.map(parseError);
  if (errors.some((error) => error === null)) return null;
  return { ok, totalRows, validRows, truncated, errors: errors as ProductCsvError[] };
}

function parseSummary(value: unknown): ImportSummary | null {
  if (!isRecord(value)) return null;
  const { created, updated, unchanged } = value;
  return isCount(created) && isCount(updated) && isCount(unchanged)
    ? { created, updated, unchanged }
    : null;
}

async function request(path: string, init: RequestInit, token: string): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  try {
    return await fetch(`${publicConfig.apiUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    throw new ApiError(
      0,
      timedOut ? 'timeout' : 'network',
      timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE,
    );
  }
}

async function toApiError(res: Response, body: unknown): Promise<ApiError> {
  const parsed = apiErrorSchema.safeParse(body);
  const error = parsed.success ? parsed.data.error : null;
  return new ApiError(
    res.status,
    error?.code ?? 'unknown',
    error?.message ?? 'Algo deu errado. Tente de novo em instantes.',
  );
}

/** Envia o CSV. Com `dryRun`, só confere o arquivo e não grava nada. */
export async function sendProductCsv(
  file: Blob,
  token: string,
  { dryRun }: { dryRun: boolean },
): Promise<ImportResult> {
  const res = await request(
    `/admin/import/products${dryRun ? '?dry_run=true' : ''}`,
    { method: 'POST', headers: { 'Content-Type': 'text/csv; charset=utf-8' }, body: file },
    token,
  );
  const body: unknown = await res.json().catch(() => null);

  if (res.status === 422 && isRecord(body) && 'report' in body) {
    const report = parseReport(body.report);
    if (report) return { kind: 'invalid', report };
  }
  if (!res.ok) throw await toApiError(res, body);

  const report = isRecord(body) ? parseReport(body.report) : null;
  if (!isRecord(body) || !report) throw new ApiError(res.status, 'bad_reply', BAD_REPLY_MESSAGE);
  if (body.dryRun === true) return { kind: 'valid', report };
  const summary = parseSummary(body.summary);
  if (!summary) throw new ApiError(res.status, 'bad_reply', BAD_REPLY_MESSAGE);
  return { kind: 'imported', report, summary };
}

/** Baixa o arquivo-modelo (precisa do login, por isso passa pelo fetch e não por um link). */
export async function fetchProductCsvTemplate(token: string): Promise<Blob> {
  const res = await request('/admin/import/products/template', { method: 'GET' }, token);
  if (!res.ok) throw await toApiError(res, await res.json().catch(() => null));
  return res.blob();
}
