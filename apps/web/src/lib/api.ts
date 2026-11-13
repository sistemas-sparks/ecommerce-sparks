// Chamadas à API (Worker). Erros chegam como { error: { code, message } } com mensagem em português.
import { publicConfig } from './public-config';
import { apiErrorSchema } from '@sparks/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const NETWORK_MESSAGE = 'Sem conexão com a loja. Confira a internet e tente de novo.';

export async function apiFetch(
  path: string,
  { token, ...init }: RequestInit & { token?: string } = {},
): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(`${publicConfig.apiUrl}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'network', NETWORK_MESSAGE);
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    const error = parsed.success ? parsed.data.error : null;
    throw new ApiError(
      res.status,
      error?.code ?? 'unknown',
      error?.message ?? 'Algo deu errado. Tente de novo em instantes.',
    );
  }
  return body;
}
