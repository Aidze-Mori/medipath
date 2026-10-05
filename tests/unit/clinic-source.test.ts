import { describe, expect, it } from 'vitest';
import { confirmDocument, createClinicDocument, getFixtureDocument, isConfirmed, isReadyForAnalysis, SYNTHETIC_FIXTURES, updateDocumentSections, type DocumentRecord } from '../../src/domain';
import { analyzeLocal } from '../../src/engine';
import { getReplayAnalysis } from '../../src/engine/replay';
import { prepareDemoRequest } from '../../src/privacy/policy';

describe('structured clinic source readiness', () => {
  it.each(SYNTHETIC_FIXTURES)('accepts canonical ready source $id without patient OCR confirmation', fixture => {
    const document = createClinicDocument(fixture.id);
    expect(document.origin).toBe('clinic_adapter');
    expect(document.confirmedRevision).toBeNull();
    expect(document.confirmedAt).toBeNull();
    expect(isConfirmed(document)).toBe(false);
    expect(isReadyForAnalysis(document)).toBe(true);
    expect(document.sourceValidation).toMatchObject({ kind: 'clinic_source_validated', fixtureId: fixture.id, sourceRevision: fixture.revision });
    expect(() => analyzeLocal(document)).not.toThrow();
    expect(analyzeLocal(document).clinicalReviewed).toBe(false);
  });

  it('rejects unknown records and unreviewed uploads', () => {
    expect(() => createClinicDocument('unknown')).toThrow(/не найден/iu);
    const upload = getFixtureDocument('chest-referral');
    expect(isReadyForAnalysis(upload)).toBe(false);
    expect(isReadyForAnalysis(confirmDocument(upload))).toBe(true);
  });

  it('requires matching source version, identity, current/original content and extraction state', () => {
    const document = createClinicDocument('chest-referral');
    const invalid: DocumentRecord[] = [
      { ...document, sourceValidation: undefined },
      { ...document, fixtureId: 'breast-referral' },
      { ...document, sourceValidation: { ...document.sourceValidation!, fixtureId: 'breast-referral' } },
      { ...document, sourceValidation: { ...document.sourceValidation!, sourceRevision: 99 } },
      { ...document, sourceValidation: { ...document.sourceValidation!, kind: 'patient_confirmed' as 'clinic_source_validated' } },
      { ...document, revision: 2 },
      { ...document, extractionStatus: 'reading' },
      { ...document, extractionStatus: 'failed' },
      { ...document, unreadPages: [2] },
      { ...document, sections: { ...document.sections, conclusion: 'Другой результат' } },
      { ...document, originalSections: { ...document.originalSections, description: 'Другой исходник' } },
      { ...document, sections: { ...document.sections, other: 'Личный идентификатор' } },
    ];
    for (const candidate of invalid) {
      expect(isReadyForAnalysis(candidate)).toBe(false);
      expect(() => analyzeLocal(candidate)).toThrow();
      expect(getReplayAnalysis(candidate)).toBeNull();
    }
  });

  it('does not allow patient confirmation to bypass invalid clinic source validation', async () => {
    const document = createClinicDocument('chest-referral');
    const invalid = confirmDocument({ ...document, sourceValidation: { ...document.sourceValidation!, sourceRevision: 99 } });
    expect(isConfirmed(invalid)).toBe(true);
    expect(isReadyForAnalysis(invalid)).toBe(false);
    expect(await prepareDemoRequest(invalid)).toBeNull();
    expect(getReplayAnalysis(invalid)).toBeNull();
  });

  it('invalidates source permission on edits while preserving original provenance and requiring a new review', async () => {
    const document = createClinicDocument('chest-referral');
    const edited = updateDocumentSections(document, { ...document.sections, conclusion: 'Исправленное заключение.' });
    expect(edited.origin).toBe('local_file');
    expect(edited.revision).toBe(2);
    expect(edited.sourceValidation).toBeUndefined();
    expect(edited.mode).toBe('personal_local');
    expect(edited.confirmedRevision).toBeNull();
    expect(edited.confirmedAt).toBeNull();
    expect(edited.originalSections).toEqual(document.originalSections);
    expect(edited.blocks).toEqual(document.blocks);
    expect(edited.sectionAnchors).toEqual(document.sectionAnchors);
    expect(isReadyForAnalysis(edited)).toBe(false);
    expect(await prepareDemoRequest(edited)).toBeNull();
    expect(getReplayAnalysis(edited)).toBeNull();
    const reviewed = confirmDocument(edited);
    expect(isReadyForAnalysis(reviewed)).toBe(true);
    expect(analyzeLocal(reviewed).mode).toBe('personal_local');
    expect(await prepareDemoRequest(reviewed)).toBeNull();
    expect(getReplayAnalysis(reviewed)).toBeNull();
    const restored = confirmDocument(updateDocumentSections(reviewed, document.sections));
    expect(restored.revision).toBe(3);
    expect(restored.origin).toBe('local_file');
    expect(await prepareDemoRequest(restored)).toBeNull();
    expect(getReplayAnalysis(restored)).toBeNull();
  });

  it('keeps source validation when there is no actual edit', () => {
    const document = createClinicDocument('chest-referral');
    expect(updateDocumentSections(document, { ...document.sections })).toBe(document);
    expect(isReadyForAnalysis(document)).toBe(true);
  });
});

describe('saved evidence for validated clinic source', () => {
  it('labels replay honestly and retains the current document identity', () => {
    const document = createClinicDocument('chest-referral');
    const result = getReplayAnalysis(document);
    expect(result?.mode).toBe('synthetic_replay');
    expect(result?.documentId).toBe(document.id);
    expect(result?.documentRevision).toBe(document.revision);
    expect(result?.clinicalReviewed).toBe(false);
    expect(result?.routeSteps).toHaveLength(1);
    expect(document.confirmedRevision).toBeNull();
  });

  it('does not let copied content or a forged origin unlock saved evidence', () => {
    const document = createClinicDocument('chest-referral');
    expect(getReplayAnalysis({ ...document, sourceValidation: undefined })).toBeNull();
    expect(getReplayAnalysis(confirmDocument({ ...document, origin: 'paste' }))).toBeNull();
    expect(getReplayAnalysis(confirmDocument({ ...document, origin: 'local_file' }))).toBeNull();
  });
});
