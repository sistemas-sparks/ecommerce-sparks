import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PRODUCT_CSV_COLUMNS,
  PRODUCT_IMPORT_MAX_BYTES,
  PRODUCT_IMPORT_MAX_ERRORS,
  PRODUCT_IMPORT_MAX_ROWS,
  buildProductCsvTemplate,
  escapeCsvCell,
  parseCsv,
  parseReaisToCents,
  productCsvErrorsToCsv,
  validateProductCsv,
} from './index';

const CATEGORY = { id: '22222222-2222-4222-8222-222222222222', slug: 'cadernos', name: 'Cadernos' };
const HEADER = 'slug;nome;preco';

describe('parseCsv', () => {
  it('lê ; e , sem confundir, com BOM, aspas, aspas escapadas e quebra de linha no campo', () => {
    const text = '﻿a;b;c\r\n1;"x;y";"linha 1\nlinha ""2"""\r\n\r\n4;5;6';
    expect(parseCsv(text)).toEqual([
      { line: 1, cells: ['a', 'b', 'c'] },
      { line: 2, cells: ['1', 'x;y', 'linha 1\nlinha "2"'] },
      { line: 5, cells: ['4', '5', '6'] },
    ]);
    expect(parseCsv('a,b\n1,2')[1]?.cells).toEqual(['1', '2']);
  });

  it('rejeita aspas abertas e texto depois das aspas', () => {
    expect(() => parseCsv('a;b\n"x;y')).toThrow(/Aspas abertas/);
    expect(() => parseCsv('a;b\n"x"z;y')).toThrow(/depois das aspas/);
  });
});

describe('escapeCsvCell (injeção de fórmula)', () => {
  it.each(['=1+1', '+55 79', '-10', '@SOMA(A1)', '\t=1', ' =HYPERLINK("x")'])(
    'neutraliza %j',
    (value) => {
      expect(escapeCsvCell(value).replace(/^"/, '')).toMatch(/^'/);
    },
  );
  it('mantém texto comum e protege separadores e aspas', () => {
    expect(escapeCsvCell('Caderno')).toBe('Caderno');
    expect(escapeCsvCell('a;b')).toBe('"a;b"');
    expect(escapeCsvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(12)).toBe('12');
  });
});

describe('parseReaisToCents', () => {
  it('converte reais em centavos inteiros e recusa formatos ambíguos ou fora do limite', () => {
    expect(parseReaisToCents('12,90')).toBe(1290);
    expect(parseReaisToCents('R$ 1.234,56')).toBe(123456);
    expect(parseReaisToCents('5')).toBe(500);
    expect(parseReaisToCents('0,07')).toBe(7);
    for (const bad of ['12.5', '-1', '1e3', 'abc', '12,999', '99999999999,00', '21474837,00'])
      expect(parseReaisToCents(bad)).toBeNull();
  });
});

describe('validateProductCsv', () => {
  it('aceita o arquivo-modelo e converte dinheiro para centavos', () => {
    const { report, rows } = validateProductCsv(buildProductCsvTemplate());
    expect(report).toMatchObject({ ok: true, totalRows: 2, validRows: 2, errors: [] });
    expect(rows[0]!.data).toMatchObject({
      slug: 'exemplo-caderno-brochura',
      price_cents: 1000,
      cost_cents: 500,
      stock: 10,
      weight_g: 300,
      package_size: 'P',
      kind: 'regular',
      active: false,
      category_id: null,
    });
    expect(rows[1]!.data.kind).toBe('gift_wrap');
  });

  it('o modelo salvo em docs/modelos é idêntico ao gerado pelo código', () => {
    const saved = readFileSync(
      new URL('../../../docs/modelos/importacao-produtos.csv', import.meta.url),
      'utf8',
    );
    expect(saved).toBe(buildProductCsvTemplate());
  });

  it('usa padrões para colunas opcionais e entende categoria por slug ou nome, sem acento', () => {
    const csv = `${HEADER};categoria;ativo\nlapis;Lápis;12,5;Cadernos;SIM\ncaneta;Caneta;3;cadernos;`;
    const { report, rows } = validateProductCsv(csv, [CATEGORY]);
    expect(report.errors).toEqual([]);
    expect(rows.map((row) => row.data.category_id)).toEqual([CATEGORY.id, CATEGORY.id]);
    expect(rows[0]!.data).toMatchObject({
      price_cents: 1250,
      active: true,
      stock: 0,
      cost_cents: 0,
      description: '',
      badge: null,
      featured: false,
    });
    expect(rows[1]!.data.active).toBe(false);
  });

  it('aceita cabeçalho com acento, caixa diferente e colunas em outra ordem', () => {
    const csv = 'Preço;NOME;Slug\n2,00;Borracha;borracha';
    const { report, rows } = validateProductCsv(csv);
    expect(report.ok).toBe(true);
    expect(rows[0]!.data).toMatchObject({ slug: 'borracha', name: 'Borracha', price_cents: 200 });
  });

  it('relata erros por linha e coluna e não devolve nenhuma linha (tudo ou nada)', () => {
    const csv = [
      HEADER + ';estoque;peso_g;tamanho;ativo',
      'ok-1;Bom;10,00;5;;P;sim',
      'Slug Ruim;Sem slug;10,00;;;;',
      'ok-2;;abc;-3;0;Z;talvez',
      'ok-1;Repetido;1,00;;;;',
    ].join('\n');
    const { report, rows } = validateProductCsv(csv);
    expect(rows).toEqual([]);
    expect(report.ok).toBe(false);
    expect(report.totalRows).toBe(4);
    const found = report.errors.map((error) => `${error.line}:${error.column}`);
    expect(found).toEqual(
      expect.arrayContaining([
        '3:slug',
        '4:nome',
        '4:preco',
        '4:estoque',
        '4:peso_g',
        '4:tamanho',
        '4:ativo',
        '5:slug',
      ]),
    );
    expect(report.errors.find((e) => e.line === 5)?.message).toContain('linha 2');
    expect(report.errors.every((error) => /[a-zá-ú]/i.test(error.message))).toBe(true);
  });

  it('numera as linhas pelo arquivo, mesmo com quebra de linha dentro de um campo', () => {
    const csv = `${HEADER};descricao\nok;Bom;1,00;"duas\nlinhas"\nruim;Ruim;x;`;
    const { report } = validateProductCsv(csv);
    expect(report.errors).toEqual([expect.objectContaining({ line: 4, column: 'preco' })]);
  });

  it('bloqueia injeção de fórmula em nome, descrição e selo', () => {
    for (const bad of ['=1+1', '+55', '-cmd', '@SUM(A1)', '\t=1']) {
      const csv = `${HEADER};descricao;selo\na;"${bad}";1,00;;\nb;Nome;1,00;"${bad}";\nc;Nome;1,00;;"${bad}"`;
      const { report } = validateProductCsv(csv);
      const columns = report.errors.map((error) => error.column);
      expect(columns).toEqual(expect.arrayContaining(['nome', 'descricao', 'selo']));
      expect(report.errors.some((error) => error.message.includes('=, +, - ou @'))).toBe(true);
    }
  });

  it('recusa preço zero em produto comum, mas aceita embalagem grátis', () => {
    const csv = `${HEADER};tipo\na;A;0,00;\nb;B;0;embalagem`;
    const { report } = validateProductCsv(csv);
    expect(report.errors).toEqual([expect.objectContaining({ line: 2, column: 'preco' })]);
  });

  it('recusa categoria inexistente sem criar nada', () => {
    const { report } = validateProductCsv(`${HEADER};categoria\na;A;1,00;Inexistente`, [CATEGORY]);
    expect(report.errors).toEqual([expect.objectContaining({ line: 2, column: 'categoria' })]);
  });

  it('recusa cabeçalho com coluna desconhecida, repetida ou obrigatória ausente', () => {
    expect(validateProductCsv('slug;nome;preco;cor\na;A;1').report.errors[0]).toMatchObject({
      line: 1,
      column: 'cor',
    });
    expect(validateProductCsv('slug;nome;nome;preco\na;A;A;1').report.errors[0]).toMatchObject({
      message: 'Coluna repetida.',
    });
    expect(validateProductCsv('slug;nome\na;A').report.errors[0]).toMatchObject({
      column: 'preco',
      message: 'Coluna obrigatória ausente.',
    });
  });

  it('recusa arquivo vazio, só cabeçalho, linha com campos demais e aspas quebradas', () => {
    expect(validateProductCsv('').report.errors[0]!.message).toContain('vazio');
    expect(validateProductCsv(HEADER).report.errors[0]!.message).toContain('nenhum produto');
    expect(validateProductCsv(`${HEADER}\na;A;1;extra`).report.errors[0]).toMatchObject({
      line: 2,
    });
    expect(validateProductCsv(`${HEADER}\na;"A;1`).report.errors[0]).toMatchObject({ line: 2 });
  });

  it('respeita os limites de tamanho do arquivo e de linhas', () => {
    const big = `${HEADER}\n` + 'x'.repeat(PRODUCT_IMPORT_MAX_BYTES + 1);
    expect(validateProductCsv(big).report.errors[0]!.message).toContain('grande demais');
    const many = [HEADER]
      .concat(Array.from({ length: PRODUCT_IMPORT_MAX_ROWS + 1 }, (_, i) => `p${i};P;1`))
      .join('\n');
    expect(validateProductCsv(many).report.errors[0]!.message).toContain('Muitos produtos');
    const exact = [HEADER]
      .concat(Array.from({ length: PRODUCT_IMPORT_MAX_ROWS }, (_, i) => `p${i};P;1`))
      .join('\n');
    expect(validateProductCsv(exact).report.ok).toBe(true);
  });

  it('limita o tamanho do relatório', () => {
    const csv = [HEADER, ...Array.from({ length: 300 }, () => 'Ruim;;x')].join('\n');
    const { report } = validateProductCsv(csv);
    expect(report.errors).toHaveLength(PRODUCT_IMPORT_MAX_ERRORS);
    expect(report.truncated).toBe(true);
  });

  it('colunas do modelo batem com o cabeçalho gerado', () => {
    expect(parseCsv(buildProductCsvTemplate())[0]!.cells).toEqual([...PRODUCT_CSV_COLUMNS]);
  });
});

describe('productCsvErrorsToCsv', () => {
  it('gera CSV de erros com texto seguro contra fórmula', () => {
    const csv = productCsvErrorsToCsv([{ line: 3, column: '=cmd', message: '-ruim' }]);
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'-ruim");
    expect(csv.startsWith('﻿linha;coluna;problema')).toBe(true);
  });
});
