import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, type Bindings } from './env';
import { testEnv } from './test-utils';

const env = (extra: Bindings = {}): Bindings => ({ ...testEnv, ...extra });
const UA = 'Sparks Papelaria (tecnico@exemplo.dev)';

describe('configuração do Melhor Envio', () => {
  it('sem token: null', () => {
    expect(loadConfig(env()).melhorEnvio).toBeNull();
  });
  it('com token usa sandbox por padrão', () => {
    expect(
      loadConfig(env({ MELHOR_ENVIO_TOKEN: 'abc', MELHOR_ENVIO_USER_AGENT: UA })).melhorEnvio,
    ).toEqual({ token: 'abc', baseUrl: 'https://sandbox.melhorenvio.com.br', userAgent: UA });
  });
  it('production usa o endereço real', () => {
    expect(
      loadConfig(
        env({
          MELHOR_ENVIO_TOKEN: 'abc',
          MELHOR_ENVIO_USER_AGENT: UA,
          MELHOR_ENVIO_ENV: 'production',
        }),
      ).melhorEnvio?.baseUrl,
    ).toBe('https://melhorenvio.com.br');
  });
  it('token sem user agent ou com user agent curto: ConfigError sem o valor', () => {
    for (const extra of [{}, { MELHOR_ENVIO_USER_AGENT: 'ab' }]) {
      const attempt = () => loadConfig(env({ MELHOR_ENVIO_TOKEN: 'token-x', ...extra }));
      expect(attempt).toThrow(ConfigError);
      expect(attempt).toThrow(/MELHOR_ENVIO_USER_AGENT/);
      expect(attempt).not.toThrow(/token-x/);
    }
  });
  it('env inválido: ConfigError', () => {
    expect(() =>
      loadConfig(
        env({
          MELHOR_ENVIO_TOKEN: 'abc',
          MELHOR_ENVIO_USER_AGENT: UA,
          MELHOR_ENVIO_ENV: 'staging',
        }),
      ),
    ).toThrow(/MELHOR_ENVIO_ENV/);
  });
});
