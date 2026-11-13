import {
  PRODUCT_IMAGE_WIDTHS,
  PRODUCT_IMAGE_MAX_BYTES,
  productUploadInputSchema,
  stripProductImageMetadata,
} from '@sparks/shared';

/** Regrava pixels, remove metadados e gera as três larguras em proporção 4:5. */
export async function prepareProductImages(file: File): Promise<{ width: number; blob: Blob }[]> {
  productUploadInputSchema.parse({ type: file.type, size: file.size });
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const text = (start: number, end: number) => String.fromCharCode(...header.subarray(start, end));
  const valid =
    file.type === 'image/jpeg'
      ? header[0] === 255 && header[1] === 216 && header[2] === 255
      : file.type === 'image/png'
        ? header[0] === 137 &&
          text(1, 4) === 'PNG' &&
          header[4] === 13 &&
          header[5] === 10 &&
          header[6] === 26 &&
          header[7] === 10
        : text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP';
  if (!valid) throw new Error('Escolha uma foto JPEG, PNG ou WebP válida.');
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (!image.width || !image.height || image.width * image.height > 40000000)
      throw new Error('A foto é grande demais. Reduza para até 40 megapixels.');
    const variants = [];
    for (const width of PRODUCT_IMAGE_WIDTHS) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = Math.round((width * 5) / 4);
      const context = canvas.getContext('2d', { colorSpace: 'srgb' });
      if (!context) throw new Error('Não foi possível preparar a foto neste navegador.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;
      context.drawImage(
        image,
        (canvas.width - drawWidth) / 2,
        (canvas.height - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.88),
      );
      if (!blob || blob.type !== 'image/webp' || blob.size > PRODUCT_IMAGE_MAX_BYTES)
        throw new Error(
          'Não foi possível converter a foto para WebP. Use um navegador atualizado.',
        );
      const clean = stripProductImageMetadata(new Uint8Array(await blob.arrayBuffer()));
      variants.push({ width, blob: new Blob([clean], { type: 'image/webp' }) });
      canvas.width = canvas.height = 0;
    }
    return variants;
  } finally {
    image.close();
  }
}
