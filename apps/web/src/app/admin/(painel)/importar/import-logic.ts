// Regras da tela de importação que não dependem do navegador (testáveis sem tela).
import {
  PRODUCT_IMPORT_MAX_BYTES,
  PRODUCT_IMPORT_MAX_ERRORS,
  PRODUCT_IMPORT_MAX_ROWS,
  type ProductCsvError,
} from '@sparks/shared';

export { PRODUCT_IMPORT_MAX_BYTES, PRODUCT_IMPORT_MAX_ERRORS, PRODUCT_IMPORT_MAX_ROWS };

export const MAX_FILE_LABEL = '512 KB';

/** Confere o arquivo escolhido antes de enviar. Devolve a mensagem do problema, ou null se estiver ok. */
export function checkImportFile(file: { name: string; size: number }): string | null {
  if (!/\.csv$/i.test(file.name))
    return 'Escolha um arquivo no formato CSV (nome terminado em .csv).';
  if (file.size === 0) return 'O arquivo está vazio.';
  if (file.size > PRODUCT_IMPORT_MAX_BYTES)
    return `Arquivo grande demais (${formatSize(file.size)}). O limite é ${MAX_FILE_LABEL}, ou até ${PRODUCT_IMPORT_MAX_ROWS} produtos por arquivo. Divida a planilha em mais de um arquivo.`;
  return null;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
}

export interface LineErrors {
  /** 0 = erro do arquivo todo. */
  line: number;
  problems: { column: string | null; message: string }[];
}

/** Junta os erros por linha do arquivo, mantendo a ordem em que o relatório os trouxe. */
export function groupErrorsByLine(errors: readonly ProductCsvError[]): LineErrors[] {
  const groups = new Map<number, LineErrors>();
  for (const error of errors) {
    let group = groups.get(error.line);
    if (!group) {
      group = { line: error.line, problems: [] };
      groups.set(error.line, group);
    }
    group.problems.push({ column: error.column, message: error.message });
  }
  return [...groups.values()];
}

export function lineLabel(line: number): string {
  return line === 0 ? 'Arquivo todo' : line === 1 ? 'Linha 1 (cabeçalho)' : `Linha ${line}`;
}

export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('pt-BR')} ${count === 1 ? one : many}`;
}
