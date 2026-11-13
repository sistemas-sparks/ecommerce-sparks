// T-010 · Roda antes do `next build`: baixa o catálogo público da API (GET /catalog/snapshot) e grava
// o snapshot que a vitrine usa (src/app/(site)/_data/catalog.json). O `next build` valida o arquivo
// com publicCatalogSchema; aqui só se garante que a resposta veio inteira.
//
// Regras de SPARKS_CATALOG_URL:
// 1. Ausente ou vazia em CI (CI definido, diferente de false/0) ou com NODE_ENV=production: o build
//    aborta, para nunca publicar um site com catálogo vazio ou pela metade.
// 2. Valor `local`: usa o catalog.json atual de propósito, em qualquer ambiente.
// 3. Ausente fora de CI/produção (desenvolvimento local): mantém o catalog.json atual, com aviso.
// Qualquer outro valor é a URL de download (https, ou http://localhost); qualquer falha interrompe
// o build.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../src/app/(site)/_data/catalog.json', import.meta.url));
const source = process.env.SPARKS_CATALOG_URL;

const ci = (process.env.CI ?? '').trim().toLowerCase();
const isCi = ci !== '' && ci !== 'false' && ci !== '0';

if (source === 'local') {
  console.log('[catálogo] SPARKS_CATALOG_URL=local: usando o catálogo local de propósito.');
  process.exit(0);
}

if (!source) {
  if (isCi || process.env.NODE_ENV === 'production') {
    console.error(
      '[catálogo] SPARKS_CATALOG_URL não definida no build de produção/CI. Defina a URL da API ou use SPARKS_CATALOG_URL=local para usar o catálogo local de propósito.',
    );
    process.exit(1);
  }
  console.log('[catálogo] SPARKS_CATALOG_URL não definida: usando o catálogo local.');
  process.exit(0);
}

const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(source);
if (!source.startsWith('https://') && !local) {
  console.error('[catálogo] SPARKS_CATALOG_URL precisa ser https (ou http://localhost).');
  process.exit(1);
}

try {
  const res = await fetch(source, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`a API respondeu ${res.status}`);
  const catalog = await res.json();
  if (!catalog || !Array.isArray(catalog.categories) || !Array.isArray(catalog.products)) {
    throw new Error('resposta sem categorias ou produtos');
  }
  await writeFile(target, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(
    `[catálogo] ${catalog.products.length} produtos e ${catalog.categories.length} categorias.`,
  );
} catch (err) {
  console.error(`[catálogo] Não foi possível baixar o catálogo: ${err.message}`);
  process.exit(1);
}
