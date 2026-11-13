import {
  meServiceInputSchema,
  ownAreaInputSchema,
  ownTypeInputSchema,
  packageSizeInputSchema,
  shippingAdminEntitySchema,
  shippingExceptionInputSchema,
  shippingHybridSettingsInputSchema,
  uuidSchema,
  type ShippingAdminEntity,
} from '@sparks/shared';
import { Hono } from 'hono';
import { apiError } from '../lib/errors';
import type { AppEnv } from '../types';

// Frete híbrido (docs/frete.md §3 e §4). Zonas, tarifas e regras locais saíram da API admin.
const inputSchemas = {
  'own-types': ownTypeInputSchema,
  'own-areas': ownAreaInputSchema,
  'me-services': meServiceInputSchema,
  exceptions: shippingExceptionInputSchema,
  'package-sizes': packageSizeInputSchema,
};
const ME_SERVICE_ID = /^[1-9]\d{0,5}$/;

function entity(value: string): ShippingAdminEntity {
  const result = shippingAdminEntitySchema.safeParse(value);
  if (!result.success) throw apiError(404, 'not_found', 'Configuração não encontrada.');
  return result.data;
}
function rowId(value: string, section: ShippingAdminEntity) {
  if (section === 'package-sizes' && ['P', 'M', 'G'].includes(value)) return value;
  if (section === 'me-services' && ME_SERVICE_ID.test(value)) return value;
  if (section === 'package-sizes' || section === 'me-services')
    throw apiError(400, 'invalid_input', 'Identificador inválido.');
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw apiError(400, 'invalid_input', 'Identificador inválido.');
  return result.data;
}

export const shippingAdminRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await c.var.deps.shippingRepo(c.var.config).loadAdmin()))
  .patch('/settings', async (c) => {
    const input = shippingHybridSettingsInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      throw apiError(
        400,
        'invalid_input',
        'Confira os valores, limites, prazos e a folga das configurações.',
      );
    await c.var.deps.shippingRepo(c.var.config).settings(input.data, c.var.user.id);
    return c.json({ ok: true });
  })
  .post('/:entity', async (c) => {
    const section = entity(c.req.param('entity'));
    if (section === 'package-sizes')
      throw apiError(400, 'invalid_input', 'Edite os tamanhos P, M e G existentes.');
    if (section === 'me-services')
      throw apiError(400, 'invalid_input', 'Os serviços do Melhor Envio só podem ser editados.');
    const parsed = inputSchemas[section].safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      throw apiError(400, 'invalid_input', 'Confira os campos, valores, CEPs e prazos.');
    await c.var.deps.shippingRepo(c.var.config).save(section, null, parsed.data, c.var.user.id);
    return c.json({ ok: true }, 201);
  })
  .patch('/:entity/:id', async (c) => {
    const section = entity(c.req.param('entity'));
    const id = rowId(c.req.param('id'), section);
    const parsed = inputSchemas[section].safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      throw apiError(400, 'invalid_input', 'Confira os campos, valores, CEPs e prazos.');
    if (section === 'package-sizes' && packageSizeInputSchema.parse(parsed.data).size !== id)
      throw apiError(400, 'invalid_input', 'O tamanho deve corresponder ao cadastro editado.');
    await c.var.deps.shippingRepo(c.var.config).save(section, id, parsed.data, c.var.user.id);
    return c.json({ ok: true });
  })
  .delete('/:entity/:id', async (c) => {
    const section = entity(c.req.param('entity'));
    if (section === 'package-sizes')
      throw apiError(400, 'invalid_input', 'Os tamanhos padrão não podem ser excluídos.');
    if (section === 'me-services')
      throw apiError(400, 'invalid_input', 'Os serviços do Melhor Envio não podem ser excluídos.');
    await c.var.deps
      .shippingRepo(c.var.config)
      .remove(section, rowId(c.req.param('id'), section), c.var.user.id);
    return c.json({ ok: true });
  });
