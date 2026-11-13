import { describe, expect, it } from 'vitest';
import {
  checkImportFile,
  formatSize,
  groupErrorsByLine,
  lineLabel,
  plural,
  PRODUCT_IMPORT_MAX_BYTES,
} from './import-logic';

describe('checkImportFile', () => {
  it('aceita um .csv dentro do limite', () => {
    expect(checkImportFile({ name: 'produtos.CSV', size: 2000 })).toBeNull();
    expect(checkImportFile({ name: 'a.csv', size: PRODUCT_IMPORT_MAX_BYTES })).toBeNull();
  });

  it('recusa arquivo grande demais, citando 512 KB e 500 produtos', () => {
    const message = checkImportFile({ name: 'a.csv', size: PRODUCT_IMPORT_MAX_BYTES + 1 });
    expect(message).toContain('grande demais');
    expect(message).toContain('512 KB');
    expect(message).toContain('500 produtos');
  });

  it('recusa arquivo vazio e extensão errada', () => {
    expect(checkImportFile({ name: 'a.csv', size: 0 })).toContain('vazio');
    expect(checkImportFile({ name: 'a.xlsx', size: 100 })).toContain('CSV');
  });
});

describe('relatório', () => {
  it('agrupa os erros por linha, na ordem do relatório', () => {
    const groups = groupErrorsByLine([
      { line: 3, column: 'preco', message: 'a' },
      { line: 3, column: 'estoque', message: 'b' },
      { line: 0, column: null, message: 'c' },
      { line: 7, column: 'slug', message: 'd' },
    ]);
    expect(groups.map((g) => g.line)).toEqual([3, 0, 7]);
    expect(groups[0]?.problems).toEqual([
      { column: 'preco', message: 'a' },
      { column: 'estoque', message: 'b' },
    ]);
    expect(groupErrorsByLine([])).toEqual([]);
  });

  it('rótulos de linha, tamanho e plural em português', () => {
    expect(lineLabel(0)).toBe('Arquivo todo');
    expect(lineLabel(1)).toBe('Linha 1 (cabeçalho)');
    expect(lineLabel(12)).toBe('Linha 12');
    expect(formatSize(900)).toBe('900 B');
    expect(formatSize(1536)).toBe('1,5 KB');
    expect(plural(1, 'erro', 'erros')).toBe('1 erro');
    expect(plural(2, 'erro', 'erros')).toBe('2 erros');
  });
});
