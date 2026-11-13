export function httpsOrigin(value: string | undefined): string | null;
export function inlineScriptHashes(html: string): string[];
export function isAdminPage(relativePath: string): boolean;
export function injectScriptHashCsp(html: string, options?: { libras?: boolean }): string;
export function fillHeaders(
  template: string,
  origins: { apiUrl?: string; supabaseUrl?: string },
): { text: string; missing: string[] };
export function hardenExport(
  outDir: string,
  env?: Record<string, string | undefined>,
  options?: { strict?: boolean },
): Promise<{ pages: number; missing: string[] }>;
