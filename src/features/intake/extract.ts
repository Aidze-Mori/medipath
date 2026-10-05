import { assembleDocument } from './sections';
import {
  checkAbort,
  INTAKE_LIMITS,
  IntakeError,
  releaseBlocks,
  type ExtractedBlock,
  type ExtractedDocument,
  type ExtractionOptions,
  type PhotoPageInput,
} from './types';
import { decodeText, detectFormat } from './validation';
import type { OcrSession } from './worker';

export type {
  ExtractedBlock,
  ExtractedDocument,
  ExtractedSection,
  ExtractionOptions,
  ExtractionProgress,
  IntakeFormat,
  PhotoPageInput,
} from './types';
export { INTAKE_LIMITS, IntakeError } from './types';
export { splitSections } from './sections';

let active = false;

export function extractText(text: string, name = 'Вставленный текст'): ExtractedDocument {
  if (!text.trim()) throw new IntakeError('empty', 'Добавьте текст документа.');
  if (text.length > INTAKE_LIMITS.textChars)
    throw new IntakeError('too_large', 'Максимальная длина текста — 20 000 символов.');
  const block: ExtractedBlock = {
    id: 'text-1',
    anchor: 'text-1',
    method: 'pasted',
    originalText: text.replace(/\r\n?/g, '\n'),
    warnings: [],
  };
  return assembleDocument('txt', name, [block]);
}

export function disposeExtraction(document: ExtractedDocument): void {
  releaseBlocks(document.blocks);
}

async function runExtraction<T>(
  options: ExtractionOptions,
  run: (context: ExtractionOptions, getOcr: () => Promise<OcrSession>) => Promise<T>,
): Promise<T> {
  checkAbort(options.signal);
  if (active)
    throw new IntakeError('busy', 'Документ уже читается. Дождитесь результата или отмените обработку.');
  active = true;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, INTAKE_LIMITS.timeoutMs);
  let ocr: OcrSession | undefined;
  const context = { ...options, signal: controller.signal };
  const getOcr = async () => {
    checkAbort(controller.signal);
    const { createOcrSession } = await import('./worker');
    ocr ??= createOcrSession(context);
    return ocr;
  };
  try {
    return await run(context, getOcr);
  } catch (error) {
    if (timedOut)
      throw new IntakeError(
        'timeout',
        'Чтение заняло больше двух минут и остановлено. Попробуйте отдельную страницу или меньший файл.',
      );
    if (controller.signal.aborted) throw new IntakeError('cancelled', 'Чтение отменено.');
    if (error instanceof IntakeError) throw error;
    throw new IntakeError(
      'unreadable',
      'Документ не удалось прочитать. Попробуйте доступную копию или вставьте текст.',
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
    try {
      await ocr?.terminate();
    } finally {
      active = false;
    }
  }
}

export async function extractDocument(
  file: File,
  options: ExtractionOptions = {},
): Promise<ExtractedDocument> {
  return runExtraction(options, async (context, getOcr) => {
    context.onProgress?.({
      stage: 'validating',
      current: 0,
      total: 1,
      percent: 0,
      label: 'Проверка файла на устройстве',
    });
    if (file.size > INTAKE_LIMITS.fileBytes)
      throw new IntakeError('too_large', 'Максимальный размер файла — 5 МБ.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    checkAbort(context.signal);
    const format = detectFormat(file.name, file.type, bytes);
    let blocks: ExtractedBlock[] = [];
    try {
      if (format === 'txt') {
        const decoded = decodeText(bytes);
        blocks = [
          {
            id: 'text-1',
            anchor: 'text-1',
            method: 'native',
            originalText: decoded.text,
            warnings: decoded.warnings,
          },
        ];
      } else if (format === 'pdf') {
        const { extractPdf } = await import('./pdf');
        blocks = await extractPdf(bytes, context, await getOcr());
      } else if (format === 'docx') {
        const { extractDocx } = await import('./docx');
        blocks = await extractDocx(bytes, context, await getOcr());
      } else {
        const { extractImage } = await import('./image');
        blocks = [await extractImage(bytes, context, await getOcr())];
      }
      checkAbort(context.signal);
      const result = assembleDocument(format, file.name, blocks);
      context.onProgress?.({
        stage: 'reading',
        current: 1,
        total: 1,
        percent: 100,
        label: 'Текст готов к сравнению с оригиналом',
      });
      checkAbort(context.signal);
      return result;
    } catch (error) {
      releaseBlocks(blocks);
      throw error;
    }
  });
}

/** Photos are one ordered document, never an implicit merge of unrelated files. */
export async function extractImages(
  files: File[],
  options: ExtractionOptions = {},
): Promise<ExtractedDocument> {
  return extractPhotoPages(
    files.map((file) => ({ file, rotation: options.rotation ?? 0 })),
    options,
  );
}

export async function extractPhotoPages(
  pages: PhotoPageInput[],
  options: ExtractionOptions = {},
): Promise<ExtractedDocument> {
  return runExtraction(options, async (context, getOcr) => {
    if (!pages.length) throw new IntakeError('empty', 'Выберите фотографии страниц одного документа.');
    if (pages.length > INTAKE_LIMITS.pages)
      throw new IntakeError('too_many_pages', 'Можно добавить не больше 5 фотографий одного документа.');
    if (pages.reduce((size, page) => size + page.file.size, 0) > INTAKE_LIMITS.fileBytes)
      throw new IntakeError('too_large', 'Общий размер фотографий должен быть не больше 5 МБ.');
    const { extractImage } = await import('./image');
    const blocks: ExtractedBlock[] = [];
    try {
      for (let index = 0; index < pages.length; index++) {
        const { file, rotation } = pages[index];
        const bytes = new Uint8Array(await file.arrayBuffer());
        checkAbort(context.signal);
        const format = detectFormat(file.name, file.type, bytes);
        if (format !== 'jpg' && format !== 'png')
          throw new IntakeError(
            'unsupported',
            'Для нескольких страниц выберите только фотографии JPEG или PNG.',
          );
        blocks.push(
          await extractImage(bytes, { ...context, rotation }, await getOcr(), index + 1, pages.length),
        );
      }
      checkAbort(context.signal);
      return assembleDocument(
        'jpg',
        pages.length === 1 ? pages[0].file.name : `${pages.length} фото одного документа`,
        blocks,
      );
    } catch (error) {
      releaseBlocks(blocks);
      throw error;
    }
  });
}
