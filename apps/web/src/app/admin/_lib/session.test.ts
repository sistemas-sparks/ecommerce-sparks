import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// API simulada: o fetch é falso e nenhuma rede é usada.
const fetchMock = vi.fn<typeof fetch>();
const ME = { id: '00000000-0000-4000-8000-0000000000aa', email: 'a@b.dev', aal: 'aal2' };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const apiError = (status: number, code: string) =>
  json({ error: { code, message: 'mensagem' } }, status);

async function load() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.test');
  return import('./session');
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('resolveAdminAccess', () => {
  it('admin com duas etapas: pronto', async () => {
    fetchMock.mockResolvedValue(json(ME));
    const { resolveAdminAccess } = await load();
    expect(await resolveAdminAccess('tok')).toEqual({ state: 'ready', me: ME });
  });

  it('403 mfa_required: falta a segunda etapa', async () => {
    fetchMock.mockResolvedValue(apiError(403, 'mfa_required'));
    const { resolveAdminAccess } = await load();
    expect(await resolveAdminAccess('tok')).toEqual({ state: 'mfa' });
  });

  it('403 forbidden (não é admin) sobe o erro e não abre a segunda etapa', async () => {
    fetchMock.mockResolvedValue(apiError(403, 'forbidden'));
    const { resolveAdminAccess } = await load();
    await expect(resolveAdminAccess('tok')).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
  });

  it('401 sobe o erro', async () => {
    fetchMock.mockResolvedValue(apiError(401, 'unauthorized'));
    const { resolveAdminAccess } = await load();
    await expect(resolveAdminAccess('tok')).rejects.toMatchObject({ status: 401 });
  });
});
