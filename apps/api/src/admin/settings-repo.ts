import {
  giftWrapAdminSettingsSchema,
  type GiftWrapAdminSettings,
  type GiftWrapSettingsInput,
} from '@sparks/shared';
import { z } from 'zod';
import type { Config } from '../env';
import { apiError } from '../lib/errors';
import { getServiceClient } from '../lib/supabase';

export interface SettingsRepo {
  get(): Promise<GiftWrapAdminSettings>;
  update(data: GiftWrapSettingsInput, actor: string): Promise<GiftWrapAdminSettings>;
}

const fail = () =>
  apiError(503, 'unavailable', 'Não foi possível acessar as configurações da loja.');
const enabledRow = z.object({ gift_wrap_enabled: z.boolean() });
const stockRows = z.array(z.object({ stock: z.number().int() }));

export function supabaseSettingsRepo(config: Config): SettingsRepo {
  const db = getServiceClient(config);
  const read = async (): Promise<GiftWrapAdminSettings> => {
    const [settings, models] = await Promise.all([
      db.from('settings').select('gift_wrap_enabled').eq('id', 1).single(),
      db
        .from('products')
        .select('stock')
        .eq('kind', 'gift_wrap')
        .eq('active', true)
        .is('deleted_at', null),
    ]);
    if (settings.error || models.error) throw fail();
    const rows = stockRows.parse(models.data);
    return giftWrapAdminSettingsSchema.parse({
      gift_wrap_enabled: enabledRow.parse(settings.data).gift_wrap_enabled,
      gift_wrap_models: {
        total: rows.length,
        available: rows.filter((row) => row.stock > 0).length,
      },
    });
  };
  return {
    get: read,
    async update(data, actor) {
      const result = await db
        .from('settings')
        .update({ gift_wrap_enabled: data.gift_wrap_enabled })
        .eq('id', 1)
        .select('id')
        .single();
      if (result.error) throw fail();
      // Sem dados pessoais: só o novo valor do interruptor.
      const audit = await db.from('audit_log').insert({
        actor,
        action: 'update',
        entity: 'gift_wrap_settings',
        entity_id: null,
        diff: { gift_wrap_enabled: data.gift_wrap_enabled },
      });
      if (audit.error) throw fail();
      return read();
    },
  };
}
