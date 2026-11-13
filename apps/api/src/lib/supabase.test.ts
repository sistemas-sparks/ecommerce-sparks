import { describe, expect, it } from 'vitest';
import { loadConfig } from '../env';
import { createTestKey, testEnv } from '../test-utils';
import { fetchSupabaseJwks } from './supabase';

describe('JWKS externo', () => {
  it.each([null, { keys: [null] }, { keys: [{ kid: 'x', kty: 'oct', k: 'secret' }] }])(
    'recusa resposta malformada ou chave simétrica: %j',
    async (body) => {
      await expect(
        fetchSupabaseJwks(loadConfig(testEnv), {}, async () => Response.json(body)),
      ).rejects.toThrow();
    },
  );

  it('aceita chave pública e descarta material privado', async () => {
    const key = await createTestKey();
    const keys = await fetchSupabaseJwks(loadConfig(testEnv), {}, async () =>
      Response.json({
        keys: [{ ...key.publicJwk, d: 'private-material' }],
      }),
    );
    expect(keys[0]?.kid).toBe(key.publicJwk.kid);
    expect(keys[0]).not.toHaveProperty('d');
  });
});
