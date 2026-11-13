// Utilidades só para testes: ambiente válido, chaves JWT e tokens assinados.
import { Jwt } from 'hono/utils/jwt';
import type { Bindings } from './env';
import type { JsonWebKeyWithKid } from './types';

export const SUPABASE_URL = 'https://projeto-teste.supabase.co';
export const SITE_ORIGIN = 'https://loja.teste';

export const testEnv: Bindings = {
  SITE_URL: `${SITE_ORIGIN}, http://localhost:3000`,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-teste-nao-e-segredo',
  TURNSTILE_SECRET_KEY: 'turnstile-de-teste',
};

export interface TestKey {
  kid: string;
  privateJwk: JsonWebKeyWithKid;
  publicJwk: JsonWebKeyWithKid;
}

export async function createTestKey(kid = 'chave-teste'): Promise<TestKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const publicJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return {
    kid,
    privateJwk: { ...privateJwk, kid, alg: 'ES256' },
    publicJwk: { ...publicJwk, kid, alg: 'ES256' },
  };
}

export const USER_ID = '00000000-0000-4000-8000-0000000000aa';

export async function signToken(
  key: TestKey,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return Jwt.sign(
    {
      sub: USER_ID,
      iss: `${SUPABASE_URL}/auth/v1`,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'pessoa@teste.dev',
      aal: 'aal1',
      iat: now,
      exp: now + 3600,
      app_metadata: {},
      ...overrides,
    },
    key.privateJwk,
    'ES256',
  );
}
