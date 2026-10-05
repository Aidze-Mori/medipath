import type { Page } from 'tesseract.js';
import { checkAbort, IntakeError, type ExtractedBlock, type ExtractionOptions } from './types';

type OcrResult = Pick<ExtractedBlock, 'originalText' | 'confidence' | 'warnings' | 'words'>;

export interface OcrSession {
  recognize(image: HTMLCanvasElement, page: number, total: number): Promise<OcrResult>;
  terminate(): Promise<void>;
}

interface Reply {
  jobId: string;
  status: 'resolve' | 'reject' | 'progress';
  data: unknown;
}

/**
 * Adapter for the pinned Tesseract.js 7 worker protocol (createWorker.js).
 * Owning the native handle lets cancellation terminate language/WASM initialization,
 * before the public createWorker promise would expose its terminate method.
 * Keep the protocol smoke tests when upgrading Tesseract.
 */
export function createOcrSession(options: ExtractionOptions): OcrSession {
  let worker: Worker | undefined;
  let initialization: Promise<void> | undefined;
  let terminated = false;
  let current = 1;
  let totalPages = 1;
  let nextJob = 0;
  const pending = new Map<
    string,
    { resolve: (data: unknown) => void; reject: (error: IntakeError) => void }
  >();

  function stop(error: IntakeError): void {
    if (terminated) return;
    terminated = true;
    worker?.terminate();
    options.signal?.removeEventListener('abort', onAbort);
    for (const job of pending.values()) job.reject(error);
    pending.clear();
  }
  const onAbort = () => stop(new IntakeError('cancelled', 'Распознавание отменено.'));
  options.signal?.addEventListener('abort', onAbort, { once: true });

  function send(action: string, payload: unknown, transfer: Transferable[] = []): Promise<unknown> {
    checkAbort(options.signal);
    if (terminated || !worker)
      return Promise.reject(new IntakeError('cancelled', 'Распознавание остановлено.'));
    const jobId = `ocr-${++nextJob}`;
    return new Promise((resolve, reject) => {
      pending.set(jobId, { resolve, reject });
      worker!.postMessage({ workerId: 'local-ocr', jobId, action, payload }, transfer);
    });
  }

  async function initialize(): Promise<void> {
    checkAbort(options.signal);
    worker = new Worker(new URL('/ocr/worker.min.js', window.location.origin));
    worker.onerror = () =>
      stop(
        new IntakeError(
          'unreadable',
          'Не удалось запустить OCR. Проверьте доступность ресурсов приложения и повторите.',
        ),
      );
    worker.onmessageerror = () =>
      stop(new IntakeError('unreadable', 'Ошибка локального OCR. Повторите чтение документа.'));
    worker.onmessage = (event: MessageEvent<Reply>) => {
      if (terminated || options.signal?.aborted) return;
      const reply = event.data;
      const job = pending.get(reply.jobId);
      if (!job) return;
      if (reply.status === 'progress') {
        const progress = reply.data as { status?: string; progress?: number };
        options.onProgress?.({
          stage: 'ocr',
          current,
          total: totalPages,
          percent: Math.round(
            ((current - 1 + Math.max(0, Math.min(1, progress.progress ?? 0))) / totalPages) * 100,
          ),
          label:
            progress.status === 'recognizing text'
              ? `Распознавание ${current} из ${totalPages}`
              : 'Подготовка локального распознавания',
        });
      } else {
        pending.delete(reply.jobId);
        if (reply.status === 'resolve') job.resolve(reply.data);
        else
          job.reject(
            new IntakeError(
              'unreadable',
              'OCR не смог прочитать страницу. Проверьте изображение и повторите.',
            ),
          );
      }
    };
    await send('load', {
      options: {
        lstmOnly: true,
        corePath: new URL('/ocr/core', window.location.origin).href,
        logging: false,
      },
    });
    await send('loadLanguage', {
      langs: ['rus', 'eng'],
      options: {
        langPath: new URL('/ocr/lang', window.location.origin).href,
        cacheMethod: 'none',
        gzip: true,
        lstmOnly: true,
      },
    });
    await send('initialize', { langs: ['rus', 'eng'], oem: 1, config: {} });
  }

  return {
    async recognize(image, page, total) {
      checkAbort(options.signal);
      if (terminated) throw new IntakeError('cancelled', 'Распознавание остановлено.');
      current = page;
      totalPages = total;
      initialization ??= initialize();
      await initialization;
      checkAbort(options.signal);
      const blob = await new Promise<Blob>((resolve, reject) =>
        image.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new IntakeError('unreadable', 'Не удалось прочитать изображение.')),
          'image/png',
        ),
      );
      const bytes = new Uint8Array(await blob.arrayBuffer());
      checkAbort(options.signal);
      const data = (await send(
        'recognize',
        { image: bytes, options: { rotateAuto: false }, output: { text: true, blocks: true } },
        [bytes.buffer],
      )) as Page;
      checkAbort(options.signal);
      const originalText = data.text.trim();
      const warnings = ['OCR требует сверки с оригиналом: проверьте отрицания, числа, единицы и сторону.'];
      if (!originalText)
        warnings.push('На изображении не удалось прочитать текст. Переснимите или замените страницу.');
      else if (data.confidence < 65)
        warnings.push('Низкая уверенность распознавания символов. Нужна внимательная проверка текста.');
      return {
        originalText,
        confidence: data.confidence,
        warnings,
        words: (data.blocks ?? []).flatMap((block) =>
          block.paragraphs.flatMap((paragraph) =>
            paragraph.lines.flatMap((line) =>
              line.words.map((word) => ({
                text: word.text,
                confidence: word.confidence,
                x: word.bbox.x0,
                y: word.bbox.y0,
                width: word.bbox.x1 - word.bbox.x0,
                height: word.bbox.y1 - word.bbox.y0,
              })),
            ),
          ),
        ),
      };
    },
    async terminate() {
      stop(new IntakeError('cancelled', 'Распознавание остановлено.'));
    },
  };
}
