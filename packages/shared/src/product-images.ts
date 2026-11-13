import { productImageBytesSchema } from './schemas/products';

/** O canvas trabalha em sRGB. Remove ICCP/EXIF/XMP e chunks de metadados do WebP regravado.
 * Container: https://developers.google.com/speed/webp/docs/riff_container
 */
export function stripProductImageMetadata(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = productImageBytesSchema.parse(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const invalid = () => new Error('Não foi possível preparar a foto.');
  if (text(0) !== 'RIFF' || text(8) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length)
    throw invalid();
  const parts: Uint8Array[] = [];
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw invalid();
    const tag = text(offset);
    const length = view.getUint32(offset + 4, true);
    const next = offset + 8 + length + (length % 2);
    if (length === 0 || next > bytes.length) throw invalid();
    if (tag === 'ANIM' || tag === 'ANMF') throw invalid();
    if (['VP8X', 'VP8 ', 'VP8L', 'ALPH'].includes(tag)) {
      const part = bytes.slice(offset, next);
      if (tag === 'VP8X') {
        if (offset !== 12 || length !== 10 || (part[8]! & 0x02) !== 0) throw invalid();
        part[8] = part[8]! & ~(0x20 | 0x08 | 0x04);
      }
      parts.push(part);
    }
    offset = next;
  }
  const output = new Uint8Array(12 + parts.reduce((total, part) => total + part.length, 0));
  output.set(bytes.subarray(0, 12));
  new DataView(output.buffer).setUint32(4, output.length - 8, true);
  let cursor = 12;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}
