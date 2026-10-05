import { isReadyForAnalysis, type Analysis, type DocumentRecord } from '../domain';
import { analyzeLocal } from '../engine';
import { ApiError } from './policy';
import { cleanDocumentSections, documentContentDigest, minimizeDocument, validCapabilities, validDocumentExplanation, validDocumentRequest, type DocumentAnalysisRequest, type DocumentAnalysisResponse, type RuntimeCapabilities } from './documentContract';
export type { RuntimeCapabilities } from './documentContract';
export { minimizeDocument as prepareAnonymizedSections } from './documentContract';

type Progress = 'anonymizing' | 'analyzing' | 'validating';
type Options = { signal?: AbortSignal; requestId?: string; fetcher?: typeof fetch; onProgress?: (stage: Progress) => void };
async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new ApiError('invalid_response', 'Сервер вернул пустой ответ.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 65536) { await reader.cancel(); throw new ApiError('invalid_response', 'Ответ сервера превысил допустимый размер.'); }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError('invalid_response', 'Сервер вернул некорректный ответ.', response.status); }
}
export async function fetchCapabilities(options: { signal?: AbortSignal; fetcher?: typeof fetch } = {}): Promise<RuntimeCapabilities> {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
  try {
    const response = await (options.fetcher ?? fetch)('/api/capabilities', { signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    const value = await readJson(response);
    if (!response.ok || !validCapabilities(value)) throw new ApiError('invalid_response', 'Не удалось проверить настройки AI-сервера.');
    return value;
  } catch (error) {
    if (options.signal?.aborted || error instanceof ApiError) throw error;
    throw new ApiError('network_error', 'AI-сервер не отвечает. Запустите его и повторите проверку.');
  }
}
export async function prepareDocumentRequest(document: DocumentRecord, requestId: string = crypto.randomUUID()): Promise<DocumentAnalysisRequest> {
  if (!isReadyForAnalysis(document)) throw new ApiError('review_required', 'Сначала сверьте и подтвердите текущую редакцию документа.');
  const sections = minimizeDocument(document.sections);
  const request = { requestId, documentRevision: document.revision, contentDigest: await documentContentDigest(sections), sections };
  if (!validDocumentRequest(request)) throw new ApiError('no_medical_text', 'После очистки не осталось достаточно медицинского текста или документ превышает 20 000 символов. Проверьте распознавание.');
  return request;
}
export async function analyzeDocument(document: DocumentRecord, options: Options = {}): Promise<Analysis> {
  options.onProgress?.('anonymizing');
  const id = document.id, revision = document.revision;
  const request = await prepareDocumentRequest(document, options.requestId);
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(65000)]) : AbortSignal.timeout(65000);
  options.onProgress?.('analyzing');
  let response: Response; let value: unknown;
  try {
    response = await (options.fetcher ?? fetch)('/api/analyze-document', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    value = await readJson(response);
  } catch (error) {
    if (options.signal?.aborted || error instanceof ApiError) throw error;
    throw new ApiError(signal.aborted ? 'timeout' : 'network_error', signal.aborted ? 'Модель не ответила вовремя. Документ сохранён, можно повторить запрос.' : 'Не удалось связаться с AI-сервером. Документ сохранён, можно повторить запрос.');
  }
  if (!response.ok) {
    const code = (value as { error?: { code?: unknown } })?.error?.code;
    const messages: Record<string, string> = { document_analysis_disabled: 'Анализ загруженных документов не включён на сервере.', document_analysis_local_only: 'На этом сервере не включён AI-анализ загруженных документов. Документ сохранён в текущей вкладке; попробуйте позже.', live_not_configured: 'AI-провайдер не настроен. Проверьте служебную панель; локальный разбор можно выбрать отдельно.', rate_limited: 'Лимит обращений достигнут. Повторите запрос через минуту.', timeout: 'Модель не ответила вовремя. Можно повторить запрос.', model_unavailable: 'Внешняя модель сейчас недоступна. Можно повторить запрос.', invalid_model_response: 'Ответ модели не прошёл проверку цитат и структуры. Можно повторить запрос.', no_medical_text: 'После очистки не осталось медицинского текста. Проверьте распознанные разделы.', source_changed: 'Редакция запроса изменилась. Сверьте текст и повторите обработку.' };
    throw new ApiError(typeof code === 'string' ? code : 'model_unavailable', typeof code === 'string' && messages[code] || 'Сервер не смог обработать документ. Проверьте настройки и повторите запрос.', response.status);
  }
  options.onProgress?.('validating');
  const result = value as DocumentAnalysisResponse;
  if (!result || typeof result !== 'object' || Object.keys(result).sort().join(',') !== 'binding,explanation' || !result.binding || Object.keys(result.binding).sort().join(',') !== 'contentDigest,documentRevision,requestId' || result.binding.requestId !== request.requestId || result.binding.documentRevision !== revision || result.binding.contentDigest !== request.contentDigest || document.id !== id || document.revision !== revision || !isReadyForAnalysis(document) || await documentContentDigest(minimizeDocument(document.sections)) !== request.contentDigest || !validDocumentExplanation(result.explanation, cleanDocumentSections(request.sections))) throw new ApiError('invalid_response', 'Ответ не соответствует текущей редакции или цитатам документа. Сверьте текст и повторите запрос.');
  const baseline = analyzeLocal(document);
  return { ...baseline, mode: 'anonymized_live', summary: result.explanation.summary, llmExplanation: result.explanation };
}
