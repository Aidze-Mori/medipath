import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleClinicRequest } from '../../server/clinic';
import { loadClinicResults } from '../../src/features/patient/clinicAdapter';
import { isConfirmed, isReadyForAnalysis, SYNTHETIC_FIXTURES } from '../../src/domain';

const signal = () => new AbortController().signal;
async function payload() {
  const response = await handleClinicRequest(new Request('https://medipath.invalid/api/clinic-demo?patientId=demo-patient-01'));
  return response.json();
}
function returnPayload(value: unknown) {
  const fetcher = vi.fn(async () => Response.json(value));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());

describe('clinic result client boundary', () => {
  it('accepts the three actual server records and keeps source validation separate from patient review', async () => {
    const data = await payload();
    const fetcher = returnPayload(data);
    const abort = signal();
    const result = await loadClinicResults(undefined, abort);
    expect(fetcher).toHaveBeenCalledWith('/api/clinic-demo?patientId=demo-patient-01', expect.objectContaining({ signal: expect.any(AbortSignal), credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' }));
    expect(result.map(item => item.document.fixtureId)).toEqual(['chest-referral', 'breast-referral', 'chest-negative']);
    for (const item of result) {
      const canonical = SYNTHETIC_FIXTURES.find(fixture => fixture.id === item.document.fixtureId)!;
      expect(item.title).toBe(canonical.title);
      expect(item.document.sections).toEqual(canonical.sections);
      expect(item.document.origin).toBe('clinic_adapter');
      expect(isReadyForAnalysis(item.document)).toBe(true);
      expect(isConfirmed(item.document)).toBe(false);
      expect(item.document.confirmedAt).toBeNull();
      expect(Date.parse(item.receivedAt)).toBeGreaterThanOrEqual(Date.parse(item.date));
      expect(item.document.studyMetadata?.studyId).toBe(`study-${canonical.id}`);
      expect(item.document.studyMetadata?.equipment).toBeNull();
      expect(item.document.studyMetadata?.performedAt).toBe(item.date);
    }
    expect(new Set(result.map(item => item.receivedAt.slice(0, 10))).size).toBe(2);
  });
  it('restricts a requested scenario to that exact server fixture', async () => {
    const response = await handleClinicRequest(new Request('https://medipath.invalid/api/clinic-demo?patientId=demo-patient-01&fixtureId=chest-referral'));
    returnPayload(await response.json());
    expect((await loadClinicResults('chest-referral', signal()))[0].document.fixtureId).toBe('chest-referral');
    returnPayload(await payload());
    await expect(loadClinicResults('chest-referral', signal())).rejects.toThrow(/проверку/iu);
  });
  it.each([
    ['foreign patient', (value: Record<string, unknown>) => { value.patientId = 'another-patient'; }],
    ['foreign clinic', (value: Record<string, unknown>) => { value.clinicId = 'another-clinic'; }],
    ['foreign source', (value: Record<string, unknown>) => { value.source = 'real_clinic'; }],
    ['missing source', (value: Record<string, unknown>) => { delete value.source; }],
    ['empty results', (value: Record<string, unknown>) => { value.records = []; }],
    ['malformed records', (value: Record<string, unknown>) => { value.records = {}; }],
  ])('rejects envelope: %s', async (_name, mutate) => {
    const value = await payload(); mutate(value); returnPayload(value);
    await expect(loadClinicResults(undefined, signal())).rejects.toThrow(/проверку/iu);
  });
  it.each([
    ['foreign patient', { patientId: 'another-patient' }],
    ['foreign clinic', { clinicId: 'another-clinic' }],
    ['unready result', { status: 'processing' }],
    ['revoked result', { status: 'revoked' }],
    ['different source kind', { sourceKind: 'scan' }],
    ['wrong revision', { sourceRevision: 2 }],
    ['wrong study', { studyId: 'another-study' }],
    ['wrong document', { documentId: 'another-document' }],
    ['unknown fixture', { fixtureId: 'unknown' }],
    ['invalid date', { performedAt: 'not-a-date' }],
  ])('rejects record: %s', async (_name, change) => {
    const value = await payload(); Object.assign(value.records[0], change); returnPayload(value);
    await expect(loadClinicResults(undefined, signal())).rejects.toThrow(/проверку/iu);
  });
  it('rejects duplicates and altered medical or identity content', async () => {
    const duplicate = await payload(); duplicate.records.push(duplicate.records[0]); returnPayload(duplicate);
    await expect(loadClinicResults(undefined, signal())).rejects.toThrow(/проверку/iu);
    for (const kind of ['description', 'conclusion', 'recommendations', 'other']) {
      const value = await payload(); value.records[0].sections[kind] += '\nUNKNOWN-PRIVATE-CANARY'; returnPayload(value);
      await expect(loadClinicResults(undefined, signal())).rejects.toThrow(/проверку/iu);
    }
  });
  it('rejects forged study metadata, source attribution or equipment', async () => {
    for (const change of [{ equipment: 'Invented scanner' }, { studyName: 'Another study' }, { source: 'real_integration' }, { performedAt: '2026-01-01' }, { studyId: 'foreign-study' }]) {
      const value = await payload(); Object.assign(value.records[0].studyMetadata, change); returnPayload(value);
      await expect(loadClinicResults(undefined, signal())).rejects.toThrow(/проверку/iu);
    }
    const missing = await payload(); delete missing.records[0].studyMetadata; returnPayload(missing);
    await expect(loadClinicResults(undefined, signal())).rejects.toThrow(/проверку/iu);
  });
  it('does not return partial successful results when a later source record fails validation', async () => {
    const value = await payload(); value.records[2].sourceRevision = 99; returnPayload(value);
    await expect(loadClinicResults(undefined, signal())).rejects.toThrow();
  });
  it('rejects HTTP failures, malformed JSON and network failures with a recoverable message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(loadClinicResults(undefined, signal())).rejects.toThrow(/Повторите/iu);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('INVALID-JSON')));
    await expect(loadClinicResults(undefined, signal())).rejects.toThrow(/проверку|некоррект|повторите/iu);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(loadClinicResults(undefined, signal())).rejects.toThrow(/соединение|повторите/iu);
  });
  it('rejects a missing or impossible publication timestamp', async () => {
    for (const publishedAt of [undefined, 'not-a-date', '2026-10-01T09:00:00+03:00']) {
      const value = await payload(); value.records[0].publishedAt = publishedAt; returnPayload(value);
      await expect(loadClinicResults(undefined, signal())).rejects.toThrow(/проверку/iu);
    }
  });
  it('rejects unknown requested fixture before any network request', async () => {
    const fetcher = returnPayload(await payload());
    await expect(loadClinicResults('PRIVATE-UNKNOWN', signal())).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects an oversized response before parsing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(' '.repeat(70000))));
    await expect(loadClinicResults(undefined, signal())).rejects.toThrow(/размер/iu);
  });
  it('handles a connection dropped while reading the response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('terminated')); } }))));
    await expect(loadClinicResults(undefined, signal())).rejects.toThrow(/Соединение прервалось.*Повторите/iu);
  });
});
