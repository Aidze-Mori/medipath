import { getDocument, GlobalWorkerOptions, OPS, type RenderTask } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { canvasPreview } from './image';
import { readablePdfText } from './pdfText';
import {
  checkAbort,
  INTAKE_LIMITS,
  IntakeError,
  releaseBlocks,
  type ExtractedBlock,
  type ExtractionOptions,
} from './types';
import type { OcrSession } from './worker';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function extractPdf(
  bytes: Uint8Array,
  options: ExtractionOptions,
  ocr: OcrSession,
): Promise<ExtractedBlock[]> {
  checkAbort(options.signal);
  const blocks: ExtractedBlock[] = [];
  const loading = getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    stopAtErrors: true,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    maxImageSize: INTAKE_LIMITS.imagePixels,
    verbosity: 0,
  });
  let rendering: RenderTask | undefined;
  const cancel = () => {
    rendering?.cancel();
    void loading.destroy();
  };
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const pdf = await loading.promise;
    checkAbort(options.signal);
    if (pdf.numPages > INTAKE_LIMITS.pages)
      throw new IntakeError(
        'too_many_pages',
        'В PDF больше 5 страниц. Разделите документ; первые страницы не обрабатываются отдельно без вашего выбора.',
      );
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      checkAbort(options.signal);
      options.onProgress?.({
        stage: 'reading',
        current: pageNumber,
        total: pdf.numPages,
        percent: Math.round(((pageNumber - 1) / pdf.numPages) * 100),
        label: `Чтение страницы ${pageNumber} из ${pdf.numPages}`,
      });
      const block: ExtractedBlock = {
        id: `page-${pageNumber}`,
        anchor: `page-${pageNumber}`,
        pageNumber,
        method: 'native',
        originalText: '',
        warnings: [],
      };
      const canvas = document.createElement('canvas');
      try {
        const page = await pdf.getPage(pageNumber);
        const natural = page.getViewport({ scale: 2 });
        const scale = Math.min(
          2,
          2 * Math.sqrt(INTAKE_LIMITS.renderPixels / (natural.width * natural.height)),
        );
        const viewport = page.getViewport({ scale, rotation: (page.rotate + (options.rotation ?? 0)) % 360 });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext('2d');
        if (!context) throw new IntakeError('unreadable', 'Не удалось подготовить страницу PDF.');
        rendering = page.render({ canvasContext: context, canvas, viewport });
        await rendering.promise;
        rendering = undefined;
        checkAbort(options.signal);
        block.previewUrl = await canvasPreview(canvas);
        const content = await page.getTextContent();
        const text = readablePdfText(content.items.filter((item): item is TextItem => 'str' in item));
        const operators = await page.getOperatorList();
        const imageOperations = new Set<number>([
          OPS.paintImageXObject,
          OPS.paintInlineImageXObject,
          OPS.paintImageMaskXObject,
          OPS.paintImageXObjectRepeat,
        ]);
        const hasRaster = operators.fnArray.some((operation) => imageOperations.has(operation));
        const damagedText =
          !/[\p{L}\p{N}]{3}/u.test(text) || (text.match(/\ufffd/g)?.length ?? 0) > text.length * 0.02;
        // Even a substantial native heading does not prove that a raster body was read.
        // Whole-page OCR replaces native output here instead of duplicating both layers.
        if (hasRaster || damagedText || options.rotation) {
          block.method = 'ocr';
          Object.assign(block, await ocr.recognize(canvas, pageNumber, pdf.numPages));
          if (hasRaster && text)
            block.warnings.push(
              'Страница содержит изображение и текстовый слой; использован OCR всей страницы без дублирования слоёв.',
            );
        } else {
          block.originalText = text;
        }
        page.cleanup();
      } catch (error) {
        if (
          options.signal?.aborted ||
          (error instanceof IntakeError && ['cancelled', 'timeout', 'too_large'].includes(error.code))
        ) {
          if (block.previewUrl) URL.revokeObjectURL(block.previewUrl);
          checkAbort(options.signal);
          throw error;
        }
        block.warnings.push(
          `Страница ${pageNumber} не прочитана. Замените её или загрузите доступную копию.`,
        );
        block.originalText = '';
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
      blocks.push(block);
    }
    checkAbort(options.signal);
    return blocks;
  } catch (error) {
    releaseBlocks(blocks);
    checkAbort(options.signal);
    if (error instanceof IntakeError) throw error;
    if (error instanceof Error && error.name === 'PasswordException')
      throw new IntakeError(
        'password',
        'PDF защищён паролем. Откройте его самостоятельно и загрузите копию без пароля.',
      );
    throw new IntakeError(
      'corrupt',
      'PDF повреждён или не поддерживается. Сохраните доступную копию и повторите.',
    );
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    await loading.destroy();
  }
}
