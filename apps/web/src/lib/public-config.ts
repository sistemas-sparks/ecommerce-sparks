// Configuração pública do navegador. Só variáveis NEXT_PUBLIC_* (nunca segredos aqui).
// O acesso precisa ser literal (process.env.NEXT_PUBLIC_X) para o Next embutir o valor no build.
export const publicConfig = {
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, ''),
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '',
};

/** Nomes das variáveis que faltam para o painel funcionar. */
export function missingAdminConfig(): string[] {
  const missing: string[] = [];
  if (!publicConfig.apiUrl) missing.push('NEXT_PUBLIC_API_URL');
  if (!publicConfig.supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!publicConfig.supabaseAnonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!publicConfig.turnstileSiteKey) missing.push('NEXT_PUBLIC_TURNSTILE_SITE_KEY');
  return missing;
}
