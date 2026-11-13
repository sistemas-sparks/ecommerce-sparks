// Configuração do Worker. Os valores vêm de `wrangler secret put` (produção) ou `.dev.vars` (local).
// Falha fechada: sem a configuração mínima, a API responde 503 e nunca loga os valores.
import { z } from 'zod';

/** Tudo que o Worker pode receber como variável ou secret (ver .env.example). */
export interface Bindings {
  SITE_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  CHECKOUT_ENABLED?: string;
  // Validados nas tarefas que os usam (T-010, T-014, T-015, T-018).
  MP_ACCESS_TOKEN?: string;
  MP_WEBHOOK_SECRET?: string;
  ORDER_TOKEN_PEPPER?: string;
  DEPLOY_HOOK_URL?: string;
  // Cotação de frete nacional (T-028). Sem token, o site usa só os fretes próprios.
  MELHOR_ENVIO_TOKEN?: string;
  MELHOR_ENVIO_ENV?: string;
  MELHOR_ENVIO_USER_AGENT?: string;
}

const originSchema = z.url().refine(
  (value) => {
    const url = new URL(value);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return (
      (url.protocol === 'https:' || (local && url.protocol === 'http:')) && url.pathname === '/'
    );
  },
  { error: 'origem deve ser https (ou http://localhost) sem caminho' },
);

const configSchema = z.object({
  // Uma ou mais origens do site, separadas por vírgula (ex.: domínio final + *.workers.dev de teste).
  SITE_URL: z
    .string()
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    )
    .pipe(z.array(originSchema).min(1))
    .transform((origins) => origins.map((o) => new URL(o).origin)),
  SUPABASE_URL: z.url({ protocol: /^https?$/ }).transform((v) => v.replace(/\/+$/, '')),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  CHECKOUT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

const optionalText = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    schema.optional(),
  );

const melhorEnvioSchema = z
  .object({
    MELHOR_ENVIO_TOKEN: optionalText(z.string().trim().min(1).max(4096)),
    MELHOR_ENVIO_ENV: optionalText(z.enum(['sandbox', 'production'])),
    MELHOR_ENVIO_USER_AGENT: optionalText(z.string().trim().min(5).max(200)),
  })
  .superRefine((v, ctx) => {
    if (v.MELHOR_ENVIO_TOKEN && !v.MELHOR_ENVIO_USER_AGENT)
      ctx.addIssue({ code: 'custom', path: ['MELHOR_ENVIO_USER_AGENT'], message: 'obrigatório' });
  });

const MELHOR_ENVIO_URLS = {
  sandbox: 'https://sandbox.melhorenvio.com.br',
  production: 'https://melhorenvio.com.br',
} as const;

export interface Config {
  siteOrigins: string[];
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  turnstileSecretKey: string;
  checkoutEnabled: boolean;
  /** null: sem token, só fretes próprios. */
  melhorEnvio: { token: string; baseUrl: string; userAgent: string } | null;
}

export class ConfigError extends Error {
  constructor(readonly fields: string[]) {
    super(`configuração inválida: ${fields.join(', ')}`);
    this.name = 'ConfigError';
  }
}

const cache = new WeakMap<object, Config>();

/** Valida as variáveis. A mensagem de erro cita só os NOMES dos campos, nunca os valores. */
export function loadConfig(env: Bindings): Config {
  const cached = cache.get(env);
  if (cached) return cached;

  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))];
    throw new ConfigError(fields);
  }
  const me = melhorEnvioSchema.safeParse(env);
  if (!me.success) {
    throw new ConfigError([...new Set(me.error.issues.map((i) => String(i.path[0] ?? '?')))]);
  }
  const { MELHOR_ENVIO_TOKEN: token, MELHOR_ENVIO_USER_AGENT: userAgent } = me.data;
  const config: Config = {
    siteOrigins: parsed.data.SITE_URL,
    supabaseUrl: parsed.data.SUPABASE_URL,
    supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY,
    turnstileSecretKey: parsed.data.TURNSTILE_SECRET_KEY,
    checkoutEnabled: parsed.data.CHECKOUT_ENABLED,
    melhorEnvio:
      token && userAgent
        ? { token, baseUrl: MELHOR_ENVIO_URLS[me.data.MELHOR_ENVIO_ENV ?? 'sandbox'], userAgent }
        : null,
  };
  cache.set(env, config);
  return config;
}
