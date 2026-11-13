// T-021 · Banners e links da bio: RLS negando por padrão, restrições da tabela e a função de gravação
// (PGlite; a migration nunca foi aplicada em Supabase real).
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USER_A, asRole, createTestDb } from './db';

let db: PGlite;
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const IMG = '33333333-3333-4333-8333-333333333333';

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec('delete from public.banners; delete from public.bio_links;');
});

interface Mutated {
  id: string;
}
const mutate = (
  entity: string,
  action: string,
  id: string | null,
  data: unknown,
  expected: string | null = null,
) =>
  asRole(db, 'service_role', null, async () => {
    const { rows } = await db.query<{ r: Mutated }>(
      `select public.admin_site_content_mutate($1, $2, $3, $4::jsonb, $5, $6) as r`,
      [entity, action, id, JSON.stringify(data), expected, ACTOR],
    );
    return rows[0]!.r;
  });

const banner = (over: Record<string, unknown> = {}) => ({
  image_id: IMG,
  alt: 'Cadernos coloridos',
  href: '/busca/?q=caderno',
  starts_at: null,
  ends_at: null,
  active: true,
  ...over,
});
const link = (over: Record<string, unknown> = {}) => ({
  label: 'Catálogo',
  href: 'https://exemplo.com.br/catalogo',
  active: true,
  ...over,
});
const updatedAt = async (table: string, id: string) =>
  (
    await db.query<{ u: string }>(
      `select updated_at::text as u from public.${table} where id = $1`,
      [id],
    )
  ).rows[0]!.u;

describe('RLS', () => {
  it('as duas tabelas têm RLS e nenhuma policy', async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
        where relname in ('banners', 'bio_links') and relkind = 'r' order by relname`,
    );
    expect(rows).toEqual([
      { relname: 'banners', relrowsecurity: true },
      { relname: 'bio_links', relrowsecurity: true },
    ]);
    const policies = await db.query(
      `select 1 from pg_policies where tablename in ('banners', 'bio_links')`,
    );
    expect(policies.rows).toEqual([]);
  });

  it('anon e cliente logado não leem, não gravam e não executam a função', async () => {
    await mutate('banners', 'create', null, banner());
    await mutate('bio_links', 'create', null, link());
    for (const [role, user] of [
      ['anon', null],
      ['authenticated', USER_A],
    ] as const) {
      for (const table of ['banners', 'bio_links']) {
        const read = await asRole(db, role, user, async () => {
          try {
            return (await db.query(`select * from public.${table}`)).rows;
          } catch {
            return 'negado';
          }
        });
        expect(read === 'negado' || (read as unknown[]).length === 0).toBe(true);
        await asRole(db, role, user, async () => {
          await expect(db.query(`delete from public.${table}`)).rejects.toThrow();
          await expect(db.query(`update public.${table} set active = false`)).rejects.toThrow();
        });
      }
      await asRole(db, role, user, async () => {
        await expect(
          db.query(
            `select public.admin_site_content_mutate('banners','create',null,'{}',null,$1)`,
            [ACTOR],
          ),
        ).rejects.toThrow(/permission denied/);
      });
    }
  });
});

describe('restrições da tabela', () => {
  const insertBanner = (href: string, alt = 'ok') =>
    db.query(`insert into public.banners (image_id, alt, href) values ($1, $2, $3)`, [
      IMG,
      alt,
      href,
    ]);

  it.each([
    'javascript:alert(1)',
    'http://exemplo.com',
    '//outro-site.com',
    '/\\outro-site.com',
    'https://',
    'https://u:p@exemplo.com',
    '/com espaço',
    'busca/',
  ])('recusa o destino %s', async (href) => {
    await expect(insertBanner(href)).rejects.toThrow();
  });

  it.each(['/', '/busca/?q=a', 'https://www.instagram.com/sparks_papelaria/'])(
    'aceita o destino %s',
    async (href) => {
      await insertBanner(href);
    },
  );

  it('exige texto alternativo', async () => {
    await expect(insertBanner('/', '   ')).rejects.toThrow();
  });

  it('o fim do período precisa ser depois do início', async () => {
    await expect(
      db.query(
        `insert into public.banners (image_id, alt, href, starts_at, ends_at)
         values ($1, 'a', '/', '2026-12-02T00:00:00Z', '2026-12-01T00:00:00Z')`,
        [IMG],
      ),
    ).rejects.toThrow();
  });
});

describe('admin_site_content_mutate', () => {
  it('cria no fim da lista, auditando só os nomes dos campos', async () => {
    const a = await mutate('banners', 'create', null, banner({ alt: 'Primeiro' }));
    const b = await mutate('banners', 'create', null, banner({ alt: 'Segundo' }));
    const { rows } = await db.query<{ id: string; position: number }>(
      `select id, position from public.banners order by position`,
    );
    expect(rows).toEqual([
      { id: a.id, position: 0 },
      { id: b.id, position: 1 },
    ]);
    const audit = await db.query<{ diff: { fields: string[] }; actor: string }>(
      `select actor, diff from public.audit_log where entity = 'banners' order by id desc limit 1`,
    );
    expect(audit.rows[0]!.actor).toBe(ACTOR);
    expect(audit.rows[0]!.diff.fields).toContain('alt');
    expect(JSON.stringify(audit.rows[0]!.diff)).not.toContain('Segundo');
  });

  it('respeita os limites (10 banners, 3 links)', async () => {
    for (let i = 0; i < 10; i++) await mutate('banners', 'create', null, banner());
    await expect(mutate('banners', 'create', null, banner())).rejects.toThrow('limit_reached');
    for (let i = 0; i < 3; i++) await mutate('bio_links', 'create', null, link());
    await expect(mutate('bio_links', 'create', null, link())).rejects.toThrow('limit_reached');
  });

  it('edita com a versão certa e recusa versão antiga', async () => {
    const { id } = await mutate('banners', 'create', null, banner());
    const first = await updatedAt('banners', id);
    await db.query(`select pg_sleep(0.01)`);
    await mutate('banners', 'update', id, banner({ alt: 'Novo texto', active: false }), first);
    const { rows } = await db.query<{ alt: string; active: boolean }>(
      `select alt, active from public.banners where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ alt: 'Novo texto', active: false });
    await expect(mutate('banners', 'update', id, banner({ alt: 'Velho' }), first)).rejects.toThrow(
      'content_changed',
    );
  });

  it('trocar a foto só acontece quando image_id vem preenchido', async () => {
    const { id } = await mutate('banners', 'create', null, banner());
    const NEW = '44444444-4444-4444-8444-444444444444';
    let v = await updatedAt('banners', id);
    await mutate('banners', 'update', id, banner({ image_id: null }), v);
    expect((await db.query(`select image_id from public.banners`)).rows[0]).toEqual({
      image_id: IMG,
    });
    await db.query(`select pg_sleep(0.01)`);
    v = await updatedAt('banners', id);
    await mutate('banners', 'update', id, banner({ image_id: NEW }), v);
    expect((await db.query(`select image_id from public.banners`)).rows[0]).toEqual({
      image_id: NEW,
    });
  });

  it('exclui com a versão certa', async () => {
    const { id } = await mutate('bio_links', 'create', null, link());
    const v = await updatedAt('bio_links', id);
    await expect(mutate('bio_links', 'delete', id, {}, '2020-01-01T00:00:00Z')).rejects.toThrow(
      'content_changed',
    );
    await mutate('bio_links', 'delete', id, {}, v);
    expect((await db.query(`select 1 from public.bio_links`)).rows).toEqual([]);
  });

  it('reordena exatamente o conjunto existente', async () => {
    const a = await mutate('bio_links', 'create', null, link({ label: 'A' }));
    const b = await mutate('bio_links', 'create', null, link({ label: 'B' }));
    const c = await mutate('bio_links', 'create', null, link({ label: 'C' }));
    await mutate('bio_links', 'reorder', null, { ids: [c.id, a.id, b.id] });
    const { rows } = await db.query<{ label: string }>(
      `select label from public.bio_links order by position`,
    );
    expect(rows.map((r) => r.label)).toEqual(['C', 'A', 'B']);
    // Lista incompleta, com item de outro lugar ou repetido: nada muda.
    await expect(mutate('bio_links', 'reorder', null, { ids: [a.id, b.id] })).rejects.toThrow(
      'content_changed',
    );
    await expect(
      mutate('bio_links', 'reorder', null, { ids: [a.id, a.id, b.id, c.id] }),
    ).rejects.toThrow('content_changed');
    await expect(mutate('bio_links', 'reorder', null, { ids: [a.id, b.id, IMG] })).rejects.toThrow(
      'content_changed',
    );
    const after = await db.query<{ label: string }>(
      `select label from public.bio_links order by position`,
    );
    expect(after.rows.map((r) => r.label)).toEqual(['C', 'A', 'B']);
  });

  it('recusa entidade e ação desconhecidas', async () => {
    await expect(mutate('products', 'create', null, {})).rejects.toThrow('content_invalid');
    await expect(mutate('banners', 'truncate', null, {})).rejects.toThrow('content_invalid');
  });

  it('o banco recusa destino inseguro mesmo vindo da função', async () => {
    await expect(
      mutate('banners', 'create', null, banner({ href: 'javascript:alert(1)' })),
    ).rejects.toThrow();
    await expect(
      mutate('bio_links', 'create', null, link({ href: 'http://exemplo.com' })),
    ).rejects.toThrow();
  });
});
