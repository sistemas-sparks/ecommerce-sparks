import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'api',
    environment: 'node',
    // Margem para máquinas lentas: o primeiro teste paga o carregamento dos módulos
    // enquanto os testes do banco (PGlite) rodam em paralelo.
    testTimeout: 15_000,
  },
});
