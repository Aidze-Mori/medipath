import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmDocument, createClinicDocument, isConfirmed, isReadyForAnalysis, SYNTHETIC_FIXTURES, updateDocumentSections } from '../../src/domain';
import { analyzeLocal, getReplayAnalysis } from '../../src/engine';
import { acceptDemoResponse, canonicalContent, detectSyntheticFixture, prepareDemoRequest } from '../../src/privacy/policy';
import { assembleDocument } from '../../src/features/intake/sections';
import { toDocument } from '../../src/features/intake/toDocument';
import { handleClinicRequest } from '../../server/clinic';
import { handleAnalyzeRequest } from '../../server/analyze';
import { loadClinicResults } from '../../src/features/patient/clinicAdapter';

const fixture = SYNTHETIC_FIXTURES.find(item => item.id === 'doctor-report')!;
afterEach(() => vi.unstubAllGlobals());

describe('long canonical doctor report', () => {
  it('round-trips its trusted text through section extraction, review and manifest binding', async () => {
    const bytes = await readFile('public/examples/synthetic-doctor-report.txt');
    const fixtureId = await detectSyntheticFixture(new Uint8Array(bytes).buffer);
    expect(fixtureId).toBe('doctor-report');
    const extracted = assembleDocument('txt', 'Учебный отчёт.txt', [{ id: 'text-1', originalText: bytes.toString('utf8'), anchor: 'text-1', warnings: [], method: 'native' }]);
    const draft = toDocument(extracted, 'builtin_fixture', fixtureId!);
    expect(canonicalContent(draft.sections)).toBe(canonicalContent(fixture.sections));
    expect(await prepareDemoRequest(draft)).toBeNull();
    const document = confirmDocument(draft);
    expect((await prepareDemoRequest(document))?.request).toMatchObject({ fixtureId, fixtureRevision: 1, reviewVariantId: 'canonical' });
    const edited = confirmDocument(updateDocumentSections(document, { ...document.sections, conclusion: `${document.sections.conclusion} Исправлено.` }));
    expect(await prepareDemoRequest(edited)).toBeNull();
    expect(getReplayAnalysis(edited)).toBeNull();
  });

  it('keeps only the explicit source referral and a clearly marked deterministic replay', () => {
    const document = createClinicDocument('doctor-report');
    const analysis = analyzeLocal(document);
    expect(analysis.processingStatus).toBe('complete');
    expect(analysis.routeSteps).toHaveLength(1);
    expect(analysis.routeSteps[0]).toMatchObject({ specialtyId: 'pulmonology', basis: 'explicit_document', dueText: 'в течение 2 недель', bookingAllowed: true });
    expect(analysis.routeSteps[0].sourceRefs[0].quote).toBe('Рекомендована консультация пульмонолога в течение 2 недель.');
    expect(analysis.clinicalDemo).toBeUndefined();
    expect(analysis.clinicalReviewed).toBe(false);
    const replay = getReplayAnalysis(document);
    expect(replay?.mode).toBe('synthetic_replay');
    expect(replay?.routeSteps).toEqual(analysis.routeSteps);
    expect(replay?.llmExplanation).toBeUndefined();
  });

  it('passes the server-owned clinic record through the same strict client adapter', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => handleClinicRequest(new Request(`http://localhost${url}`))));
    const records = await loadClinicResults('doctor-report', new AbortController().signal);
    expect(records).toHaveLength(1);
    expect(records[0].document.sections).toEqual(fixture.sections);
    expect(isReadyForAnalysis(records[0].document)).toBe(true);
    expect(isConfirmed(records[0].document)).toBe(false);
    expect(records[0].document.studyMetadata).toMatchObject({ studyId: 'study-doctor-report', studyName: fixture.title, source: 'synthetic_clinic_adapter' });
  });

  it('uses cleaned medical sections for a validated rich provider response without sending metadata', async () => {
    const document = createClinicDocument('doctor-report');
    const prepared = (await prepareDemoRequest(document, 'doctor-report-request-01'))!;
    const findings = (['description', 'conclusion', 'recommendations'] as const).map(sectionId => {
      const quote = fixture.sections[sectionId].split(/(?<=\.)\s/u)[0];
      return { sectionId, quote, explanation: quote };
    });
    const llmExplanation = { summary: fixture.sections.conclusion, findings };
    let providerCalls = 0;
    const response = await handleAnalyzeRequest(new Request('https://medipath.invalid/api/analyze-demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prepared.request) }), {
      env: { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'stub', OPENAI_MODEL: 'stub', UPSTASH_REDIS_REST_URL: 'https://medipath-test.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'stub' },
      fetcher: async (url, init) => {
        if (String(url).includes('upstash')) return Response.json({ result: 1 });
        providerCalls++;
        const input = JSON.parse(JSON.parse(String(init?.body)).input);
        expect(input.sections.map((section: { id: string }) => section.id)).toEqual(['description', 'conclusion', 'recommendations']);
        expect(input.sections[0].text).toContain('Плевральный выпот не выявлен.');
        expect(input.sections[2].text).toContain('в течение 2 недель');
        expect(JSON.stringify(input)).not.toMatch(/Тестов|Примерович|DEMO-REPORT|Место проведения|05\.10\.2026|studyMetadata|filename/);
        return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ statementIds: ['description', 'conclusion', 'recommendations'], explanationIds: [], llmExplanation }) }] }] });
      },
    });
    expect(response.status).toBe(200);
    expect(providerCalls).toBe(1);
    const accepted = acceptDemoResponse(document, prepared.binding, await response.json());
    expect(accepted?.mode).toBe('synthetic_live');
    expect(accepted?.llmExplanation).toEqual(llmExplanation);
    expect(accepted?.routeSteps[0].dueText).toBe('в течение 2 недель');
  });
});
