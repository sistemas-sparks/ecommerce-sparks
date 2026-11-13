import { z } from 'zod';

export const authClaimsSchema = z.object({
  sub: z.uuid(),
  exp: z.number().int(),
  email: z.string().optional(),
  aal: z.enum(['aal1', 'aal2']).optional(),
  app_metadata: z.looseObject({ role: z.string().optional() }).optional(),
});

// Chaves públicas: campos privados são descartados e nunca usados pelo verificador.
export const jwksSchema = z.object({
  keys: z
    .array(
      z.object({
        kid: z.string().min(1),
        kty: z.enum(['EC', 'RSA']),
        alg: z.enum(['ES256', 'RS256']).optional(),
        use: z.literal('sig').optional(),
        key_ops: z.array(z.literal('verify')).optional(),
        crv: z.string().optional(),
        x: z.string().optional(),
        y: z.string().optional(),
        n: z.string().optional(),
        e: z.string().optional(),
      }),
    )
    .max(100),
});

export const turnstileResponseSchema = z.object({ success: z.boolean() });

export const adminMeSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  aal: z.enum(['aal1', 'aal2']),
});

export const adminLoginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(1024),
});

/** Código de 6 dígitos do aplicativo autenticador (aceita espaços digitados no meio). */
export const totpCodeSchema = z
  .string()
  .max(20)
  .transform((value) => value.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/));

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string().max(100), message: z.string().max(1000) }),
});
