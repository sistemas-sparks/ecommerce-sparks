import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

// Só lógica pura e chamadas à API simuladas (fetch falso): sem navegador e sem rede.
export default defineProject({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'web',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // O primeiro import de @sparks/shared (zod) é lento em máquinas lentas.
    testTimeout: 20_000,
  },
});
