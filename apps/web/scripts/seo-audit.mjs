// Auditoria de SEO local e somente leitura do site estático gerado (apps/web/out).
// Sem rede e sem dependências. Uso (na raiz): pnpm --filter @sparks/web seo:audit [-- --site-url https://dominio]
// Opções: --dir <pasta do build> · --site-url <origem do site> · --json <arquivo> · --strict (P1 também falha)
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const outDir = path.resolve(opt('--dir', path.join(here, '..', 'out')));
const siteUrl = opt('--site-url', '').replace(/\/+$/, '');
const jsonPath = path.resolve(
  opt('--json', path.join(here, '..', '..', '..', '.coordenacao', 'seo', 'auditoria.json')),
);
const strict = args.includes('--strict');

// Rotas que não podem ser indexadas (docs/seo.md §3). /busca fica como decisão pendente.
const PRIVATE = ['/admin', '/sacola', '/checkout', '/pedido', '/minha-conta', '/consultar-pedido'];
const DECIDE = ['/busca'];
// Políticas com texto ainda [A DEFINIR]: noindex temporário (POLICY_PAGES_INDEXABLE em src/lib/seo.ts).
const PENDING_TEXT = ['/politicas'];
const TITLE = [15, 65];
const DESC = [70, 160];

const issues = [];
const add = (sev, page, rule, msg) => issues.push({ sev, page, rule, msg });

const exists = (p) =>
  stat(p).then(
    () => true,
    () => false,
  );

async function walk(dir, base = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('_') || e.name.startsWith('__next')) continue;
    const rel = path.posix.join(base, e.name);
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), rel)));
    else if (e.name.endsWith('.html')) out.push(rel);
  }
  return out;
}

const urlOf = (file) => {
  if (file === 'index.html') return '/';
  if (file.endsWith('/index.html')) return '/' + file.slice(0, -'index.html'.length);
  return '/' + file.slice(0, -'.html'.length);
};
const under = (url, list) => list.some((p) => url === p || url.startsWith(p + '/'));
const attrs = (tag) => {
  const o = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    o[m[1].toLowerCase()] = m[2] ?? m[3];
  return o;
};
const metas = (html) => [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
const clean = (s) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

function ldTypes(node, acc = []) {
  if (Array.isArray(node)) node.forEach((n) => ldTypes(n, acc));
  else if (node && typeof node === 'object') {
    if (node['@type']) acc.push(...[].concat(node['@type']));
    if (node['@graph']) ldTypes(node['@graph'], acc);
  }
  return acc;
}

async function resolves(href) {
  const p = decodeURIComponent(href.split('#')[0].split('?')[0]);
  if (!p) return true;
  const base = path.join(outDir, p);
  const cands = p.endsWith('/')
    ? [path.join(base, 'index.html')]
    : [base, base + '.html', path.join(base, 'index.html')];
  for (const c of cands) if (await exists(c)) return true;
  return false;
}

async function main() {
  if (!(await exists(outDir))) {
    console.error(
      `Pasta do build não encontrada: ${outDir}\nRode antes: pnpm --filter @sparks/web build`,
    );
    process.exit(2);
  }
  const files = (await walk(outDir)).filter((f) => !f.startsWith('admin/'));
  const adminFiles = (await walk(outDir)).filter((f) => f.startsWith('admin/'));
  const pages = [];
  const titles = new Map();
  const descs = new Map();

  for (const file of [...files, ...adminFiles]) {
    const url = urlOf(file);
    const html = await readFile(path.join(outDir, file), 'utf8');
    const ms = metas(html);
    const meta = (k) => ms.find((m) => m.name === k || m.property === k)?.content;
    const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    const desc = meta('description') ?? '';
    const robots = (meta('robots') ?? '').toLowerCase();
    const noindex = robots.includes('noindex');
    const canonical = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i);
    const canonicalHref = canonical ? attrs(canonical[0]).href : undefined;
    const isPrivate = under(url, PRIVATE);
    const is404 = file === '404.html' || file === '404/index.html';
    const page = { url, file, title, noindex, indexable: !noindex && !isPrivate && !is404 };
    pages.push(page);

    if (isPrivate) {
      if (!noindex) add('P0', url, 'private-noindex', 'Página privada sem noindex (robots meta).');
      continue;
    }
    if (is404) continue;
    if (noindex) {
      add(
        under(url.replace(/\/$/, ''), [...DECIDE, ...PENDING_TEXT]) ? 'P2' : 'P0',
        url,
        'public-noindex',
        'Página pública com noindex.',
      );
      continue;
    }
    if (under(url, DECIDE))
      add(
        'P2',
        url,
        'decide-busca',
        'Resultados de busca interna indexáveis: decidir com o Rafael se levam noindex.',
      );

    if (!title) add('P0', url, 'title', 'Sem <title>.');
    else if (title.length < TITLE[0] || title.length > TITLE[1])
      add(
        'P2',
        url,
        'title-length',
        `Title com ${title.length} caracteres (ideal ${TITLE[0]}-${TITLE[1]}).`,
      );
    if (!desc) add('P1', url, 'description', 'Sem meta description.');
    else if (desc.length < DESC[0] || desc.length > DESC[1])
      add(
        'P2',
        url,
        'description-length',
        `Description com ${desc.length} caracteres (ideal ${DESC[0]}-${DESC[1]}).`,
      );
    if (title) titles.set(title, [...(titles.get(title) ?? []), url]);
    if (desc) descs.set(desc, [...(descs.get(desc) ?? []), url]);

    if (!canonicalHref) add('P1', url, 'canonical', 'Sem link canonical.');
    else if (!/^https:\/\//.test(canonicalHref))
      add('P1', url, 'canonical-abs', `Canonical não é URL absoluta https: ${canonicalHref}`);
    else if (siteUrl && !canonicalHref.startsWith(siteUrl + '/') && canonicalHref !== siteUrl)
      add('P1', url, 'canonical-origin', `Canonical fora de ${siteUrl}: ${canonicalHref}`);

    const lang = html.match(/<html\b[^>]*\blang=["']([^"']+)["']/i)?.[1];
    if (!lang || !/^pt/i.test(lang))
      add('P1', url, 'lang', `Atributo lang do <html> é "${lang ?? 'ausente'}" (esperado pt-BR).`);
    const h1 = (html.match(/<h1[\s>]/gi) ?? []).length;
    if (h1 !== 1) add('P1', url, 'h1', `${h1} elementos <h1> (esperado 1).`);

    for (const k of ['og:title', 'og:description', 'og:image', 'og:url'])
      if (!meta(k)) add('P1', url, 'open-graph', `Falta ${k}.`);
    if (!meta('twitter:card')) add('P1', url, 'twitter-card', 'Falta twitter:card.');
    const og = meta('og:image');
    if (og) {
      const p = og.replace(/^https?:\/\/[^/]+/, '');
      if (p.startsWith('/') && !(await exists(path.join(outDir, p))))
        add('P1', url, 'og-image-file', `og:image não existe no build: ${p}`);
    }

    const types = [];
    for (const m of html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    )) {
      try {
        ldTypes(JSON.parse(m[1]), types);
      } catch {
        add('P0', url, 'jsonld-invalid', 'JSON-LD com JSON inválido.');
      }
    }
    page.types = types;
    if (url === '/' && !types.includes('WebSite'))
      add('P1', url, 'jsonld-website', 'Home sem JSON-LD WebSite.');
    if (
      url === '/' &&
      !types.some((t) => t === 'Store' || t === 'LocalBusiness' || t === 'Organization')
    )
      add('P1', url, 'jsonld-store', 'Home sem JSON-LD Store/Organization.');
    if (url.startsWith('/produto/') && !types.includes('Product'))
      add('P1', url, 'jsonld-product', 'Produto sem JSON-LD Product.');
    if (
      (url.startsWith('/produto/') || url.startsWith('/categoria/')) &&
      !types.includes('BreadcrumbList')
    )
      add('P2', url, 'jsonld-breadcrumb', 'Sem JSON-LD BreadcrumbList.');

    const noAlt = [...html.matchAll(/<img\b[^>]*>/gi)].filter(
      (m) => !('alt' in attrs(m[0])),
    ).length;
    if (noAlt) add('P1', url, 'img-alt', `${noAlt} imagem(ns) sem atributo alt.`);

    const broken = new Set();
    for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) {
      const href = m[1];
      if (!href.startsWith('/') || href.startsWith('//')) continue;
      if (!(await resolves(href))) broken.add(href);
    }
    for (const href of broken)
      add('P1', url, 'broken-link', `Link interno sem página no build: ${href}`);
  }

  for (const [t, urls] of titles)
    if (urls.length > 1) add('P1', urls.join(', '), 'title-duplicate', `Title repetido: "${t}"`);
  for (const urls of descs.values())
    if (urls.length > 1)
      add(
        'P1',
        urls.join(', '),
        'description-duplicate',
        `Description repetida em ${urls.length} páginas.`,
      );

  // robots.txt e sitemap.xml
  const robotsFile = path.join(outDir, 'robots.txt');
  if (!(await exists(robotsFile)))
    add('P0', '/robots.txt', 'robots', 'robots.txt ausente no build.');
  else {
    const r = await readFile(robotsFile, 'utf8');
    if (/user-agent:\s*\*[\s\S]*?\ndisallow:\s*\/\s*(\n|$)/i.test(r))
      add('P0', '/robots.txt', 'robots-block', 'robots.txt bloqueia o site inteiro (Disallow: /).');
    if (!/^sitemap:\s*https?:\/\//im.test(r))
      add('P1', '/robots.txt', 'robots-sitemap', 'robots.txt sem a linha Sitemap: (URL absoluta).');
  }
  const sitemapFile = path.join(outDir, 'sitemap.xml');
  let sitemapCount = 0;
  if (!(await exists(sitemapFile)))
    add('P0', '/sitemap.xml', 'sitemap', 'sitemap.xml ausente no build.');
  else {
    const x = await readFile(sitemapFile, 'utf8');
    const inMap = new Set();
    for (const m of x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      sitemapCount++;
      const p = m[1].replace(/^https?:\/\/[^/]+/, '') || '/';
      inMap.add(p.endsWith('/') || p === '/' ? p : p + '/');
      const pg = pages.find((q) => q.url === p || q.url === p + '/' || q.url + '/' === p);
      if (!pg) add('P1', '/sitemap.xml', 'sitemap-url', `URL do sitemap sem página no build: ${p}`);
      else if (!pg.indexable)
        add('P0', '/sitemap.xml', 'sitemap-noindex', `Sitemap lista página não indexável: ${p}`);
    }
    for (const pg of pages.filter((q) => q.indexable && !under(q.url, DECIDE))) {
      const k = pg.url.endsWith('/') ? pg.url : pg.url + '/';
      if (!inMap.has(k))
        add(
          'P2',
          pg.url,
          'not-in-sitemap',
          'Página indexável fora do sitemap (confirmar se é decisão).',
        );
    }
  }
  for (const f of ['favicon.png', 'apple-touch-icon.png', 'site.webmanifest']) {
    if (!(await exists(path.join(outDir, f))))
      add('P1', `/${f}`, 'asset', `Arquivo ausente no build: ${f}`);
  }

  const order = { P0: 0, P1: 1, P2: 2 };
  issues.sort((a, b) => order[a.sev] - order[b.sev] || a.page.localeCompare(b.page));
  const count = (s) => issues.filter((i) => i.sev === s).length;
  const summary = {
    checkedAt: new Date().toISOString(),
    outDir,
    siteUrl: siteUrl || null,
    pages: pages.length,
    indexable: pages.filter((p) => p.indexable).length,
    sitemapUrls: sitemapCount,
    P0: count('P0'),
    P1: count('P1'),
    P2: count('P2'),
  };

  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, JSON.stringify({ summary, issues }, null, 2));

  console.log(
    `Auditoria SEO local: ${summary.pages} páginas (${summary.indexable} indexáveis), ${summary.sitemapUrls} URLs no sitemap`,
  );
  console.log(
    `P0: ${summary.P0} · P1: ${summary.P1} · P2: ${summary.P2}  →  ${path.relative(process.cwd(), jsonPath)}`,
  );
  for (const i of issues.filter((x) => x.sev !== 'P2' || issues.length < 40))
    console.log(`${i.sev} ${i.page} [${i.rule}] ${i.msg}`);
  if (issues.some((i) => i.sev === 'P2') && issues.length >= 40)
    console.log('(P2 omitidos no terminal; veja o JSON)');
  process.exit(summary.P0 > 0 || (strict && summary.P1 > 0) ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
