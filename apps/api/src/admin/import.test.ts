import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRODUCT_IMPORT_MAX_BYTES,
  buildProductCsvTemplate,
  type ProductCsvRow,
} from '@sparks/shared';
import { createApp } from '../app';
import { createTestKey, signToken, testEnv, USER_ID, type TestKey } from '../test-utils';
import { ProductImportRowError, type ProductImportRepo } from './import-repo';

const CATEGORY = { id: '22222222-2222-4222-8222-222222222222', slug: 'cadernos', name: 'Cadernos' };
const URL_PATH = '/admin/import/products';
const GOOD = 'slug;nome;preco;categoria;estoque\ncaderno-a;Caderno A;12,90;cadernos;7\n';
let key: TestKey;
let repo: ProductImportRepo;
let importProducts: ReturnType<typeof vi.fn<ProductImportRepo['importProducts']>>;

beforeAll(async () => {
  key = await createTestKey();
});
beforeEach(() => {
  importProducts = vi.fn<ProductImportRepo['importProducts']>(async (rows) => ({
    created: rows.length,
    updated: 0,
    unchanged: 0,
  }));
  repo = { categories: vi.fn(async () => [CATEGORY]), importProducts };
});

async function send(
  body: BodyInit | null,
  opts: {
    path?: string;
    method?: string;
    type?: string | null;
    role?: string | null;
    allow?: boolean;
  } = {},
) {
  const role = opts.role === undefined ? 'admin' : opts.role;
  const token =
    role === null ? null : await signToken(key, { app_metadata: { role }, aal: 'aal2' });
  const app = createApp({
    productImportRepo: () => repo,
    getJwks: async () => [key.publicJwk],
    rateLimitHit: async () => opts.allow ?? true,
  });
  const type = opts.type === undefined ? 'text/csv; charset=utf-8' : opts.type;
  return app.request(
    opts.path ?? URL_PATH,
    {
      method: opts.method ?? 'POST',
      headers: {
        ...(type ? { 'Content-Type': type } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== null ? { body } : {}),
    },
    testEnv,
  );
}

describe('importação de produtos por CSV (rotas)', () => {
  it('exige login com papel admin', async () => {
    for (const role of [null, 'customer', '']) {
      const response = await send(GOOD, { role });
      expect(response.status).toBe(role === null ? 401 : 403);
      expect((await send(null, { role, method: 'GET', path: `${URL_PATH}/template` })).status).toBe(
        role === null ? 401 : 403,
      );
    }
    expect(importProducts).not.toHaveBeenCalled();
    expect(repo.categories).not.toHaveBeenCalled();
  });

  it('importa, converte para centavos, resolve categoria e registra quem importou', async () => {
    const response = await send(GOOD);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      dryRun: false,
      report: { ok: true, totalRows: 1, validRows: 1, errors: [] },
      summary: { created: 1, updated: 0, unchanged: 0 },
    });
    expect(importProducts).toHaveBeenCalledTimes(1);
    const [rows, actor] = importProducts.mock.calls[0] as [ProductCsvRow[], string];
    expect(actor).toBe(USER_ID);
    expect(rows[0]).toMatchObject({
      line: 2,
      data: {
        slug: 'caderno-a',
        price_cents: 1290,
        stock: 7,
        category_id: CATEGORY.id,
        active: false,
      },
    });
  });

  it('simulação (dry_run) valida sem gravar', async () => {
    const response = await send(GOOD, { path: `${URL_PATH}?dry_run=true` });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ dryRun: true, report: { ok: true } });
    expect(importProducts).not.toHaveBeenCalled();
  });

  it('com erros devolve 422 com o relatório por linha e não grava nada', async () => {
    const csv = 'slug;nome;preco\nok;Bom;1,00\nruim;;abc\n';
    const response = await send(csv);
    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: { code: string };
      report: { ok: boolean; errors: { line: number; column: string }[] };
    };
    expect(body.error.code).toBe('import_invalid');
    expect(body.report.ok).toBe(false);
    expect(body.report.errors.map((e) => `${e.line}:${e.column}`)).toEqual(['3:nome', '3:preco']);
    expect(importProducts).not.toHaveBeenCalled();
  });

  it('bloqueia injeção de fórmula', async () => {
    const response = await send('slug;nome;preco\nx;"=HYPERLINK(""http://mal.com"")";1,00\n');
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).toContain('=, +, - ou @');
    expect(importProducts).not.toHaveBeenCalled();
  });

  it('aceita arquivo maior que o limite geral da API (64 KB) e recusa acima de 512 KB', async () => {
    const description = 'a'.repeat(5000);
    const lines = Array.from({ length: 40 }, (_, i) => `p-${i};Produto ${i};1,00;${description}`);
    const big = ['slug;nome;preco;descricao', ...lines].join('\n');
    expect(big.length).toBeGreaterThan(64 * 1024);
    expect((await send(big)).status).toBe(200);

    const huge = 'slug;nome;preco\n' + 'x'.repeat(PRODUCT_IMPORT_MAX_BYTES + 1);
    const response = await send(huge);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'payload_too_large' } });
  });

  it('o limite geral continua valendo nas demais rotas do painel', async () => {
    const response = await send('x'.repeat(70 * 1024), {
      path: '/admin/products',
      type: 'application/json',
    });
    expect(response.status).toBe(413);
  });

  it('recusa tipo de conteúdo errado e arquivo que não é UTF-8', async () => {
    expect((await send(GOOD, { type: 'application/json' })).status).toBe(415);
    expect((await send(GOOD, { type: 'multipart/form-data' })).status).toBe(415);
    const latin1 = new Uint8Array([...new TextEncoder().encode('slug;nome;preco\na;Caf'), 0xe9]);
    const response = await send(latin1);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_encoding' } });
    expect(importProducts).not.toHaveBeenCalled();
  });

  it('transforma falha de linha detectada pelo banco em relatório por linha', async () => {
    importProducts.mockRejectedValueOnce(new ProductImportRowError(2, 'slug_removed'));
    const response = await send(GOOD);
    expect(response.status).toBe(422);
    const body = (await response.json()) as { report: { errors: { line: number }[] } };
    expect(body.report.errors).toEqual([expect.objectContaining({ line: 2 })]);
  });

  it('erro inesperado do banco não vaza detalhes', async () => {
    importProducts.mockRejectedValueOnce(new Error('segredo interno do banco'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await send(GOOD);
    spy.mockRestore();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('segredo');
  });

  it('limita a frequência de envios', async () => {
    const response = await send(GOOD, { allow: false });
    expect(response.status).toBe(429);
    expect(importProducts).not.toHaveBeenCalled();
  });

  it('serve o arquivo-modelo como CSV para download', async () => {
    const response = await send(null, { method: 'GET', path: `${URL_PATH}/template`, type: null });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(
      new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(
        await response.arrayBuffer(),
      ),
    ).toBe(buildProductCsvTemplate());
  });
});
