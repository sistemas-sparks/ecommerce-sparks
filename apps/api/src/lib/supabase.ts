// Cliente do Supabase com service_role: SÓ no Worker (R3.2). Nunca exponha esta chave.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { jwksSchema } from '@sparks/shared';
import type { Config } from '../env';
import type { JsonWebKeyWithKid } from '../types';

let cachedClient: { key: string; client: SupabaseClient } | null = null;

/** Um cliente por isolate (reaproveitado entre requisições), sem sessão nem refresh. */
export function getServiceClient(config: Config): SupabaseClient {
  const key = `${config.supabaseUrl}|${config.supabaseServiceRoleKey}`;
  if (cachedClient?.key !== key) {
    cachedClient = {
      key,
      client: createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
    };
  }
  return cachedClient.client;
}

/** Limite de requisições via função SQL atômica `rate_limit_hit` (supabase/migrations). */
export async function supabaseRateLimitHit(
  config: Config,
  key: string,
  windowSeconds: number,
  max: number,
): Promise<boolean> {
  const { data, error } = await getServiceClient(config).rpc('rate_limit_hit', {
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max: max,
  });
  if (error) throw new Error('rate_limit_hit falhou');
  return data === true;
}

const JWKS_TTL_MS = 10 * 60 * 1000;
// Renovação forçada (kid desconhecido) no máximo 1x por minuto: token com kid inventado não vira
// uma busca ao Supabase por requisição.
const JWKS_MIN_REFRESH_MS = 60 * 1000;
let jwksCache: {
  url: string;
  keys: JsonWebKeyWithKid[];
  expiresAt: number;
  fetchedAt: number;
} | null = null;

/** Chaves públicas do Supabase Auth, com cache de 10 minutos por isolate. */
export async function fetchSupabaseJwks(
  config: Config,
  opts: { refresh?: boolean } = {},
  fetchFn: typeof fetch = fetch,
): Promise<JsonWebKeyWithKid[]> {
  const url = `${config.supabaseUrl}/auth/v1/.well-known/jwks.json`;
  const now = Date.now();
  if (jwksCache?.url === url && jwksCache.expiresAt > now) {
    const recentlyFetched = now - jwksCache.fetchedAt < JWKS_MIN_REFRESH_MS;
    if (!opts.refresh || recentlyFetched) return jwksCache.keys;
  }
  const res = await fetchFn(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error('falha ao buscar JWKS');
  const body = jwksSchema.parse(await res.json());
  jwksCache = {
    url,
    keys: body.keys,
    expiresAt: now + JWKS_TTL_MS,
    fetchedAt: now,
  };
  return jwksCache.keys;
}
