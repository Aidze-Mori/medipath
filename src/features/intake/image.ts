import { checkAbort, INTAKE_LIMITS, IntakeError, type ExtractedBlock, type ExtractionOptions } from './types';
import { imageDimensions, imageFormat } from './validation';
import type { OcrSession } from './worker';

export function canvasPreview(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (blob) resolve(URL.createObjectURL(blob));
      else reject(new IntakeError('unreadable', 'Не удалось подготовить изображение для сравнения.'));
    }, 'image/png'),
  );
}

export async function renderImage(bytes: Uint8Array, options: ExtractionOptions): Promise<HTMLCanvasElement> {
  imageDimensions(bytes);
  checkAbort(options.signal);
  const blob = new Blob([new Uint8Array(bytes)], {
    type: imageFormat(bytes) === 'png' ? 'image/png' : 'image/jpeg',
  });
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => {
    throw new IntakeError(
      'corrupt',
      'Изображение повреждено или не читается этим браузером. Сохраните его заново как JPEG или PNG.',
    );
  });
  try {
    checkAbort(options.signal);
    const rotation = options.rotation ?? 0;
    const scale = Math.min(1, Math.sqrt(INTAKE_LIMITS.renderPixels / (bitmap.width * bitmap.height)));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const sideways = rotation === 90 || rotation === 270;
    const canvas = document.createElement('canvas');
    canvas.width = sideways ? height : width;
    canvas.height = sideways ? width : height;
    const ctx = canvas.getContext('2d');
    if (!ctx)
      throw new IntakeError(
        'unreadable',
        'Браузер не смог подготовить изображение. Попробуйте меньший размер.',
      );
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(bitmap, -width / 2, -height / 2, width, height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

export async function extractImage(
  bytes: Uint8Array,
  options: ExtractionOptions,
  ocr: OcrSession,
  pageNumber = 1,
  total = 1,
): Promise<ExtractedBlock> {
  const canvas = await renderImage(bytes, options);
  let previewUrl: string | undefined;
  try {
    previewUrl = await canvasPreview(canvas);
    const result = await ocr.recognize(canvas, pageNumber, total);
    return {
      id: `page-${pageNumber}`,
      anchor: `page-${pageNumber}`,
      pageNumber,
      method: 'ocr',
      previewUrl,
      ...result,
    };
  } catch (error) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    throw error;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
