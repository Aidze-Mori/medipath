import { createClinicDocument, isReadyForAnalysis, SECTION_KINDS, SYNTHETIC_FIXTURES, type Analysis, type DemoRequest, type DemoResponse, type DemoReviewBinding, type DocumentRecord, type DocumentSections } from '../domain';
import { analyzeLocal, CORPUS_VERSION, selectClinicalDemoProposals } from '../engine';
import { validateAnalysisEvidence } from '../engine/validateEvidence';
import manifest from '../../data/corpus-release/manifest.json';
export async function detectSyntheticFixture(bytes: ArrayBuffer): Promise<string | null> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return manifest.trustedFiles.find(file => file.sha256 === hex)?.fixtureId ?? null;
}
export const trustedSyntheticFile = detectSyntheticFixture;

// Technical normalization only: never alter punctuation, signs, numbers or negation.
export function canonicalContent(sections: DocumentSections): string {
  return JSON.stringify(SECTION_KINDS.map(kind => [kind, sections[kind].normalize('NFC').replace(/\s+/gu, ' ').trim()]));
}
export async function contentDigest(sections: DocumentSections): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalContent(sections)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function prepareDemoRequest(document: DocumentRecord, requestId: string = crypto.randomUUID()): Promise<{request: DemoRequest; binding: DemoReviewBinding} | null> {
  if (!isReadyForAnalysis(document) || !['builtin_fixture', 'clinic_adapter'].includes(document.origin)) return null;
  const fixture = SYNTHETIC_FIXTURES.find(candidate => candidate.id === document.fixtureId);
  if (!fixture || canonicalContent(fixture.sections) !== canonicalContent(document.sections)) return null;
  const released = manifest.variants.find(variant => variant.fixtureId === fixture.id && variant.fixtureRevision === fixture.revision && variant.reviewVariantId === 'canonical');
  if (!released || await contentDigest(fixture.sections) !== released.contentDigest) return null;
  const request: DemoRequest = { fixtureId: fixture.id, fixtureRevision: fixture.revision, reviewVariantId: 'canonical', operation: 'explain', requestId };
  return { request, binding: { fixtureId: fixture.id, fixtureRevision: fixture.revision, reviewVariantId: 'canonical', contentDigest: released.contentDigest, documentId: document.id, documentRevision: document.revision, requestId } };
}
export function isCurrentDemoResponse(document: DocumentRecord, binding: DemoReviewBinding, response: DemoResponse): boolean {
  if (!isReadyForAnalysis(document) || !['builtin_fixture', 'clinic_adapter'].includes(document.origin) || binding.documentId !== document.id || binding.documentRevision !== document.revision || !response?.binding) return false;
  const fixture = SYNTHETIC_FIXTURES.find(candidate => candidate.id === document.fixtureId);
  if (!fixture || canonicalContent(document.sections) !== canonicalContent(fixture.sections)) return false;
  return ['fixtureId', 'fixtureRevision', 'reviewVariantId', 'contentDigest', 'requestId'].every(key => binding[key as keyof DemoReviewBinding] === response.binding[key as keyof DemoResponse['binding']]);
}
export function acceptDemoResponse(document: DocumentRecord, binding: DemoReviewBinding, response: DemoResponse): Analysis | null {
  if (!isCurrentDemoResponse(document, binding, response) || response.analysis?.corpusVersion !== CORPUS_VERSION) return null;
  const canonical = createClinicDocument(binding.fixtureId);
  if (!validateAnalysisEvidence(response.analysis, canonical)) return null;
  const local = analyzeLocal(document);
  const baseline = local.clinicalDemo ? selectClinicalDemoProposals(local, response.analysis.clinicalDemo?.proposals.map(proposal => proposal.id) ?? []) : local;
  return { ...baseline, claims: response.analysis.claims.map(claim => claim.kind === 'document_statement' ? baseline.claims.find(current => current.id === claim.id) ?? claim : claim), llmExplanation: response.analysis.llmExplanation, mode: 'synthetic_live' };
}
export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0) { super(message); this.name = 'ApiError'; }
}
export async function analyzeDemo(document: DocumentRecord, options: { signal?: AbortSignal; requestId?: string; fetcher?: typeof fetch } = {}): Promise<Analysis> {
  const prepared = await prepareDemoRequest(document, options.requestId);
  if (!prepared) throw new ApiError('local_only', 'Подтверждённый текст не совпадает с разрешённым учебным примером. Доступна локальная обработка.');
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(65000)]) : AbortSignal.timeout(65000);
  let response: Response;
  let raw: string;
  try {
    response = await (options.fetcher ?? fetch)('/api/analyze-demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prepared.request), signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    raw = await response.text();
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(signal.aborted ? 'timeout' : 'network_error', signal.aborted ? 'Модель не ответила вовремя. Можно повторить запрос.' : 'Не удалось связаться с сервером. Проверьте соединение и повторите запрос.');
  }
  if (raw.length > 65536) throw new ApiError('invalid_response', 'Ответ сервера превысил допустимый размер.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new ApiError('invalid_response', 'Сервер вернул некорректный ответ.', response.status); }
  if (!response.ok) {
    const code = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'object' && value.error !== null && 'code' in value.error && typeof value.error.code === 'string' ? value.error.code : 'model_unavailable';
    const messages: Record<string, string> = { live_not_configured: 'Внешний AI пока не подключён. Доступен явно обозначенный локальный учебный разбор.', provider_local_only: 'Локальный Codex CLI доступен только на компьютере разработчика. На сайте нужен серверный API-провайдер.', invalid_provider: 'Проверьте конфигурацию AI на сервере. Локальный учебный разбор доступен.', rate_limited: 'Лимит учебных обращений достигнут. Попробуйте через минуту; если исчерпан суточный лимит — на следующий день.', timeout: 'Модель не ответила вовремя. Можно повторить запрос.', model_unavailable: 'Внешняя модель сейчас недоступна. Можно повторить запрос или открыть локальный разбор.', limit_unavailable: 'Проверка лимита временно недоступна. Повторите запрос позже.', invalid_model_response: 'Ответ модели не прошёл проверку. Можно повторить запрос или открыть локальный разбор.' };
    throw new ApiError(code, messages[code] ?? 'Ответ не прошёл проверку. Документ сохранён в этой вкладке.', response.status);
  }
  const accepted = acceptDemoResponse(document, prepared.binding, value as DemoResponse);
  if (!accepted) throw new ApiError('invalid_response', 'Ответ не соответствует подтверждённой редакции или допустимым основаниям.');
  return accepted;
}
