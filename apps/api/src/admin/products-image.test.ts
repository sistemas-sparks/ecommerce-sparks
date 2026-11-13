import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { stripProductImageMetadata } from '@sparks/shared';
import { inspectProductWebp } from './products-image';

// Cabeçalho sintético: estes testes verificam o container, não a decodificação dos pixels.
function image(tag = 'VP8 ', width = 360, height = 450): Uint8Array {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  view.setUint32(4, 22, true);
  bytes.set(new TextEncoder().encode('WEBP'), 8);
  bytes.set(new TextEncoder().encode(tag), 12);
  view.setUint32(16, 10, true);
  bytes.set([0, 0, 0, 0x9d, 1, 0x2a], 20);
  view.setUint16(26, width, true);
  view.setUint16(28, height, true);
  return bytes;
}
describe('container da foto reprocessada', () => {
  it('aceita as três fotos sintéticas regravadas pelo canvas real do navegador', () => {
    for (const width of [360, 720, 1080]) {
      const bytes = readFileSync(new URL(`./products-fixtures/${width}.webp`, import.meta.url));
      expect(() => inspectProductWebp(stripProductImageMetadata(bytes), width)).not.toThrow();
      expect(() => inspectProductWebp(bytes, width)).toThrow();
    }
  });
  it('aceita dimensões corretas e recusa versões de tamanho diferente', () => {
    expect(() => inspectProductWebp(image(), 360)).not.toThrow();
    expect(() => inspectProductWebp(image(), 720)).toThrow();
    expect(() => inspectProductWebp(image('VP8 ', 360, 360), 360)).toThrow();
  });
  it('banners (T-021): confere a altura informada, em proporção 2:1', () => {
    expect(() => inspectProductWebp(image('VP8 ', 640, 320), 640, 320)).not.toThrow();
    // A altura padrão continua sendo a da foto de produto (4:5).
    expect(() => inspectProductWebp(image('VP8 ', 640, 320), 640)).toThrow();
    expect(() => inspectProductWebp(image('VP8 ', 640, 450), 640, 320)).toThrow();
  });
  it('recusa metadados, animação, SVG e bytes truncados', () => {
    for (const tag of ['EXIF', 'XMP ', 'ANIM', 'ANMF', 'ICCP'])
      expect(() => inspectProductWebp(image(tag), 360)).toThrow();
    expect(() =>
      inspectProductWebp(new TextEncoder().encode('<svg><script/></svg>'), 360),
    ).toThrow();
    expect(() => inspectProductWebp(image().subarray(0, 29), 360)).toThrow();
  });
  it('recusa tamanho de chunk adulterado e dados extras depois do container', () => {
    const bytes = image();
    new DataView(bytes.buffer).setUint32(16, 999, true);
    expect(() => inspectProductWebp(bytes, 360)).toThrow();
    const extra = new Uint8Array(31);
    extra.set(image());
    expect(() => inspectProductWebp(extra, 360)).toThrow();
  });
});
