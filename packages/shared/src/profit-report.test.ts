import { describe, expect, it } from 'vitest';
import {
  bucketKeys,
  buildProfitReport,
  centsToDecimal,
  formatMargin,
  formatSignedBRL,
  marginPermille,
  PROFIT_FORMULA,
  profitReportToCsv,
  type ProfitRaw,
  type ProfitRawBucket,
  type ProfitRawProduct,
} from './profit-report';
import { profitReportQuerySchema } from './schemas/admin-reports';

const bucket = (patch: Partial<ProfitRawBucket>): ProfitRawBucket => ({
  bucket: '2026-11-03',
  orders: 1,
  units: 1,
  salesCents: 0,
  salesCostedCents: 0,
  costCents: 0,
  unitsUncosted: 0,
  salesUncostedCents: 0,
  discountCents: 0,
  discountUncostedCents: 0,
  shippingCents: 0,
  giftWrapCents: 0,
  ...patch,
});
const product = (patch: Partial<ProfitRawProduct>): ProfitRawProduct => ({
  key: 'p',
  name: 'Produto',
  units: 1,
  salesCents: 1_000,
  salesCostedCents: 1_000,
  costCents: 1_500,
  unitsUncosted: 0,
  ...patch,
});
const query = { from: '2026-11-01', to: '2026-11-04', groupBy: 'day' } as const;

describe('marginPermille (arredondamento: ao mais próximo, metade para longe do zero)', () => {
  it.each([
    [1, 3, 333], // 33,333... -> 33,3%
    [2, 3, 667], // 66,666... -> 66,7%
    [125, 10_000, 13], // 1,25% -> 1,3%
    [-125, 10_000, -13], // -1,25% -> -1,3% (simétrico)
    [124, 10_000, 12], // 1,24% -> 1,2%
    [-124, 10_000, -12],
    [0, 500, 0],
    [500, 500, 1000], // 100%
    [-500, 500, -1000],
  ])('lucro %i sobre %i = %i décimos de ponto', (profit, base, expected) => {
    expect(marginPermille(profit, base)).toBe(expected);
  });

  it('sem base positiva não há margem; nunca devolve -0', () => {
    expect(marginPermille(100, 0)).toBeNull();
    expect(marginPermille(100, -5)).toBeNull();
    expect(Object.is(marginPermille(-1, 1_000_000), 0)).toBe(true);
  });

  it('recusa valor fracionado (dinheiro só em centavos inteiros)', () => {
    expect(() => marginPermille(10.5, 100)).toThrow(RangeError);
  });

  it('formata em pt-BR', () => {
    expect(formatMargin(467)).toBe('46,7%');
    expect(formatMargin(-13)).toBe('-1,3%');
    expect(formatMargin(null)).toBe('—');
    expect(centsToDecimal(-1250)).toBe('-12,50');
    expect(centsToDecimal(5)).toBe('0,05');
    expect(formatSignedBRL(-1250)).toMatch(/^-R\$\s12,50$/);
  });
});

describe('profitReportQuerySchema', () => {
  it('aceita período válido e assume agrupar por dia', () => {
    const r = profitReportQuerySchema.parse({ from: '2026-11-01', to: '2026-11-30' });
    expect(r.groupBy).toBe('day');
  });
  it('aceita exatamente 366 dias e recusa 367', () => {
    const ok = profitReportQuerySchema.safeParse({ from: '2026-01-01', to: '2027-01-01' });
    expect(ok.success).toBe(true);
    const tooLong = profitReportQuerySchema.safeParse({ from: '2026-01-01', to: '2027-01-02' });
    expect(tooLong.success).toBe(false);
  });
  it('recusa data impossível e fim antes do início', () => {
    expect(
      profitReportQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success,
    ).toBe(false);
    expect(
      profitReportQuerySchema.safeParse({ from: '2026-03-02', to: '2026-03-01' }).success,
    ).toBe(false);
  });
});

describe('bucketKeys', () => {
  it('lista todos os dias, inclusive os sem venda', () => {
    expect(bucketKeys('2026-02-27', '2026-03-01', 'day')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
  });
  it('lista os meses, virando o ano', () => {
    expect(bucketKeys('2026-11-15', '2027-02-03', 'month')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });
});

describe('buildProfitReport', () => {
  it('lucro = vendas com custo - custo - desconto dos itens com custo; frete e embalagem ficam separados', () => {
    const raw: ProfitRaw = {
      buckets: [
        bucket({
          units: 4,
          salesCents: 10_000,
          salesCostedCents: 8_000,
          costCents: 4_000,
          unitsUncosted: 1,
          salesUncostedCents: 2_000,
          discountCents: 500,
          discountUncostedCents: 100, // rateio: 500 × 2.000 / 10.000
          shippingCents: 1_500,
          giftWrapCents: 300,
        }),
      ],
      products: [],
      productsCount: 0,
    };
    const r = buildProfitReport(query, raw);
    expect(r.totals).toMatchObject({
      salesCents: 10_000,
      discountCents: 500,
      netSalesCents: 9_500,
      costCents: 4_000,
      profitCents: 3_600,
      marginPermille: 474, // 3.600 / 7.600
      uncosted: { units: 1, salesCents: 1_900 },
      shippingCents: 1_500,
      giftWrapCents: 300,
    });
    expect(r.series).toHaveLength(4);
    expect(r.series[2]).toMatchObject({
      key: '2026-11-03',
      profitCents: 3_600,
      uncostedSalesCents: 1_900,
    });
    expect(r.series[0]).toMatchObject({ orders: 0, profitCents: 0, marginPermille: null });
  });

  it('pedido só com itens sem custo e cupom: lucro 0, sem prejuízo falso e sem margem (C-1)', () => {
    const r = buildProfitReport(query, {
      buckets: [
        bucket({
          bucket: '2026-11-02',
          units: 10,
          salesCents: 100_000,
          salesCostedCents: 0,
          unitsUncosted: 10,
          salesUncostedCents: 100_000,
          discountCents: 10_000,
          discountUncostedCents: 10_000,
        }),
      ],
      products: [],
      productsCount: 0,
    });
    expect(r.totals.profitCents).toBe(0);
    expect(r.totals.marginPermille).toBeNull();
    expect(r.totals.uncosted.salesCents).toBe(90_000);
    expect(r.series[1]).toMatchObject({ profitCents: 0, marginPermille: null });
  });

  it('em todo período e no total: vendas − sem custo − descontos − custo = lucro (C-2)', () => {
    const r = buildProfitReport(query, {
      buckets: [
        bucket({
          bucket: '2026-11-01',
          salesCents: 10_000,
          salesCostedCents: 7_000,
          costCents: 3_000,
          unitsUncosted: 2,
          salesUncostedCents: 3_000,
          discountCents: 1_001,
          discountUncostedCents: 300,
        }),
        bucket({
          bucket: '2026-11-03',
          salesCents: 2_000,
          salesCostedCents: 0,
          unitsUncosted: 1,
          salesUncostedCents: 2_000,
          discountCents: 200,
          discountUncostedCents: 200,
        }),
        bucket({ bucket: '2026-11-04', salesCents: 500, salesCostedCents: 500, costCents: 700 }),
      ],
      products: [],
      productsCount: 0,
    });
    const rows = [...r.series.filter((s) => s.orders > 0), r.totals];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      const uncosted = 'uncosted' in row ? row.uncosted.salesCents : row.uncostedSalesCents;
      expect(row.salesCents - uncosted - row.discountCents - row.costCents).toBe(row.profitCents);
    }
  });

  it('só itens sem custo: lucro zero e sem margem (nunca 100%)', () => {
    const r = buildProfitReport(query, {
      buckets: [
        bucket({ salesCents: 3_000, unitsUncosted: 3, salesUncostedCents: 3_000, units: 3 }),
      ],
      products: [
        product({
          name: 'Sem custo',
          units: 3,
          salesCents: 3_000,
          salesCostedCents: 0,
          costCents: 0,
          unitsUncosted: 3,
        }),
      ],
      productsCount: 1,
    });
    expect(r.totals.profitCents).toBe(0);
    expect(r.totals.marginPermille).toBeNull();
    expect(r.products[0]).toMatchObject({
      costCents: null,
      profitCents: null,
      marginPermille: null,
      unitsWithoutCost: 3,
    });
  });

  it('produto parcialmente sem custo: lucro só das unidades com custo', () => {
    const r = buildProfitReport(query, {
      buckets: [],
      products: [
        product({
          name: 'Misto',
          units: 4,
          salesCents: 4_000,
          salesCostedCents: 3_000,
          costCents: 1_500,
          unitsUncosted: 1,
        }),
      ],
      productsCount: 1,
    });
    expect(r.products[0]).toMatchObject({
      costCents: 1_500,
      profitCents: 1_500,
      marginPermille: 500,
      unitsWithoutCost: 1,
    });
  });

  it('prejuízo aparece negativo; desconto maior que a venda não gera margem', () => {
    const loss = buildProfitReport(query, {
      buckets: [bucket({ salesCents: 1_000, salesCostedCents: 1_000, costCents: 1_500 })],
      products: [],
      productsCount: 0,
    });
    expect(loss.totals.profitCents).toBe(-500);
    expect(loss.totals.marginPermille).toBe(-500);
    const noBase = buildProfitReport(query, {
      buckets: [
        bucket({
          salesCents: 1_000,
          salesCostedCents: 1_000,
          costCents: 100,
          discountCents: 1_000,
        }),
      ],
      products: [],
      productsCount: 0,
    });
    expect(noBase.totals.marginPermille).toBeNull();
  });

  it('margem do total vem das somas, não da média das margens; marca lista cortada', () => {
    const r = buildProfitReport(query, {
      buckets: [
        bucket({ bucket: '2026-11-01', salesCents: 100, salesCostedCents: 100, costCents: 50 }),
        bucket({ bucket: '2026-11-02', salesCents: 900, salesCostedCents: 900, costCents: 90 }),
      ],
      products: [],
      productsCount: 600,
    });
    // (50 + 810) / 1000 = 86,0%, e não (50% + 90%) / 2 = 70%
    expect(r.totals.marginPermille).toBe(860);
    expect(r.productsTruncated).toBe(true);
  });
});

describe('profitReportToCsv (exportação)', () => {
  const names = [
    '=HYPERLINK("http://x";"a")',
    '+1+1',
    '-2+3',
    '@SUM(A1)',
    ' =x',
    '\tcmd',
    'Caderno; capa',
  ];
  const report = buildProfitReport(query, {
    buckets: [
      bucket({ salesCents: 1_000, salesCostedCents: 1_000, costCents: 1_500, shippingCents: 700 }),
    ],
    products: names.map((name, i) => product({ key: `p${i}`, name })),
    productsCount: names.length,
  });
  const csv = profitReportToCsv(report);

  it('começa com BOM, usa ; e linhas CRLF', () => {
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv).toContain('Produto;Quantidade;Vendas (R$)');
  });

  it('traz a fórmula e as colunas Sem custo e Descontos, na ordem da fórmula', () => {
    expect(csv).toContain(PROFIT_FORMULA);
    expect(csv).toContain(
      'Dia;Pedidos;Vendas (R$);Sem custo (R$);Descontos (R$);Custo (R$);Lucro (R$);Margem (%)',
    );
  });

  it('nome de produto que começa com = + - @ vira texto (apóstrofo), nunca fórmula', () => {
    const lines = csv.split('\r\n');
    const productLines = lines.slice(lines.findIndex((l) => l.startsWith('Produto;')) + 1);
    for (const line of productLines.filter(Boolean)) {
      const first = line.startsWith('"') ? line.slice(1) : line;
      expect(first).not.toMatch(/^\s*[=+\-@]/);
      expect(first).not.toMatch(/^[\t\r]/);
    }
    expect(csv).toContain("'=HYPERLINK(");
    expect(csv).toContain("'+1+1;");
    expect(csv).toContain("'-2+3;");
    expect(csv).toContain("'@SUM(A1);");
    expect(csv).toContain('"Caderno; capa";');
  });

  it('números saem como número (lucro negativo sem apóstrofo) e sem custo sai como texto', () => {
    expect(csv).toContain('Lucro;-5,00');
    expect(csv).toContain('Frete cobrado (fora do lucro);7,00');
    const semCusto = profitReportToCsv(
      buildProfitReport(query, {
        buckets: [],
        products: [
          product({
            name: 'X',
            salesCents: 100,
            salesCostedCents: 0,
            costCents: 0,
            unitsUncosted: 1,
          }),
        ],
        productsCount: 1,
      }),
    );
    expect(semCusto).toContain('X;1;1,00;sem custo;sem custo;;1');
  });
});
