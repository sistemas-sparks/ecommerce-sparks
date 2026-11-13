import prettier from 'eslint-config-prettier/flat';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // R3.5: proibido injetar HTML vindo de usuário ou banco.
      'react/no-danger': 'error',
    },
  },
  prettier,
  globalIgnores(['.next/**', 'out/**', 'next-env.d.ts']),
]);
