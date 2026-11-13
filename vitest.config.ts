import { defineConfig } from 'vitest/config';

// Cada pacote com testes tem o próprio vitest.config.ts; a raiz só agrega.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/api', 'apps/web', 'supabase'],
  },
});
