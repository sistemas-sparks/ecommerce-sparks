// Cliente do Supabase no navegador, com a chave pública (anon). Toda autorização é feita na API.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicConfig } from './public-config';

let client: SupabaseClient | null = null;

/** Devolve null quando o site foi gerado sem as variáveis do Supabase. */
export function getSupabase(): SupabaseClient | null {
  if (!publicConfig.supabaseUrl || !publicConfig.supabaseAnonKey) return null;
  client ??= createClient(publicConfig.supabaseUrl, publicConfig.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      // Login do cliente com Google (T-018): o retorno traz ?code=, trocado em Minha conta.
      flowType: 'pkce',
      storageKey: 'sparks-auth',
    },
  });
  return client;
}
