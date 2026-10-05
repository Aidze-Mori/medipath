import { isConfirmed, type DocumentRecord, type StudyMetadata, SECTION_KINDS } from './document';
import { getFixtureDocument, SYNTHETIC_FIXTURES } from './fixtures';

export function getClinicStudyMetadata(fixtureId: string): StudyMetadata {
  const fixture = SYNTHETIC_FIXTURES.find(item => item.id === fixtureId);
  if (!fixture) throw new Error('Учебное исследование не найдено.');
  return {
    studyId: `study-${fixture.id}`, studyName: fixture.id === 'chest-referral' ? 'КТ органов грудной клетки' : fixture.title,
    equipment: null, clinicName: 'Учебная клиника MediPath', source: 'synthetic_clinic_adapter',
    sourceLabel: fixture.inputAdapter === 'third_opinion_demo' ? 'Учебный адаптер «Третье Мнение»' : 'Учебная система клиники',
    performedAt: fixture.id === 'chest-referral' ? '2026-10-04T07:00:00+03:00' : fixture.id === 'breast-referral' ? '2026-10-05T07:30:00+03:00' : '2026-10-05T08:00:00+03:00',
    publishedAt: fixture.id === 'chest-referral' ? '2026-10-04T09:00:00+03:00' : fixture.id === 'breast-referral' ? '2026-10-05T10:15:00+03:00' : '2026-10-05T11:00:00+03:00',
  };
}

// This adapter creates only a canonical, known synthetic source. It never marks
// OCR as reviewed by a patient and never authorizes arbitrary client text.
export function createClinicDocument(fixtureId: string): DocumentRecord {
  const fixture = SYNTHETIC_FIXTURES.find(item => item.id === fixtureId);
  if (!fixture) throw new Error('Результат не найден в учебной системе клиники.');
  return { ...getFixtureDocument(fixtureId), origin: 'clinic_adapter', studyMetadata: getClinicStudyMetadata(fixtureId), sourceValidation: {
    kind: 'clinic_source_validated', fixtureId, sourceRevision: fixture.revision, validatedAt: new Date().toISOString(),
    ...(fixture.inputAdapter ? { studyAdapter: fixture.inputAdapter } : {}),
  } };
}

export function isReadyForAnalysis(document: DocumentRecord): boolean {
  if (document.origin !== 'clinic_adapter') return isConfirmed(document);
  const validation = document.sourceValidation;
  if (document.origin !== 'clinic_adapter' || !validation || document.revision !== 1 || document.extractionStatus !== 'ready' || document.unreadPages.length) return false;
  const fixture = SYNTHETIC_FIXTURES.find(item => item.id === document.fixtureId);
  return !!fixture && validation.kind === 'clinic_source_validated' && validation.fixtureId === fixture.id && validation.sourceRevision === fixture.revision && validation.studyAdapter === fixture.inputAdapter &&
    SECTION_KINDS.every(kind => document.sections[kind] === fixture.sections[kind] && document.originalSections[kind] === fixture.sections[kind]);
}
