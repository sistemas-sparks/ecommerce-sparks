import { z } from 'zod';

// prettier-ignore
export const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const;
export type UF = (typeof UFS)[number];

// Caracteres de controle (exceto quebra de linha, tratada à parte onde é permitida).
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_OR_NEWLINE = /[\u0000-\u001F\u007F-\u009F]/;

/** Conta caracteres visíveis como o usuário vê (um emoji conta como 1). */
export function textLength(value: string): number {
  return [...value].length;
}

/** Texto de uma linha, com espaços aparados e sem caracteres de controle. */
export function singleLineText(min: number, max: number, field: string) {
  return z
    .string({ error: `${field} é obrigatório.` })
    .trim()
    .refine((v) => !CONTROL_CHARS_OR_NEWLINE.test(v), {
      error: `${field} tem caracteres inválidos.`,
    })
    .refine((v) => textLength(v) >= min, {
      error:
        min <= 1 ? `${field} é obrigatório.` : `${field} precisa ter pelo menos ${min} caracteres.`,
    })
    .refine((v) => textLength(v) <= max, {
      error: `${field} pode ter no máximo ${max} caracteres.`,
    });
}

/** CEP: aceita "49000-000", "49000000" ou "49.000-000" e devolve 8 dígitos. */
export const cepSchema = z
  .string({ error: 'Informe o CEP.' })
  .trim()
  .transform((v) => v.replace(/[.\-\s]/g, ''))
  .pipe(z.string().regex(/^\d{8}$/, { error: 'CEP não encontrado, confira o número.' }));

/**
 * WhatsApp brasileiro: DDD + número (10 ou 11 dígitos), com ou sem máscara e +55.
 * Devolve só os dígitos, sem o 55.
 */
export const whatsappSchema = z
  .string({ error: 'Informe o WhatsApp.' })
  .trim()
  .transform((v) => {
    const digits = v.replace(/\D/g, '');
    return digits.length >= 12 && digits.startsWith('55') ? digits.slice(2) : digits;
  })
  .pipe(z.string().regex(/^[1-9][1-9]9?\d{8}$/, { error: 'WhatsApp inválido. Use DDD + número.' }));

export const ufSchema = z.enum(UFS, { error: 'Estado (UF) inválido.' });

export const uuidSchema = z.uuid({ error: 'Identificador inválido.' });

/** E-mail opcional: string vazia vira undefined. */
export const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (v === '' ? undefined : v))
  .pipe(z.email({ error: 'E-mail inválido.' }).max(254).optional())
  .optional();

export const turnstileTokenSchema = z
  .string({ error: 'Confirme que você não é um robô.' })
  .min(1, { error: 'Confirme que você não é um robô.' })
  .max(2048);
