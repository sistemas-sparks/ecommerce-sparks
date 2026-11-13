import { productImageBytesSchema } from '@sparks/shared';
import { apiError } from '../lib/errors';

const invalid = () => apiError(400, 'invalid_image', 'Reprocesse a foto antes de enviá-la.');

/** Cabeçalho e chunks RIFF conforme developers.google.com/speed/webp/docs/riff_container.
 * Aceita somente WebP estático, sem metadados, no tamanho gerado pelo painel.
 * A decodificação/regravação dos pixels acontece no canvas do navegador.
 */
export function inspectProductWebp(
  bytes: Uint8Array,
  expectedWidth: number,
  // Fotos de produto são 4:5; os banners (T-021) passam a própria altura (2:1).
  expectedHeight = Math.round((expectedWidth * 5) / 4),
): void {
  if (!productImageBytesSchema.safeParse(bytes).success) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (text(0) !== 'RIFF' || text(8) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length)
    throw invalid();
  let width = 0;
  let height = 0;
  let frames = 0;
  let extendedWidth = 0;
  let extendedHeight = 0;
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw invalid();
    const tag = text(offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size;
    const next = end + (size % 2);
    if (end > bytes.length || next > bytes.length || size === 0) throw invalid();
    if (tag === 'VP8X') {
      if (offset !== 12 || size !== 10 || (bytes[start]! & ~0x10) !== 0) throw invalid();
      const uint24 = (index: number) =>
        bytes[index]! | (bytes[index + 1]! << 8) | (bytes[index + 2]! << 16);
      extendedWidth = uint24(start + 4) + 1;
      extendedHeight = uint24(start + 7) + 1;
    } else if (tag === 'VP8 ') {
      if (
        size < 10 ||
        (bytes[start]! & 1) !== 0 ||
        bytes[start + 3] !== 0x9d ||
        bytes[start + 4] !== 1 ||
        bytes[start + 5] !== 0x2a
      )
        throw invalid();
      width = view.getUint16(start + 6, true) & 0x3fff;
      height = view.getUint16(start + 8, true) & 0x3fff;
      frames++;
    } else if (tag === 'VP8L') {
      if (size < 5 || bytes[start] !== 0x2f) throw invalid();
      const bits = view.getUint32(start + 1, true);
      if (bits >>> 29 !== 0) throw invalid();
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      frames++;
    } else if (tag !== 'ALPH' || !extendedWidth || frames > 0) {
      // EXIF, XMP, ICCP, animação e chunks desconhecidos não são aceitos.
      throw invalid();
    }
    if (size % 2 && bytes[end] !== 0) throw invalid();
    offset = next;
  }
  if (
    frames !== 1 ||
    width !== expectedWidth ||
    height !== expectedHeight ||
    (extendedWidth && (extendedWidth !== width || extendedHeight !== height))
  )
    throw invalid();
}
