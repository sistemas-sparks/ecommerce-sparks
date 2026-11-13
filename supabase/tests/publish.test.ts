// T-010 · claim_publish / revert_publish: no máximo 1 publicação por intervalo, com auditoria.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asRole, createTestDb } from './db';

interface Claim {
  ok: boolean;
  previous: string | null;
  claimed_at: string | null;
  next_allowed_at: string;
}

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.query(`update public.settings set last_publish_at = null`);
});

const claim = () =>
  asRole(db, 'service_role', null, async () => {
    const { rows } = await db.query<{ r: Claim }>(
      `select public.claim_publish(600, 'admin:teste') as r`,
    );
    return rows[0]!.r;
  });

const revert = (claimedAt: string, previous: string | null) =>
  asRole(db, 'service_role', null, async () => {
    const { rows } = await db.query<{ r: boolean }>(`select public.revert_publish($1, $2) as r`, [
      claimedAt,
      previous,
    ]);
    return rows[0]!.r;
  });

describe('claim_publish', () => {
  it('a primeira publicação passa e fica registrada na auditoria', async () => {
    const first = await claim();
    expect(first.ok).toBe(true);
    expect(first.previous).toBeNull();
    const diff = new Date(first.next_allowed_at).getTime() - new Date(first.claimed_at!).getTime();
    expect(diff).toBe(600_000);

    const { rows } = await db.query(
      `select actor, action, entity from public.audit_log where action = 'publish' order by id desc limit 1`,
    );
    expect(rows).toEqual([{ actor: 'admin:teste', action: 'publish', entity: 'site' }]);
  });

  it('a segunda dentro do intervalo é recusada e informa quando pode', async () => {
    const first = await claim();
    const second = await claim();
    expect(second.ok).toBe(false);
    expect(second.next_allowed_at).toBe(first.next_allowed_at);
  });

  it('depois do intervalo pode publicar de novo', async () => {
    await db.query(`update public.settings set last_publish_at = now() - interval '11 minutes'`);
    expect((await claim()).ok).toBe(true);
  });

  it('recusa intervalo absurdo e autor vazio', async () => {
    await expect(
      asRole(db, 'service_role', null, () => db.query(`select public.claim_publish(1, 'x')`)),
    ).rejects.toThrow('invalid_payload');
    await expect(
      asRole(db, 'service_role', null, () => db.query(`select public.claim_publish(600, '')`)),
    ).rejects.toThrow('invalid_payload');
  });
});

describe('revert_publish', () => {
  it('desfaz a reserva quando o deploy hook falhou', async () => {
    const first = await claim();
    expect(await revert(first.claimed_at!, first.previous)).toBe(true);
    expect((await claim()).ok).toBe(true);
  });

  it('não desfaz se outra publicação aconteceu depois', async () => {
    const first = await claim();
    await db.query(`update public.settings set last_publish_at = now() + interval '1 second'`);
    expect(await revert(first.claimed_at!, first.previous)).toBe(false);
  });
});

describe('permissões', () => {
  it('anon e authenticated não executam', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        asRole(db, role, null, () => db.query(`select public.claim_publish(600, 'x')`)),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
