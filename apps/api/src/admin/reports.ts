// Relatório de lucro simples (T-020). Protegido pelo guard de /admin/* (admin + aal2) em app.ts.
// Só leitura. O banco devolve somas; os totais, o lucro e a margem são calculados aqui, no servidor
// (packages/shared/src/profit-report.ts), e o navegador só exibe.
import { buildProfitReport, profitReportQuerySchema, profitReportSchema } from '@sparks/shared';
import { Hono } from 'hono';
import { apiError } from '../lib/errors';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

// A consulta agrega pedidos e itens: limite próprio, mais baixo que o das telas de escrita.
const readLimit = rateLimit({ bucket: 'admin-reports', max: 30, windowSeconds: 600 });

export const REPORT_MESSAGES = {
  invalidInput: 'Confira o período informado.',
} as const;

export const reportsAdminRoutes = new Hono<AppEnv>().get('/profit', readLimit, async (c) => {
  const parsed = profitReportQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    throw apiError(
      400,
      'invalid_input',
      parsed.error.issues[0]?.message ?? REPORT_MESSAGES.invalidInput,
    );
  }
  const raw = await c.var.deps.adminReportsRepo(c.var.config).profit(parsed.data);
  return c.json(profitReportSchema.parse(buildProfitReport(parsed.data, raw)));
});
