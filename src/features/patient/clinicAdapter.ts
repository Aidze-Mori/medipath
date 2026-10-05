import { createClinicDocument, getClinicStudyMetadata, SECTION_KINDS, SYNTHETIC_FIXTURES } from '../../domain';
import type { DocumentRecord } from '../../domain';
import { THIRD_OPINION_DEMO_LABEL } from '../../engine/clinicalDemo';

async function readPayload(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Клиника вернула пустой ответ. Повторите загрузку.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); }
      catch (error) { throw new Error('Соединение прервалось при загрузке результатов. Повторите загрузку.', { cause: error }); }
      const { done, value } = chunk;
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) { await reader.cancel(); throw new Error('Ответ клиники превысил допустимый размер. Повторите загрузку.'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  try { return JSON.parse(text); } catch { throw new Error('Клиника вернула некорректный ответ. Повторите загрузку.'); }
}

/** Demo adapter accepts only ready canonical records belonging to this synthetic patient. */
export async function loadClinicResults(fixtureId: string | undefined, signal: AbortSignal): Promise<Array<{ document: DocumentRecord; title: string; date: string; receivedAt: string }>> {
  if (fixtureId !== undefined && !SYNTHETIC_FIXTURES.some(fixture => fixture.id === fixtureId)) throw new Error('Учебный результат не найден. Выберите сценарий из демопанели.');
  const query = new URLSearchParams({ patientId: 'demo-patient-01' });
  if (fixtureId) query.set('fixtureId', fixtureId);
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  let response: Response;
  try { response = await fetch(`/api/clinic-demo?${query}`, { signal: requestSignal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' }); }
  catch (error) {
    if (signal.aborted) throw error;
    throw new Error(requestSignal.aborted ? 'Учебная система не ответила вовремя. Повторите загрузку.' : 'Не удалось связаться с учебной системой клиники. Проверьте соединение и повторите загрузку.', { cause: error });
  }
  if (!response.ok) throw new Error('Не удалось получить результаты из учебной системы клиники. Повторите загрузку.');
  const payload = await readPayload(response);
  if (!payload || typeof payload !== 'object' || !('source' in payload) || payload.source !== 'synthetic_clinic_adapter' ||
    !('patientId' in payload) || payload.patientId !== 'demo-patient-01' || !('clinicId' in payload) || payload.clinicId !== 'demo-clinic-01' ||
    !('records' in payload) || !Array.isArray(payload.records) || !payload.records.length || payload.records.length > SYNTHETIC_FIXTURES.length) {
    throw new Error('Ответ клиники не прошёл проверку принадлежности и источника.');
  }
  const seen = new Set<string>();
  return payload.records.map((record: unknown) => {
    if (!record || typeof record !== 'object') throw new Error('Повреждённый результат клиники.');
    const row = record as Record<string, unknown>;
    const fixture = SYNTHETIC_FIXTURES.find(item => item.id === row.fixtureId);
    const metadata = fixture ? getClinicStudyMetadata(fixture.id) : undefined;
    if (!fixture || seen.has(fixture.id) || (fixtureId && fixtureId !== fixture.id) || row.patientId !== 'demo-patient-01' || row.clinicId !== 'demo-clinic-01' ||
      row.sourceRevision !== fixture.revision || row.status !== 'ready' || row.sourceKind !== 'structured' ||
      row.studyAdapter !== fixture.inputAdapter || (fixture.inputAdapter ? row.studyAdapterLabel !== THIRD_OPINION_DEMO_LABEL : row.studyAdapterLabel !== undefined) ||
      row.documentId !== `clinic-${fixture.id}` || row.studyId !== `study-${fixture.id}` ||
      !row.studyMetadata || typeof row.studyMetadata !== 'object' || !metadata ||
      Object.keys(row.studyMetadata).sort().join(',') !== Object.keys(metadata).sort().join(',') ||
      !Object.entries(metadata).every(([key, value]) => (row.studyMetadata as Record<string, unknown>)[key] === value) ||
      row.performedAt !== metadata.performedAt || row.publishedAt !== metadata.publishedAt ||
      !row.sections || typeof row.sections !== 'object' || !SECTION_KINDS.every(kind => (row.sections as Record<string, unknown>)[kind] === fixture.sections[kind]) ||
      typeof row.performedAt !== 'string' || !Number.isFinite(Date.parse(row.performedAt)) ||
      typeof row.publishedAt !== 'string' || !Number.isFinite(Date.parse(row.publishedAt)) || Date.parse(row.publishedAt) < Date.parse(row.performedAt)) {
      throw new Error('Результат не прошёл проверку версии, готовности или содержимого.');
    }
    seen.add(fixture.id);
    return { document: createClinicDocument(fixture.id), title: fixture.title, date: row.performedAt, receivedAt: row.publishedAt };
  });
}
