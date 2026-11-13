import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface ApiErrorBody {
  error: { code: string; message: string };
}

/** Erro com resposta JSON padronizada e mensagem em português, segura para mostrar ao cliente. */
export function apiError(
  status: ContentfulStatusCode,
  code: string,
  message: string,
  headers?: Record<string, string>,
): HTTPException {
  const body: ApiErrorBody = { error: { code, message } };
  return new HTTPException(status, {
    res: new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
    }),
  });
}

export const MESSAGES = {
  unavailable: 'Serviço temporariamente indisponível. Tente de novo em instantes.',
  internal: 'Algo deu errado. Tente de novo em instantes.',
  notFound: 'Não encontrado.',
  unauthorized: 'Faça login para continuar.',
  forbidden: 'Você não tem permissão para isso.',
  mfaRequired: 'Confirme o código do aplicativo autenticador para continuar.',
  tooMany: 'Muitas tentativas. Aguarde um pouco e tente de novo.',
  turnstile:
    'Não foi possível confirmar que você não é um robô. Recarregue a página e tente de novo.',
  checkoutPaused: 'As compras estão pausadas no momento. Tente de novo mais tarde.',
  payloadTooLarge: 'Dados grandes demais.',
} as const;
