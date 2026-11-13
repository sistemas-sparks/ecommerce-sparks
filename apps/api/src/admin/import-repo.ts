import { z } from 'zod';
import {
  PRODUCT_IMPORT_MAX_ROWS,
  categoryRowSchema,
  type ProductCsvCategory,
  type ProductCsvRow,
} from '@sparks/shared';
import type { Config } from '../env';
import { getServiceClient } from '../lib/supabase';
import { apiError } from '../lib/errors';

export interface ProductImportSummary {
  created: number;
  updated: number;
  unchanged: number;
}

/** Falha de uma linha do arquivo que só o banco consegue ver (ex.: slug de produto removido). */
export class ProductImportRowError extends Error {
  constructor(
    readonly line: number,
    readonly reason: 'slug_removed' | 'conflict',
  ) {
    super(reason);
    this.name = 'ProductImportRowError';
  }
}

export interface ProductImportRepo {
  /** Categorias existentes, para resolver a coluna "categoria" do arquivo. */
  categories(): Promise<ProductCsvCategory[]>;
  /** Grava todas as linhas em uma única transação (tudo ou nada). */
  importProducts(rows: ProductCsvRow[], actor: string): Promise<ProductImportSummary>;
}

const summarySchema = z.object({
  created: z.number().int().min(0).max(PRODUCT_IMPORT_MAX_ROWS),
  updated: z.number().int().min(0).max(PRODUCT_IMPORT_MAX_ROWS),
  unchanged: z.number().int().min(0).max(PRODUCT_IMPORT_MAX_ROWS),
});
const rpcErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.string().nullish(),
});

export function supabaseProductImportRepo(config: Config): ProductImportRepo {
  const db = getServiceClient(config);
  return {
    async categories() {
      const result = await db
        .from('categories')
        .select('id,slug,name,updated_at,position,active')
        .limit(500);
      if (result.error)
        throw apiError(503, 'unavailable', 'Não foi possível acessar as categorias.');
      return categoryRowSchema
        .array()
        .max(500)
        .parse(result.data)
        .map(({ id, slug, name }) => ({ id, slug, name }));
    },
    async importProducts(rows, actor) {
      const result = await db.rpc('admin_products_import', {
        p_rows: rows.map(({ line, data }) => ({ ...data, line })),
        p_actor: actor,
      });
      if (result.error) {
        const parsed = rpcErrorSchema.safeParse(result.error);
        if (parsed.success && parsed.data.code === 'P0001') {
          const line = Number(parsed.data.details);
          if (Number.isInteger(line) && line > 0) {
            if (parsed.data.message === 'import_slug_removed')
              throw new ProductImportRowError(line, 'slug_removed');
            if (parsed.data.message === 'import_row_failed')
              throw new ProductImportRowError(line, 'conflict');
          }
          if (parsed.data.message === 'catalog_invalid')
            throw apiError(400, 'invalid_input', 'Confira os dados do arquivo.');
        }
        throw apiError(503, 'unavailable', 'Não foi possível importar os produtos.');
      }
      return summarySchema.parse(result.data);
    },
  };
}
