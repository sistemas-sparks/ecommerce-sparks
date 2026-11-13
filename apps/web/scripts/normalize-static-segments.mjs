// Next 16.4 exporta segmentos em subpastas no Windows, mas o navegador pede nomes com pontos.
// O ajuste só copia artefatos do próprio export; no Linux os nomes já vêm corretos.
import { copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../out');
async function normalize(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await normalize(source);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.txt')) continue;
    const parts = path.relative(root, source).split(path.sep);
    const prefix = parts.findIndex((part) => part.startsWith('__next.'));
    if (prefix < 0 || prefix === parts.length - 1) continue;
    const destination = path.resolve(
      root,
      ...parts.slice(0, prefix),
      parts.slice(prefix).join('.'),
    );
    if (!source.startsWith(root + path.sep) || !destination.startsWith(root + path.sep)) {
      throw new Error('Artefato fora do diretório de exportação.');
    }
    await copyFile(source, destination);
  }
}
await normalize(root);
