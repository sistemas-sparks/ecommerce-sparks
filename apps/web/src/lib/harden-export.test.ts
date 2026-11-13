import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fillHeaders,
  hardenExport,
  httpsOrigin,
  injectScriptHashCsp,
  isAdminPage,
  inlineScriptHashes,
} from '../../scripts/harden-export.mjs';

const sha = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
const PAGE =
  '<!DOCTYPE html><html><head><meta charSet="utf-8"/><title>x</title></head><body>' +
  '<script src="/_next/a.js" async=""></script>' +
  '<script>self.__next_f.push([1,"abc"])</script>' +
  '<script id="_R_">(globalThis.T=[]).push(1)</script>' +
  '<script type="application/ld+json">{"@type":"Store"}</script>' +
  '</body></html>';

describe('httpsOrigin', () => {
  it('só aceita https e devolve a origem', () => {
    expect(httpsOrigin('https://api.exemplo.dev/v1/')).toBe('https://api.exemplo.dev');
    expect(httpsOrigin('http://api.exemplo.dev')).toBeNull();
    expect(httpsOrigin('javascript:alert(1)')).toBeNull();
    expect(httpsOrigin('')).toBeNull();
    expect(httpsOrigin(undefined)).toBeNull();
  });
});

describe('inlineScriptHashes', () => {
  it('conta só os scripts embutidos que executam (sem src e sem JSON-LD)', () => {
    expect(inlineScriptHashes(PAGE)).toEqual(
      [sha('self.__next_f.push([1,"abc"])'), sha('(globalThis.T=[]).push(1)')].sort(),
    );
  });
});

describe('injectScriptHashCsp', () => {
  it('põe a meta logo após o <head>, com hashes, e é idempotente', () => {
    const once = injectScriptHashCsp(PAGE);
    expect(once).toMatch(/<head><meta http-equiv="Content-Security-Policy" data-sparks-csp /);
    expect(once).toContain(sha('self.__next_f.push([1,"abc"])'));
    expect(once).not.toContain("'unsafe-inline'");
    expect(injectScriptHashCsp(once)).toBe(once);
  });

  it('só libera o VLibras quando pedido (páginas públicas)', () => {
    expect(injectScriptHashCsp(PAGE)).not.toContain('vlibras');
    const pub = injectScriptHashCsp(PAGE, { libras: true });
    expect(pub).toContain('https://vlibras.gov.br https://*.vlibras.gov.br');
    expect(pub).toContain('https://cdn.jsdelivr.net/gh/spbgovbr-vlibras/');
    expect(pub).toContain("'wasm-unsafe-eval'");
    expect(pub).not.toContain("'unsafe-inline'");
    expect(injectScriptHashCsp(pub, { libras: true })).toBe(pub);
  });

  it('sem <head>, não mexe', () => {
    expect(injectScriptHashCsp('<p>oi</p>')).toBe('<p>oi</p>');
  });
});

describe('isAdminPage', () => {
  it('reconhece as páginas do painel', () => {
    expect(isAdminPage('admin/index.html')).toBe(true);
    expect(isAdminPage('admin.html')).toBe(true);
    expect(isAdminPage('admin/login/index.html')).toBe(true);
    expect(isAdminPage('index.html')).toBe(false);
    expect(isAdminPage('administracao/index.html')).toBe(false);
  });
});

describe('fillHeaders', () => {
  const template =
    "  Content-Security-Policy: connect-src 'self' {{API_ORIGIN}} {{SUPABASE_ORIGIN}}; img-src {{SUPABASE_ORIGIN}}\n";

  it('preenche as origens exatas', () => {
    const { text, missing } = fillHeaders(template, {
      apiUrl: 'https://api.exemplo.dev/',
      supabaseUrl: 'https://abc.supabase.co',
    });
    expect(text).toContain("connect-src 'self' https://api.exemplo.dev https://abc.supabase.co;");
    expect(missing).toEqual([]);
  });

  it('origem ausente ou http some e é avisada, sem sobrar espaço duplo', () => {
    const { text, missing } = fillHeaders(template, { apiUrl: 'http://x.dev', supabaseUrl: '' });
    expect(text).toContain("connect-src 'self'; img-src");
    expect(text).not.toMatch(/\S {2,}\S/);
    expect(missing).toEqual(['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_SUPABASE_URL']);
  });
});

describe('hardenExport', () => {
  it('preenche _headers e protege todas as páginas; --strict falha sem origem', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sparks-out-'));
    try {
      await mkdir(path.join(dir, 'admin'));
      await writeFile(
        path.join(dir, '_headers'),
        '  Content-Security-Policy: connect-src {{API_ORIGIN}}\n',
      );
      await writeFile(path.join(dir, 'index.html'), PAGE);
      await writeFile(path.join(dir, 'admin', 'index.html'), PAGE);
      const env = {
        NEXT_PUBLIC_API_URL: 'https://api.exemplo.dev',
        NEXT_PUBLIC_SUPABASE_URL: 'https://a.supabase.co',
      };
      expect((await hardenExport(dir, env, { strict: true })).pages).toBe(2);
      expect(await readFile(path.join(dir, '_headers'), 'utf8')).toContain(
        'connect-src https://api.exemplo.dev',
      );
      expect(await readFile(path.join(dir, 'admin', 'index.html'), 'utf8')).toContain(
        'data-sparks-csp',
      );
      expect(await readFile(path.join(dir, 'index.html'), 'utf8')).toContain('vlibras.gov.br');
      expect(await readFile(path.join(dir, 'admin', 'index.html'), 'utf8')).not.toContain(
        'vlibras',
      );
      await expect(hardenExport(dir, {}, { strict: true })).rejects.toThrow(/origem https ausente/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
