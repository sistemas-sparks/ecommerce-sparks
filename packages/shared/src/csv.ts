// CSV puro (sem rede nem banco): leitura tolerante ao Excel e escrita protegida contra injeção de fórmula.

export interface CsvRecord {
  /** Linha do arquivo onde o registro começa (1 = cabeçalho). */
  line: number;
  cells: string[];
}

export class CsvParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'CsvParseError';
  }
}

/** Escolhe ";" (Excel em português) ou "," pela primeira linha, ignorando o que está entre aspas. */
export function detectCsvDelimiter(text: string): ',' | ';' {
  let semicolons = 0;
  let commas = 0;
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && char === ';') semicolons++;
    else if (!quoted && char === ',') commas++;
  }
  return semicolons > commas ? ';' : ',';
}

/**
 * Lê CSV (RFC 4180): aspas duplas, aspas escapadas ("") e quebras de linha dentro de campos.
 * Remove o BOM do UTF-8 e ignora linhas totalmente vazias.
 */
export function parseCsv(input: string, delimiter?: ',' | ';'): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const separator = delimiter ?? detectCsvDelimiter(text);
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  let line = 1;
  let startLine = 1;

  const endCell = () => {
    cells.push(cell);
    cell = '';
    wasQuoted = false;
  };
  const endRecord = () => {
    endCell();
    if (cells.some((value) => value.trim() !== '')) records.push({ line: startLine, cells });
    cells = [];
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else quoted = false;
      } else {
        if (char === '\n') line++;
        cell += char;
      }
    } else if (char === '"') {
      if (cell !== '' || wasQuoted) throw new CsvParseError('Aspas fora do lugar.', line);
      quoted = true;
      wasQuoted = true;
    } else if (char === separator) {
      endCell();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      endRecord();
      line++;
      startLine = line;
    } else if (wasQuoted) {
      throw new CsvParseError('Texto depois das aspas de fechamento.', line);
    } else cell += char;
  }
  if (quoted) throw new CsvParseError('Aspas abertas sem fechar.', startLine);
  if (cell !== '' || cells.length > 0 || wasQuoted) endRecord();
  return records;
}

/** Texto que o Excel/Planilhas pode executar como fórmula se estiver no início da célula. */
const FORMULA_START = /^[\s]*[=+\-@]|^[\t\r]/;

export function startsLikeFormula(value: string): boolean {
  return FORMULA_START.test(value);
}

/**
 * Célula segura para escrita: prefixa um apóstrofo quando o texto começa como fórmula
 * (=, +, -, @, tab ou CR) e coloca aspas quando há ";" (o separador de escrita), aspas ou quebra de linha.
 */
export function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (startsLikeFormula(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null>>,
): string {
  return rows.map((row) => row.map(escapeCsvCell).join(';')).join('\r\n') + '\r\n';
}
