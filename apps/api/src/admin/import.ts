// Importação de produtos por CSV (painel). O corpo é o próprio arquivo (text/csv, UTF-8).
// Validação 100% no servidor; só grava se o arquivo inteiro estiver correto (tudo ou nada).
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  PRODUCT_IMPORT_MAX_BYTES,
  buildProductCsvTemplate,
  validateProductCsv,
  type ProductCsvReport,
} from '@sparks/shared';
import { apiError } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';
import { ProductImportRowError } from './import-repo';

/** Rota com limite de corpo próprio (o limite geral da API é pequeno demais para um arquivo). */
export const PRODUCT_IMPORT_PATH = '/admin/import/products';

const importError = (status: 413 | 415 | 422, code: string, message: string) =>
  apiError(status, code, message);

const failedReport = (line: number, message: string): ProductCsvReport => ({
  ok: false,
  totalRows: 0,
  validRows: 0,
  errors: [{ line, column: null, message }],
  truncated: false,
});

export const productImportRoutes = new Hono<AppEnv>()
  .get('/products/template', (c) =>
    c.body(buildProductCsvTemplate(), 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="modelo-importacao-produtos.csv"',
    }),
  )
  .post(
    '/products',
    rateLimit({ bucket: 'admin-import', max: 10, windowSeconds: 600 }),
    bodyLimit({
      maxSize: PRODUCT_IMPORT_MAX_BYTES,
      onError: () =>
        importError(
          413,
          'payload_too_large',
          'Arquivo grande demais. O limite é 512 KB.',
        ).getResponse(),
    }),
    async (c) => {
      const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (type !== 'text/csv' && type !== 'text/plain')
        throw importError(415, 'unsupported_media_type', 'Envie o arquivo no formato CSV.');

      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.length > PRODUCT_IMPORT_MAX_BYTES)
        throw importError(413, 'payload_too_large', 'Arquivo grande demais. O limite é 512 KB.');
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
      } catch {
        throw importError(
          422,
          'invalid_encoding',
          'O arquivo não está em UTF-8. No Excel, salve como "CSV UTF-8 (delimitado por vírgulas)".',
        );
      }

      const repo = c.var.deps.productImportRepo(c.var.config);
      const { report, rows } = validateProductCsv(text, await repo.categories());
      const reject = (body: ProductCsvReport) =>
        c.json(
          {
            error: {
              code: 'import_invalid',
              message: 'O arquivo tem erros. Corrija as linhas indicadas e envie de novo.',
            },
            report: body,
          },
          422,
        );
      if (!report.ok) return reject(report);

      if (c.req.query('dry_run') === 'true') return c.json({ dryRun: true, report });

      try {
        const summary = await repo.importProducts(rows, c.var.user.id);
        return c.json({ dryRun: false, report, summary });
      } catch (error) {
        if (error instanceof ProductImportRowError)
          return reject(
            failedReport(
              error.line,
              error.reason === 'slug_removed'
                ? 'Este slug pertence a um produto já excluído. Use outro slug.'
                : 'Confira o slug, os valores e a categoria: há um cadastro repetido ou vinculado.',
            ),
          );
        throw error;
      }
    },
  );
