// Cliente do Melhor Envio: SÓ cotação (R2.5). Nunca lança; falha vira { ok: false, reason }.
// O token fica só aqui (secret do Worker) e nunca entra em log. Logs sem CEP nem corpo (R3.7).
import {
  melhorEnvioCalculateRequestSchema,
  melhorEnvioCalculateResponseSchema,
  type MelhorEnvioCalculateRequest,
  type MelhorEnvioFailure,
  type MelhorEnvioResult,
} from '@sparks/shared';

export interface MelhorEnvioClient {
  calculate(request: MelhorEnvioCalculateRequest): Promise<MelhorEnvioResult>;
}

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 256 * 1024;

class BodyTooLarge extends Error {}

async function readLimitedText(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export function createMelhorEnvioClient(opts: {
  token: string;
  baseUrl: string;
  userAgent: string;
  fetch: typeof fetch;
  timeoutMs?: number;
}): MelhorEnvioClient {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/api/v2/me/shipment/calculate`;

  const fail = (reason: MelhorEnvioFailure, status?: number): MelhorEnvioResult => {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'melhor_envio_failed',
        reason,
        ...(status !== undefined ? { status } : {}),
      }),
    );
    return { ok: false, reason };
  };

  return {
    async calculate(request) {
      const body = melhorEnvioCalculateRequestSchema.safeParse(request);
      if (!body.success) return fail('invalid_response');

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        let response: Response;
        try {
          response = await opts.fetch(url, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${opts.token}`,
              'User-Agent': opts.userAgent,
            },
            body: JSON.stringify(body.data),
            redirect: 'error',
            signal: controller.signal,
          });
        } catch {
          return fail(timedOut ? 'timeout' : 'network');
        }
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel().catch(() => undefined);
          return fail('unauthorized', response.status);
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          return fail('http_error', response.status);
        }
        let text: string;
        try {
          text = await readLimitedText(response);
        } catch (error) {
          if (error instanceof BodyTooLarge) return fail('invalid_response', response.status);
          return fail(timedOut ? 'timeout' : 'network');
        }
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          return fail('invalid_response', response.status);
        }
        const parsed = melhorEnvioCalculateResponseSchema.safeParse(json);
        if (!parsed.success) return fail('invalid_response', response.status);
        return { ok: true, items: parsed.data };
      } catch {
        return fail('network');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
