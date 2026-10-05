import { describe, expect, it } from 'vitest';
import { confirmDocument, createClinicDocument, isReadyForAnalysis, getFixtureDocument, updateDocumentSections } from '../../src/domain';
import { analyzeLocal } from '../../src/engine';
import { mergeClinicStudy, sameDemoStudy } from '../../src/features/patient/studyIdentity';
import { matchingPlan } from '../../src/features/patient/plans';

const makeSource = () => {
  const document = confirmDocument(getFixtureDocument('chest-referral'));
  return { document, title: 'КТ', analysis: analyzeLocal(document) };
};
describe('stable study and plan identity', () => {
  it('recognizes the same canonical study from PDF and clinic, but never merges edited or personal text', () => {
    const pdf = getFixtureDocument('chest-referral');
    const clinic = createClinicDocument('chest-referral');
    expect(sameDemoStudy(pdf, clinic)).toBe(true);
    expect(sameDemoStudy(pdf, { ...clinic, origin: 'local_file' })).toBe(false);
    expect(sameDemoStudy(pdf, updateDocumentSections(clinic, { ...clinic.sections, conclusion: 'Другой результат' }))).toBe(false);
    expect(sameDemoStudy(pdf, createClinicDocument('breast-referral'))).toBe(false);
  });
  it('adopts a validated clinic source for an unconfirmed canonical draft without a duplicate or fake OCR confirmation', () => {
    const draft = getFixtureDocument('chest-referral');
    const merged = mergeClinicStudy(draft, createClinicDocument('chest-referral'));
    expect(merged.id).toBe(draft.id);
    expect(isReadyForAnalysis(merged)).toBe(true);
    expect(merged.confirmedAt).toBeNull();
    expect(merged.studyMetadata?.studyId).toBe('study-chest-referral');
    const confirmed = confirmDocument(draft);
    expect(mergeClinicStudy(confirmed, createClinicDocument('chest-referral')).confirmedAt).toBe(confirmed.confirmedAt);
  });
  it('reuses a draft with unchanged inputs and preserves manual choices, independent of selection order', () => {
    const first = makeSource(), second = makeSource();
    const plan = { id: 'plan', createdAt: '2026-10-05', completedAt: null, documents: [first, second], additionalSteps: [{ ...first.analysis.routeSteps[0], id: 'manual:1' }], deferredIds: ['deferred'] };
    expect(matchingPlan([plan], [second, first])).toBe(plan);
    expect(matchingPlan([plan], [{ ...first, document: { ...first.document, revision: 2 } }, second])).toBeUndefined();
    expect(matchingPlan([plan], [{ ...first, analysis: { ...first.analysis, mode: 'synthetic_live' } }, second])).toBeUndefined();
  });
});
