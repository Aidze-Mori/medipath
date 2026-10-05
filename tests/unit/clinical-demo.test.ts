import { describe, expect, it, vi, afterEach } from 'vitest';
import { confirmDocument, createClinicDocument, createDocument, getFixtureDocument, isReadyForAnalysis, updateDocumentSections } from '../../src/domain';
import { analyzeLocal, getDocumentNextStep, getClinicalDemo } from '../../src/engine';
import { handleAnalyzeRequest } from '../../server/analyze';
import { handleClinicRequest } from '../../server/clinic';
import { loadClinicResults } from '../../src/features/patient/clinicAdapter';
import { acceptDemoResponse, prepareDemoRequest } from '../../src/privacy/policy';
import { validateAnalysisEvidence } from '../../src/engine/validateEvidence';
import { runModel } from '../../server/model';
import { minimize } from '../../src/privacy/minimize';
import { stubExplanation } from './model-response-helper';

const env = { LLM_PROVIDER: 'codex_cli', CODEX_MODEL: 'test', ALLOW_LOCAL_LIVE: '1' };
const documentWith = (recommendations: string, conclusion = '', description = '') => confirmDocument(createDocument({ sections: { description, conclusion, recommendations, other: '' } }));
afterEach(() => vi.unstubAllGlobals());

describe('explicit document examination next step', () => {
  it('requires current confirmation and never chooses a specialty', () => {
    const draft = createDocument({ sections: { description: '', conclusion: '', recommendations: 'Рекомендовано контрольное УЗИ.', other: '' } });
    expect(getDocumentNextStep(draft)).toBeNull();
    const doc = confirmDocument(draft);
    expect(getDocumentNextStep(doc)).toMatchObject({ kind: 'additional_exam', title: 'Обсудить рекомендованное обследование' });
    expect(getDocumentNextStep(doc)?.sourceRefs[0].quote).toBe(doc.sections.recommendations);
    expect(analyzeLocal(doc).routeSteps).toEqual([]);
    expect(getDocumentNextStep(updateDocumentSections(doc, { ...doc.sections, recommendations: 'Не требуется контрольное УЗИ.' }))).toBeNull();
  });
  it.each(['Дополнительное исследование не требуется.', 'Повторное УЗИ не рекомендовано.', 'Нет показаний к дополнительному обследованию.', 'Рекомендовано не выполнять повторное УЗИ.', 'Необходимости в дообследовании нет.', 'Показаний к дообследованию нет.', 'Необходимость дополнительного обследования отсутствует.', 'Отсутствуют показания к дополнительному обследованию.'])('preserves a negative source: %s', text => {
    expect(getDocumentNextStep(documentWith(text))?.kind).toBe('no_additional_exam');
  });
  it.each([
    'При необходимости рекомендовано контрольное УЗИ.',
    'Рекомендовано контрольное УЗИ, если появятся жалобы.',
    'Ранее рекомендовано контрольное УЗИ.',
    'Рекомендовано контрольное УЗИ. Дополнительное обследование не требуется.',
    'Рекомендовано контрольное УЗИ. Оно не показано.',
    'Рекомендовано контрольное УЗИ. Только при наличии жалоб.',
    'Дополнительное исследование не требуется, но рекомендовано контрольное УЗИ.',
    'Нет необходимости отменять контрольное УЗИ.',
    'Не рекомендовано отказываться от дообследования.',
    'При отсутствии динамики рекомендовано контрольное УЗИ.',
  ])('does not turn ambiguity into a new examination: %s', text => {
    expect(getDocumentNextStep(documentWith(text))?.kind).toBe('clarification');
  });
  it('keeps source conflicts and independent explicit referrals', () => {
    expect(getDocumentNextStep(documentWith('Рекомендовано контрольное УЗИ.', 'Очаг слева.', 'Очаг справа.'))?.kind).toBe('clarification');
    const doc = documentWith('Рекомендована консультация терапевта. Рекомендовано контрольное УЗИ.');
    expect(analyzeLocal(doc).routeSteps[0].specialtyId).toBe('therapy');
    expect(getDocumentNextStep(doc)?.kind).toBe('additional_exam');
  });
  it('supports unclassified confirmed text without guessing from an ordinary observation', () => {
    const doc = confirmDocument(createDocument({ sections: { description: '', conclusion: '', recommendations: '', other: 'Рекомендовано повторное УЗИ.' } }));
    expect(getDocumentNextStep(doc)?.kind).toBe('additional_exam');
    expect(getDocumentNextStep(documentWith('', 'BI-RADS 4.', 'УЗИ выполнено.'))).toBeNull();
  });
});

describe('bounded clinical demonstration', () => {
  it('adds only a prepared, doctor-review proposal for an exact canonical scenario', () => {
    const document = createClinicDocument('clinical-birads4');
    const analysis = analyzeLocal(document);
    expect(analysis.mode).toBe('personal_local');
    expect(analysis.clinicalDemo).toMatchObject({ generation: 'prepared_clinical_demo', inputAdapter: 'third_opinion_demo', inputLabel: 'Учебный адаптер «Третье Мнение»' });
    expect(analysis.clinicalDemo?.proposals[0]).toMatchObject({ specialtyId: 'oncology', requiresDoctorReview: true });
    expect(analysis.routeSteps[0]).toMatchObject({ basis: 'demo_only', specialtyId: 'oncology', dueText: null });
    expect(analysis.clinicalDemo?.sources[0]).toMatchObject({ version: '598_3 · 2024', url: 'https://cr.minzdrav.gov.ru/view-cr/598_3', clinicalReviewed: false, review: 'technical_only' });
    expect(analysis.clinicalReviewed).toBe(false);
  });
  it('keeps required, not-required and unspecified-specialty examinations distinct', () => {
    const incomplete = analyzeLocal(createClinicDocument('clinical-birads0'));
    expect(incomplete.clinicalDemo?.proposals.map(proposal => proposal.kind)).toEqual(['specialist', 'additional_exam']);
    expect(getDocumentNextStep(createClinicDocument('clinical-birads0'))?.kind).toBe('additional_exam');
    const routine = analyzeLocal(createClinicDocument('clinical-birads2'));
    expect(routine.routeSteps).toEqual([]);
    expect(routine.clinicalDemo?.proposals[0].kind).toBe('no_additional_exam');
    expect(getDocumentNextStep(createClinicDocument('clinical-birads2'))?.kind).toBe('no_additional_exam');
    const plain = createClinicDocument('exam-without-specialty');
    expect(getDocumentNextStep(plain)?.kind).toBe('additional_exam');
    expect(analyzeLocal(plain).routeSteps).toEqual([]);
    expect(analyzeLocal(plain).clinicalDemo).toBeUndefined();
  });
  it('does not admit arbitrary text, copied IDs, changed clinical contents or unconfirmed fixtures', () => {
    const canonical = getFixtureDocument('clinical-birads4');
    expect(getClinicalDemo(canonical)).toBeUndefined();
    const pasted = confirmDocument(createDocument({ sections: canonical.sections, fixtureId: canonical.fixtureId }));
    expect(getClinicalDemo(pasted)).toBeUndefined();
    expect(analyzeLocal(pasted).routeSteps).toEqual([]);
    const edited = confirmDocument(updateDocumentSections(confirmDocument(canonical), { ...canonical.sections, conclusion: 'Слева BI-RADS 2.' }));
    expect(getClinicalDemo(edited)).toBeUndefined();
    expect(analyzeLocal(edited).routeSteps).toEqual([]);
    const source = createClinicDocument('clinical-birads4');
    expect(isReadyForAnalysis({ ...source, sourceValidation: { ...source.sourceValidation!, studyAdapter: undefined } })).toBe(false);
  });
  it('carries only canonical server-owned educational study metadata through the adapter', async () => {
    const response = await handleClinicRequest(new Request('https://medipath.invalid/api/clinic-demo?patientId=demo-patient-01&fixtureId=clinical-birads4'));
    const payload = await response.json();
    expect(payload.records[0]).toMatchObject({ studyAdapter: 'third_opinion_demo', studyAdapterLabel: 'Учебный адаптер «Третье Мнение»' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)));
    const rows = await loadClinicResults('clinical-birads4', new AbortController().signal);
    expect(rows[0].document.sourceValidation?.studyAdapter).toBe('third_opinion_demo');
    payload.records[0].studyAdapterLabel = 'Реальная интеграция';
    await expect(loadClinicResults('clinical-birads4', new AbortController().signal)).rejects.toThrow(/проверку/u);
  });
  it('validates actual provider selection, revision binding and every clinical source field', async () => {
    const doc = createClinicDocument('clinical-birads0');
    const prepared = (await prepareDemoRequest(doc, 'clinical-test-0001'))!;
    const response = await handleAnalyzeRequest(new Request('http://localhost/api/analyze-demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prepared.request) }), {
      env, localDevelopment: true, codexRunner: async invocation => {
        const input = JSON.parse(invocation.input);
        expect(input.clinicalDemo.sources[0].url).toBe('https://cr.minzdrav.gov.ru/view-cr/598_3');
        expect(input.sections.some((section: { text: string }) => section.text.includes('BI-RADS 0'))).toBe(true);
        return JSON.stringify({ statementIds: ['conclusion'], explanationIds: [], clinicalProposalIds: ['birads0-discuss-oncology'], llmExplanation: stubExplanation(doc.sections) });
      },
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    const accepted = acceptDemoResponse(doc, prepared.binding, result)!;
    expect(accepted.clinicalDemo?.generation).toBe('validated_live_selection');
    expect(accepted.clinicalDemo?.proposals.map(proposal => proposal.id)).toEqual(['birads0-discuss-oncology']);
    expect(accepted.mode).toBe('synthetic_live');
    expect(accepted.routeSteps).toHaveLength(1);
    const changed = confirmDocument(updateDocumentSections(doc, { ...doc.sections, conclusion: 'Другой результат.' }));
    expect(acceptDemoResponse(changed, prepared.binding, result)).toBeNull();
    for (const mutate of [
      (value: typeof result.analysis) => { value.clinicalDemo.proposals[0].specialtyId = 'therapy'; },
      (value: typeof result.analysis) => { value.clinicalDemo.sources[0].quote = 'Invented recommendation'; },
      (value: typeof result.analysis) => { value.clinicalDemo.generation = 'prepared_clinical_demo'; },
      (value: typeof result.analysis) => { value.clinicalDemo.proposals[0].requiresDoctorReview = false; },
    ]) {
      const forged = structuredClone(result.analysis); mutate(forged);
      expect(validateAnalysisEvidence(forged, createClinicDocument('clinical-birads0'))).toBe(false);
    }
  });
  it.each(['invented-proposal', 'birads2-routine-screening'])('rejects an unsupported provider candidate: %s', async id => {
    const document = createClinicDocument('clinical-birads4');
    await expect(runModel(minimize(document.sections).sections, [], { env, localDevelopment: true, codexRunner: async () => JSON.stringify({ statementIds: ['conclusion'], explanationIds: [], clinicalProposalIds: [id] }) }, getClinicalDemo(document))).rejects.toMatchObject({ code: 'invalid_model_response' });
  });
  it('lets the provider withhold every proposal without secretly retaining a doctor route', async () => {
    const document = createClinicDocument('clinical-birads4');
    const prepared = (await prepareDemoRequest(document, 'clinical-test-empty'))!;
    const response = await handleAnalyzeRequest(new Request('http://localhost/api/analyze-demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prepared.request) }), { env, localDevelopment: true, codexRunner: async () => JSON.stringify({ statementIds: ['conclusion'], explanationIds: [], clinicalProposalIds: [], llmExplanation: stubExplanation(document.sections) }) });
    expect(response.status).toBe(200);
    const accepted = acceptDemoResponse(document, prepared.binding, await response.json())!;
    expect(accepted.clinicalDemo?.proposals).toEqual([]);
    expect(accepted.routeSteps).toEqual([]);
  });
});
