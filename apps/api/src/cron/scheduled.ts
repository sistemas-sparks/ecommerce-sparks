// Tarefas agendadas (Cron Triggers, docs/arquitetura.md §5). Horários em wrangler.jsonc (UTC).
import { cronCountSchema } from '@sparks/shared';
import type { Bindings, Config } from '../env';
import { loadConfig } from '../env';
import { getServiceClient } from '../lib/supabase';

export const CRON_EXPIRE = '*/15 * * * *';
export const CRON_DAILY = '0 9 * * *';

export interface CronRepo {
  /** Expira pedidos não pagos com reserva vencida e devolve o estoque. */
  expireUnpaidOrders(): Promise<number>;
  /** Limpa janelas antigas de limite de requisições. Também mantém o Supabase gratuito ativo. */
  cleanupRateLimits(): Promise<number>;
}

export function supabaseCronRepo(config: Config): CronRepo {
  const db = getServiceClient(config);
  return {
    async expireUnpaidOrders() {
      const { data, error } = await db.rpc('expire_unpaid_orders', { p_limit: 200 });
      if (error) throw new Error('cron_expire_failed');
      return cronCountSchema.parse(data);
    },
    async cleanupRateLimits() {
      const { data, error } = await db.rpc('rate_limit_cleanup');
      if (error) throw new Error('cron_cleanup_failed');
      return cronCountSchema.parse(data);
    },
  };
}

export async function runScheduled(
  cron: string,
  env: Bindings,
  repoFactory: (config: Config) => CronRepo = supabaseCronRepo,
): Promise<void> {
  const repo = repoFactory(loadConfig(env));
  if (cron === CRON_EXPIRE) {
    const expired = await repo.expireUnpaidOrders();
    // eslint-disable-next-line no-console -- log operacional sem dados pessoais
    console.log(JSON.stringify({ level: 'info', event: 'cron_expire', expired }));
  } else if (cron === CRON_DAILY) {
    const removed = await repo.cleanupRateLimits();
    // eslint-disable-next-line no-console -- log operacional sem dados pessoais
    console.log(JSON.stringify({ level: 'info', event: 'cron_daily', removed }));
  } else {
    console.warn(JSON.stringify({ level: 'warn', event: 'cron_unknown', cron }));
  }
}
