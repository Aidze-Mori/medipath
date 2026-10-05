import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { confirmDocument, createClinicDocument, isReadyForAnalysis, SYNTHETIC_FIXTURES } from '../../src/domain';
import { analyzeLocal, getReplayAnalysis } from '../../src/engine';
import { acceptDemoResponse, canonicalContent, detectSyntheticFixture, prepareDemoRequest } from '../../src/privacy/policy';
import { assembleDocument } from '../../src/features/intake/sections';
import { toDocument } from '../../src/features/intake/toDocument';
import { handleAnalyzeRequest } from '../../server/analyze';

const fixture = SYNTHETIC_FIXTURES.find(item => item.id === 'explicit-urgent')!;
const urgentQuote = 'Немедленно обратиться за экстренной медицинской помощью.';

describe('canonical synthetic urgent examination report', () => {
  it('binds the trusted text and structured clinic record to fixture revision 2', async () => {
    const bytes = await readFile('public/examples/synthetic-explicit-urgent.txt');
    expect(await detectSyntheticFixture(new Uint8Array(bytes).buffer)).toBe(fixture.id);
    const extracted = assembleDocument('txt', 'Учебный осмотр.txt', [{ id: 'text-1', originalText: bytes.toString('utf8'), anchor: 'text-1', warnings: [], method: 'native' }]);
    const draft = toDocument(extracted, 'builtin_fixture', fixture.id);
    expect(canonicalContent(draft.sections)).toBe(canonicalContent(fixture.sections));
    expect(await prepareDemoRequest(draft)).toBeNull();
    expect((await prepareDemoRequest(confirmDocument(draft)))?.request).toMatchObject({ fixtureId: fixture.id, fixtureRevision: 2, reviewVariantId: 'canonical' });
    const clinic = createClinicDocument(fixture.id);
    expect(clinic.revision).toBe(1);
    expect(clinic.sourceValidation?.sourceRevision).toBe(2);
    expect(isReadyForAnalysis(clinic)).toBe(true);
  });

  it('preserves only the explicit urgent source instruction and never creates routine booking', () => {
    const document = createClinicDocument(fixture.id);
    const analysis = analyzeLocal(document);
    expect(analysis.routeSteps).toHaveLength(1);
    expect(analysis.routeSteps[0]).toMatchObject({ actionId: 'source-urgent-instruction', basis: 'explicit_document', specialtyId: null, bookingAllowed: false, dueText: urgentQuote });
    expect(analysis.routeSteps[0].sourceRefs[0].quote).toBe(urgentQuote);
    expect(analysis.clinicalDemo).toBeUndefined();
    expect(analysis.clinicalReviewed).toBe(false);
    expect(getReplayAnalysis(document)).toBeNull();
    expect(document.sections.conclusion).toContain('окончательный диагноз не сформулирован');
    expect(document.sections.description).not.toContain('технический стоп-сценарий');
  });

  it('admits revision 2 through the server with minimization while rejecting retired revision 1 before provider', async () => {
    const document = createClinicDocument(fixture.id);
    const prepared = (await prepareDemoRequest(document, 'urgent-report-request-02'))!;
    const llmExplanation = { summary: 'Врач сохранил прямое указание немедленно обратиться за экстренной медицинской помощью. Причина симптомов в протоколе не установлена.', findings: [{ sectionId: 'recommendations', quote: urgentQuote, explanation: 'В протоколе указано немедленное обращение за экстренной медицинской помощью.' }] };
    let providerCalls = 0;
    const deps = {
      env: { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'stub', OPENAI_MODEL: 'stub', UPSTASH_REDIS_REST_URL: 'https://medipath-test.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'stub' },
      fetcher: (async (url, init) => {
        if (String(url).includes('upstash')) return Response.json({ result: 1 });
        providerCalls++;
        const input = JSON.parse(JSON.parse(String(init?.body)).input);
        expect(input.sections.map((section: { id: string }) => section.id)).toEqual(['description', 'conclusion', 'recommendations']);
        expect(input.sections[0].text).toContain('150/90');
        expect(input.sections[2].text).toContain(urgentQuote);
        expect(JSON.stringify(input)).not.toMatch(/Тестова|Примеровна|Демонстрационный|Алексей|DEMO-URGENT|Место проведения|05\.10\.2026/);
        return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ statementIds: ['conclusion', 'recommendations'], explanationIds: [], llmExplanation }) }] }] });
      }) as typeof fetch,
    };
    const request = (body: unknown) => new Request('https://medipath.invalid/api/analyze-demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await handleAnalyzeRequest(request({ ...prepared.request, fixtureRevision: 1 }), deps)).status).toBe(404);
    expect(providerCalls).toBe(0);
    const response = await handleAnalyzeRequest(request(prepared.request), deps);
    expect(response.status).toBe(200);
    expect(providerCalls).toBe(1);
    const accepted = acceptDemoResponse(document, prepared.binding, await response.json());
    expect(accepted?.mode).toBe('synthetic_live');
    expect(accepted?.llmExplanation).toEqual(llmExplanation);
    expect(accepted?.routeSteps).toHaveLength(1);
    expect(accepted?.routeSteps[0]).toMatchObject({ actionId: 'source-urgent-instruction', specialtyId: null, bookingAllowed: false });
  });
});
