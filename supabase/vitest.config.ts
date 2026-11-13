import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'db',
    // O PGlite (WASM) derruba o worker no modo forks no Windows; threads funciona.
    pool: 'threads',
    environment: 'node',
    // Cada arquivo sobe um Postgres embutido (PGlite) e aplica as migrations.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
