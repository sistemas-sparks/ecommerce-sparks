// Passo final do build do site estático (T-023). Sem dependências e sem rede.
// 1) Troca {{API_ORIGIN}} e {{SUPABASE_ORIGIN}} em out/_headers pelas origens exatas (https).
// 2) Coloca em cada .html uma CSP (meta) com o hash SHA-256 de cada script embutido, que
//    restringe a CSP do cabeçalho (ela precisa de 'unsafe-inline' porque os dados da página vão
//    em scripts embutidos que mudam a cada build). As duas políticas valem ao mesmo tempo.
// Uso: node scripts/harden-export.mjs [--strict]   (--strict falha se faltar alguma origem)
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const META_ATTR = 'data-sparks-csp';
const INLINE_SCRIPT = /<script((?:\s[^>]*)?)>([\s\S]*?)<\/script>/gi;
// VLibras (Governo Federal, decisão do Rafael em 2026-11-12): origens que o script do plugin pode
// usar. Entram na CSP por hash só das páginas públicas; o /admin fica sem elas (script bloqueado).
const VLIBRAS_SCRIPT_SOURCES = [
  "'wasm-unsafe-eval'",
  'https://vlibras.gov.br',
  'https://*.vlibras.gov.br',
  'https://cdn.jsdelivr.net/gh/spbgovbr-vlibras/',
];
const NON_EXECUTABLE_TYPES = new Set(['application/ld+json', 'application/json', 'importmap']);

/** Origem https de uma URL (sem caminho), ou null se não for https válida. */
export function httpsOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** Hashes (CSP, sha256) dos scripts embutidos que o navegador executa. */
export function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const [, rawAttributes, body] of html.matchAll(INLINE_SCRIPT)) {
    const attributes = ` ${rawAttributes}`;
    if (/\ssrc\s*=/i.test(attributes)) continue;
    const type = /\stype\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1]?.toLowerCase();
    if (type && NON_EXECUTABLE_TYPES.has(type)) continue;
    if (!body.trim()) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return [...hashes].sort();
}

/** Páginas do painel (admin.html ou admin/...): lá o VLibras não é liberado. */
export function isAdminPage(relativePath) {
  return /^admin(\/|\.html$)/.test(relativePath.split(path.sep).join('/'));
}

/**
 * Põe (ou troca) a CSP por hash logo no começo do <head>. Sem <head>, devolve o HTML como veio.
 * Com { libras: true } (páginas públicas), libera também o script do VLibras.
 */
export function injectScriptHashCsp(html, { libras = false } = {}) {
  const policy = [
    "script-src 'self'",
    ...inlineScriptHashes(html),
    'https://challenges.cloudflare.com',
    ...(libras ? VLIBRAS_SCRIPT_SOURCES : []),
  ].join(' ');
  const meta = `<meta http-equiv="Content-Security-Policy" ${META_ATTR} content="${policy}"/>`;
  const cleaned = html.replace(new RegExp(`<meta [^>]*${META_ATTR}[^>]*>`, 'gi'), '');
  const head = /<head(\s[^>]*)?>/i.exec(cleaned);
  if (!head) return html;
  const end = head.index + head[0].length;
  return cleaned.slice(0, end) + meta + cleaned.slice(end);
}

/** Preenche os marcadores do _headers. Origem ausente ou fora de https some do arquivo. */
export function fillHeaders(template, { apiUrl, supabaseUrl }) {
  const api = httpsOrigin(apiUrl);
  const supabase = httpsOrigin(supabaseUrl);
  const text = template
    .replaceAll('{{API_ORIGIN}}', api ?? '')
    .replaceAll('{{SUPABASE_ORIGIN}}', supabase ?? '')
    .split('\n')
    // Junta espaços repetidos no meio da linha (onde um marcador sumiu), sem mexer no recuo.
    .map((line) =>
      line
        .replace(/(\S) {2,}/g, '$1 ')
        .replace(/ +;/g, ';')
        .replace(/ +$/, ''),
    )
    .join('\n');
  const missing = [];
  if (!api) missing.push('NEXT_PUBLIC_API_URL');
  if (!supabase) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  return { text, missing };
}

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

export async function hardenExport(outDir, env = process.env, { strict = false } = {}) {
  const headersFile = path.join(outDir, '_headers');
  const template = await readFile(headersFile, 'utf8');
  const { text, missing } = fillHeaders(template, {
    apiUrl: env.NEXT_PUBLIC_API_URL,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
  });
  if (missing.length > 0) {
    const message = `origem https ausente para ${missing.join(', ')}; a CSP ficará sem esse endereço.`;
    if (strict) throw new Error(message);
    console.warn(`[harden-export] AVISO: ${message}`);
  }
  await writeFile(headersFile, text);

  let pages = 0;
  for await (const file of walk(outDir)) {
    if (!file.endsWith('.html')) continue;
    const html = await readFile(file, 'utf8');
    const next = injectScriptHashCsp(html, {
      libras: !isAdminPage(path.relative(outDir, file)),
    });
    if (next !== html) await writeFile(file, next);
    pages += 1;
  }
  return { pages, missing };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../out');
  hardenExport(outDir, process.env, { strict: process.argv.includes('--strict') }).then(
    ({ pages }) =>
      console.log(`[harden-export] _headers preenchido; CSP por hash em ${pages} página(s).`),
    (error) => {
      console.error(`[harden-export] ${error.message}`);
      process.exit(1);
    },
  );
}
