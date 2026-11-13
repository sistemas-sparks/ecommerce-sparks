// Liga o login do cliente ao cliente real do Supabase no navegador.
import { getSupabase } from '@/lib/supabase';
import { createCustomerAuth, type CustomerAuth } from './customer-auth';

// O acesso precisa ser literal para o Next embutir o valor no build.
const GOOGLE_LOGIN_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED === 'true';

let shared: CustomerAuth | null = null;
/** Login do cliente no navegador (sessão guardada pelo Supabase, sem segredos nossos). */
export function getCustomerAuth(): CustomerAuth {
  shared ??= createCustomerAuth(getSupabase(), GOOGLE_LOGIN_ENABLED);
  return shared;
}
