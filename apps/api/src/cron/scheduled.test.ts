import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { testEnv } from '../test-utils';
import { CRON_DAILY, CRON_EXPIRE, type CronRepo, runScheduled } from './scheduled';

function fakeRepo() {
  const repo = {
    expireUnpaidOrders: vi.fn(async () => 3),
    cleanupRateLimits: vi.fn(async () => 10),
  } satisfies CronRepo;
  return repo;
}

describe('runScheduled', () => {
  it('a cada 15 minutos expira os pedidos não pagos', async () => {
    const repo = fakeRepo();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await runScheduled(CRON_EXPIRE, testEnv, () => repo);
    expect(repo.expireUnpaidOrders).toHaveBeenCalledOnce();
    expect(repo.cleanupRateLimits).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('uma vez por dia limpa os limites (e mantém o banco ativo)', async () => {
    const repo = fakeRepo();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await runScheduled(CRON_DAILY, testEnv, () => repo);
    expect(repo.cleanupRateLimits).toHaveBeenCalledOnce();
    expect(repo.expireUnpaidOrders).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('os horários batem com os cadastrados no wrangler.jsonc', () => {
    const path = fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url).href);
    const config = readFileSync(path, 'utf8');
    expect(config).toContain(`"${CRON_EXPIRE}"`);
    expect(config).toContain(`"${CRON_DAILY}"`);
  });

  it('falha de configuração não roda nada', async () => {
    const repo = fakeRepo();
    await expect(runScheduled(CRON_EXPIRE, {}, () => repo)).rejects.toThrow(/configuração/);
    expect(repo.expireUnpaidOrders).not.toHaveBeenCalled();
  });
});
