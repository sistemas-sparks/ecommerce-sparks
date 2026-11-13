import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// API simulada: nenhum produto real é lido ou gravado. O fetch é falso.
const fetchMock = vi.fn<typeof fetch>();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const okReport = { ok: true, totalRows: 3, validRows: 3, errors: [], truncated: false };
const badReport = {
  ok: false,
  totalRows: 2,
  validRows: 0,
  truncated: false,
  errors: [
    { line: 2, column: 'preco', message: 'Preço inválido. Use reais com vírgula, como 12,90.' },
    { line: 3, column: null, message: 'A linha tem mais campos que o cabeçalho.' },
  ],
};
const csv = new Blob(['slug;nome;preco\nlapis;Lápis;3,00\n'], { type: 'text/csv' });

async function load() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.test/');
  const [api, { ApiError }] = await Promise.all([import('./import-api'), import('@/lib/api')]);
  return { ...api, ApiError };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('sendProductCsv (API simulada)', () => {
  it('simulação: POST com ?dry_run=true, CSV e token; devolve o relatório sem gravar', async () => {
    fetchMock.mockResolvedValue(json({ dryRun: true, report: okReport }));
    const { sendProductCsv } = await load();
    const result = await sendProductCsv(csv, 'tok', { dryRun: true });
    expect(result).toEqual({ kind: 'valid', report: okReport });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.test/admin/import/products?dry_run=true');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(csv);
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer tok');
    expect(headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
  });

  it('importação: sem dry_run, devolve criados, atualizados e ignorados', async () => {
    const summary = { created: 2, updated: 1, unchanged: 0 };
    fetchMock.mockResolvedValue(json({ dryRun: false, report: okReport, summary }));
    const { sendProductCsv } = await load();
    const result = await sendProductCsv(csv, 'tok', { dryRun: false });
    expect(result).toEqual({ kind: 'imported', report: okReport, summary });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test/admin/import/products');
  });

  it('422 com relatório: devolve os erros por linha e coluna (não lança)', async () => {
    fetchMock.mockResolvedValue(
      json(
        { error: { code: 'import_invalid', message: 'O arquivo tem erros.' }, report: badReport },
        422,
      ),
    );
    const { sendProductCsv } = await load();
    const result = await sendProductCsv(csv, 'tok', { dryRun: true });
    expect(result).toEqual({ kind: 'invalid', report: badReport });
  });

  it('413 (arquivo grande demais): lança ApiError com a mensagem da API', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          error: {
            code: 'payload_too_large',
            message: 'Arquivo grande demais. O limite é 512 KB.',
          },
        },
        413,
      ),
    );
    const { sendProductCsv, ApiError } = await load();
    const error = await sendProductCsv(csv, 'tok', { dryRun: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 413,
      message: 'Arquivo grande demais. O limite é 512 KB.',
    });
  });

  it('422 de codificação (sem relatório): lança ApiError com a orientação do Excel', async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: 'invalid_encoding', message: 'O arquivo não está em UTF-8.' } }, 422),
    );
    const { sendProductCsv } = await load();
    await expect(sendProductCsv(csv, 'tok', { dryRun: true })).rejects.toMatchObject({
      status: 422,
      code: 'invalid_encoding',
    });
  });

  it('429 e 401: repassam a mensagem em português da API', async () => {
    fetchMock.mockResolvedValue(
      json(
        { error: { code: 'rate_limited', message: 'Muitas tentativas. Aguarde um pouco.' } },
        429,
      ),
    );
    const { sendProductCsv } = await load();
    await expect(sendProductCsv(csv, 'tok', { dryRun: true })).rejects.toMatchObject({
      status: 429,
      message: 'Muitas tentativas. Aguarde um pouco.',
    });
  });

  it('falha de rede: ApiError "network" com mensagem em português', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const { sendProductCsv } = await load();
    await expect(sendProductCsv(csv, 'tok', { dryRun: true })).rejects.toMatchObject({
      status: 0,
      code: 'network',
      message: expect.stringContaining('Sem conexão'),
    });
  });

  it('resposta fora do formato esperado: erro claro, nunca tela de sucesso falsa', async () => {
    fetchMock.mockResolvedValue(json({ dryRun: false, report: okReport }));
    const { sendProductCsv } = await load();
    await expect(sendProductCsv(csv, 'tok', { dryRun: false })).rejects.toMatchObject({
      code: 'bad_reply',
    });

    fetchMock.mockResolvedValue(json({ dryRun: true, report: { ok: true } }));
    await expect(sendProductCsv(csv, 'tok', { dryRun: true })).rejects.toMatchObject({
      code: 'bad_reply',
    });
  });
});

describe('fetchProductCsvTemplate (API simulada)', () => {
  it('GET do modelo com token e devolve o arquivo', async () => {
    fetchMock.mockResolvedValue(
      new Response('slug;nome\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8' } }),
    );
    const { fetchProductCsvTemplate } = await load();
    const blob = await fetchProductCsvTemplate('tok');
    expect(await blob.text()).toBe('slug;nome\n');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.test/admin/import/products/template');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('erro da API vira ApiError', async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: 'forbidden', message: 'Sem acesso.' } }, 403),
    );
    const { fetchProductCsvTemplate } = await load();
    await expect(fetchProductCsvTemplate('tok')).rejects.toMatchObject({ status: 403 });
  });
});
