// Importação de produtos por CSV: colunas, validação com Zod, relatório de erros por linha e modelo.
// Funções puras (sem rede nem banco). A gravação é feita pela API, em uma única transação.
import { z } from 'zod';
import { parseBRLToCents } from './money';
import { CONTROL_CHARS, textLength } from './schemas/common';
import { productInputSchema, productSlugSchema, type ProductInput } from './schemas/products';
import { CsvParseError, parseCsv, startsLikeFormula, toCsv } from './csv';

/** Limites da importação (arquivo pequeno de propósito: a loja cadastra poucas centenas de itens). */
export const PRODUCT_IMPORT_MAX_BYTES = 512 * 1024;
export const PRODUCT_IMPORT_MAX_ROWS = 500;
/** O relatório mostra no máximo estes erros, para não crescer sem limite. */
export const PRODUCT_IMPORT_MAX_ERRORS = 100;
const MAX_CENTS = 2147483647;

/** Colunas do modelo, na ordem. Cabeçalhos em português sem acento (o leitor ignora acento e caixa). */
export const PRODUCT_CSV_COLUMNS = [
  'slug',
  'nome',
  'descricao',
  'categoria',
  'tipo',
  'preco',
  'custo',
  'estoque',
  'peso_g',
  'tamanho',
  'comprimento_cm',
  'largura_cm',
  'altura_cm',
  'ativo',
  'destaque',
  'selo',
] as const;
export type ProductCsvColumn = (typeof PRODUCT_CSV_COLUMNS)[number];
export const PRODUCT_CSV_REQUIRED_COLUMNS: readonly ProductCsvColumn[] = ['slug', 'nome', 'preco'];

export interface ProductCsvError {
  /** Linha do arquivo (1 = cabeçalho; 0 = erro que vale para o arquivo todo). */
  line: number;
  column: string | null;
  message: string;
}

export interface ProductCsvReport {
  ok: boolean;
  totalRows: number;
  validRows: number;
  errors: ProductCsvError[];
  /** True quando havia mais erros do que o relatório mostra. */
  truncated: boolean;
}

export interface ProductCsvRow {
  line: number;
  data: ProductInput;
}

export interface ProductCsvCategory {
  id: string;
  slug: string;
  name: string;
}

const normalizeKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

/** Reais no formato brasileiro ("12,90", "1.234,56", "R$ 5") para centavos, dentro do limite do banco. */
export function parseReaisToCents(raw: string): number | null {
  const cents = parseBRLToCents(raw);
  return cents !== null && cents <= MAX_CENTS ? cents : null;
}

type Outcome<T> = { value: T } | { error: string };
const failure = (error: string) => ({ error });

/** Campo da planilha para um schema Zod, com a mensagem em português da regra violada. */
function field<T>(parse: (value: string) => Outcome<T>) {
  return z.string().transform((value, ctx) => {
    const result = parse(value);
    if ('error' in result) {
      ctx.issues.push({ code: 'custom', message: result.error, input: value });
      return z.NEVER;
    }
    return result.value;
  });
}

function textField(label: string, max: number, multiline: boolean, optional: boolean) {
  return field<string | null>((raw) => {
    const value = (multiline ? raw.replace(/\r\n?/g, '\n') : raw).trim();
    if (value === '') return optional ? { value: null } : failure(`${label} é obrigatório.`);
    if (CONTROL_CHARS.test(value) || (!multiline && value.includes('\n')))
      return failure(`${label} tem caracteres inválidos.`);
    if (startsLikeFormula(value))
      return failure(`${label} não pode começar com =, +, - ou @. Ajuste o texto.`);
    if (textLength(value) > max) return failure(`${label} pode ter no máximo ${max} caracteres.`);
    return { value };
  });
}

const money = (label: string, required: boolean, allowZero: boolean) =>
  field<number>((raw) => {
    if (raw.trim() === '') return required ? failure(`${label} é obrigatório.`) : { value: 0 };
    const cents = parseReaisToCents(raw);
    if (cents === null) return failure(`${label} inválido. Use reais com vírgula, como 12,90.`);
    if (!allowZero && cents === 0) return failure(`${label} precisa ser maior que zero.`);
    return { value: cents };
  });

const wholeNumber = (label: string, min: number) =>
  field<number | null>((raw) => {
    const value = raw.trim();
    if (value === '') return { value: min === 0 ? 0 : null };
    if (!/^\d{1,10}$/.test(value) || Number(value) > MAX_CENTS || Number(value) < min)
      return failure(
        `${label} precisa ser um número inteiro ${min === 0 ? 'de 0 em diante' : 'maior que zero'}.`,
      );
    return { value: Number(value) };
  });

const yesNo = (label: string) =>
  field<boolean>((raw) => {
    const value = normalizeKey(raw);
    if (['', 'nao', 'n', '0', 'false', 'no'].includes(value)) return { value: false };
    if (['sim', 's', '1', 'true', 'yes'].includes(value)) return { value: true };
    return failure(`${label} precisa ser "sim" ou "nao".`);
  });

const kind = field<'regular' | 'gift_wrap'>((raw) => {
  const value = normalizeKey(raw);
  if (['', 'regular', 'produto', 'normal'].includes(value)) return { value: 'regular' };
  if (['embalagem', 'gift_wrap', 'presente'].includes(value)) return { value: 'gift_wrap' };
  return failure('Tipo precisa ser "produto" ou "embalagem".');
});

const packageSize = field<'P' | 'M' | 'G'>((raw) => {
  const value = raw.trim().toUpperCase();
  if (value === '') return { value: 'P' };
  if (value === 'P' || value === 'M' || value === 'G') return { value };
  return failure('Tamanho precisa ser P, M ou G.');
});

const slug = field<string>((raw) => {
  const value = raw.trim();
  if (value === '') return failure('Slug (o link do produto) é obrigatório.');
  const checked = productSlugSchema.safeParse(value);
  if (!checked.success)
    return failure('Slug inválido. Use só letras minúsculas sem acento, números e hífens.');
  return { value };
});

/** Uma linha do CSV, ainda em texto, convertida para os tipos do banco (menos a categoria). */
export const productCsvRowSchema = z.object({
  slug,
  nome: textField('Nome', 120, false, false),
  descricao: textField('Descrição', 10000, true, true),
  categoria: z.string().trim().max(120, { error: 'Categoria longa demais.' }),
  tipo: kind,
  preco: z.string(),
  custo: money('Custo', false, true),
  estoque: wholeNumber('Estoque', 0),
  peso_g: wholeNumber('Peso (g)', 1),
  tamanho: packageSize,
  comprimento_cm: wholeNumber('Comprimento (cm)', 1),
  largura_cm: wholeNumber('Largura (cm)', 1),
  altura_cm: wholeNumber('Altura (cm)', 1),
  ativo: yesNo('Ativo'),
  destaque: yesNo('Destaque'),
  selo: textField('Selo', 30, false, true),
});

function fileError(message: string): ProductCsvError {
  return { line: 0, column: null, message };
}

function emptyReport(errors: ProductCsvError[], totalRows = 0): ProductCsvReport {
  return {
    ok: false,
    totalRows,
    validRows: 0,
    errors: errors.slice(0, PRODUCT_IMPORT_MAX_ERRORS),
    truncated: errors.length > PRODUCT_IMPORT_MAX_ERRORS,
  };
}

/**
 * Valida o texto do CSV inteiro. Tudo ou nada: se qualquer linha tiver erro, `rows` vem vazio
 * e o relatório lista os erros por linha e coluna. Não grava nada.
 */
export function validateProductCsv(
  text: string,
  categories: readonly ProductCsvCategory[] = [],
): { report: ProductCsvReport; rows: ProductCsvRow[] } {
  const rejected = (errors: ProductCsvError[], total = 0) => ({
    report: emptyReport(errors, total),
    rows: [] as ProductCsvRow[],
  });
  if (new TextEncoder().encode(text).length > PRODUCT_IMPORT_MAX_BYTES)
    return rejected([fileError('Arquivo grande demais. O limite é 512 KB.')]);

  let records;
  try {
    records = parseCsv(text);
  } catch (error) {
    if (error instanceof CsvParseError)
      return rejected([{ line: error.line, column: null, message: error.message }]);
    throw error;
  }
  const header = records[0];
  if (!header) return rejected([fileError('O arquivo está vazio.')]);

  const columns = header.cells.map(normalizeKey);
  const known = new Set<string>(PRODUCT_CSV_COLUMNS);
  const headerErrors: ProductCsvError[] = [];
  const seen = new Set<string>();
  columns.forEach((column, index) => {
    if (!known.has(column))
      headerErrors.push({
        line: 1,
        column: header.cells[index]!.trim() || `coluna ${index + 1}`,
        message: 'Coluna desconhecida. Use os nomes do arquivo-modelo.',
      });
    else if (seen.has(column)) headerErrors.push({ line: 1, column, message: 'Coluna repetida.' });
    seen.add(column);
  });
  for (const required of PRODUCT_CSV_REQUIRED_COLUMNS)
    if (!seen.has(required))
      headerErrors.push({ line: 1, column: required, message: 'Coluna obrigatória ausente.' });
  if (headerErrors.length > 0) return rejected(headerErrors);

  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) return rejected([fileError('O arquivo não tem nenhum produto.')]);
  if (dataRecords.length > PRODUCT_IMPORT_MAX_ROWS)
    return rejected(
      [fileError(`Muitos produtos de uma vez. O limite é ${PRODUCT_IMPORT_MAX_ROWS} por arquivo.`)],
      dataRecords.length,
    );

  const bySlug = new Map(categories.map((category) => [normalizeKey(category.slug), category.id]));
  const byName = new Map(categories.map((category) => [normalizeKey(category.name), category.id]));
  const errors: ProductCsvError[] = [];
  const rows: ProductCsvRow[] = [];
  const slugLines = new Map<string, number>();

  for (const record of dataRecords) {
    const before = errors.length;
    if (record.cells.length > columns.length) {
      errors.push({
        line: record.line,
        column: null,
        message: 'A linha tem mais campos que o cabeçalho. Confira vírgulas e aspas.',
      });
      continue;
    }
    const raw: Record<string, string> = {};
    columns.forEach((column, index) => {
      raw[column] = record.cells[index] ?? '';
    });
    for (const column of PRODUCT_CSV_COLUMNS) raw[column] ??= '';

    const parsed = productCsvRowSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        errors.push({
          line: record.line,
          column: typeof issue.path[0] === 'string' ? issue.path[0] : null,
          message: issue.message,
        });
    }
    const row = parsed.success ? parsed.data : null;

    let priceCents: number | null = null;
    const priceRaw = raw.preco!;
    if (priceRaw.trim() === '')
      errors.push({ line: record.line, column: 'preco', message: 'Preço é obrigatório.' });
    else {
      const cents = parseReaisToCents(priceRaw);
      if (cents === null)
        errors.push({
          line: record.line,
          column: 'preco',
          message: 'Preço inválido. Use reais com vírgula, como 12,90.',
        });
      else priceCents = cents;
    }
    if (row && row.tipo === 'regular' && priceCents === 0)
      errors.push({
        line: record.line,
        column: 'preco',
        message: 'Preço precisa ser maior que zero.',
      });

    let categoryId: string | null = null;
    const categoryKey = normalizeKey(raw.categoria!);
    if (categoryKey !== '') {
      categoryId = bySlug.get(categoryKey) ?? byName.get(categoryKey) ?? null;
      if (categoryId === null)
        errors.push({
          line: record.line,
          column: 'categoria',
          message: 'Categoria não encontrada. Cadastre-a antes em Produtos, Categorias.',
        });
    }

    if (row) {
      const earlier = slugLines.get(row.slug);
      if (earlier !== undefined)
        errors.push({
          line: record.line,
          column: 'slug',
          message: `Slug repetido: já aparece na linha ${earlier}.`,
        });
      else slugLines.set(row.slug, record.line);
    }

    if (errors.length > before || !row) continue;
    const candidate = productInputSchema.safeParse({
      slug: row.slug,
      name: row.nome,
      description: row.descricao ?? '',
      category_id: categoryId,
      kind: row.tipo,
      price_cents: priceCents,
      cost_cents: row.custo,
      stock: row.estoque,
      weight_g: row.peso_g,
      package_size: row.tamanho,
      length_cm: row.comprimento_cm,
      width_cm: row.largura_cm,
      height_cm: row.altura_cm,
      active: row.ativo,
      featured: row.destaque,
      badge: row.selo,
    });
    if (candidate.success) rows.push({ line: record.line, data: candidate.data });
    else
      errors.push({
        line: record.line,
        column: null,
        message: 'Os dados desta linha não passaram na validação final.',
      });
  }

  if (errors.length > 0) return rejected(errors, dataRecords.length);
  return {
    report: {
      ok: true,
      totalRows: dataRecords.length,
      validRows: rows.length,
      errors: [],
      truncated: false,
    },
    rows,
  };
}

/** Exemplos do modelo: dados inventados só para mostrar o formato (nada da loja). */
const TEMPLATE_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  [
    'exemplo-caderno-brochura',
    'Exemplo: caderno brochura',
    'Texto de exemplo. Troque pela descrição do produto.',
    '',
    'produto',
    '10,00',
    '5,00',
    '10',
    '300',
    'P',
    '21',
    '15',
    '2',
    'nao',
    'nao',
    '',
  ],
  [
    'exemplo-embalagem-presente',
    'Exemplo: embalagem de presente',
    '',
    '',
    'embalagem',
    '3,50',
    '1,00',
    '100',
    '',
    'P',
    '',
    '',
    '',
    'nao',
    'nao',
    '',
  ],
];

/** Texto do arquivo-modelo (UTF-8 com BOM e ";" para abrir direto no Excel em português). */
export function buildProductCsvTemplate(): string {
  return '﻿' + toCsv([[...PRODUCT_CSV_COLUMNS], ...TEMPLATE_ROWS]);
}

/** Relatório de erros em CSV, para a lojista corrigir a planilha. Textos protegidos contra fórmula. */
export function productCsvErrorsToCsv(errors: readonly ProductCsvError[]): string {
  return (
    '﻿' +
    toCsv([
      ['linha', 'coluna', 'problema'],
      ...errors.map((error) => [error.line || '', error.column ?? '', error.message]),
    ])
  );
}
