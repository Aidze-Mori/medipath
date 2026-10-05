import { isReadyForAnalysis, SYNTHETIC_FIXTURES, type DocumentRecord } from '../../domain';
import { canonicalContent } from '../../privacy/policy';

/** One prepared study may arrive through its PDF or the clinic adapter. Personal edits never merge. */
export function sameDemoStudy(left: DocumentRecord, right: DocumentRecord): boolean {
  if (!left.fixtureId || left.fixtureId !== right.fixtureId) return false;
  const fixture = SYNTHETIC_FIXTURES.find(item => item.id === left.fixtureId);
  if (!fixture) return false;
  const canonical = canonicalContent(fixture.sections);
  return [left, right].every(document => ['builtin_fixture', 'clinic_adapter'].includes(document.origin)
    && canonicalContent(document.sections) === canonical
    && canonicalContent(document.originalSections) === canonical);
}

/** A checked clinic source can replace an unconfirmed canonical draft without pretending OCR was confirmed. */
export function mergeClinicStudy(existing: DocumentRecord, incoming: DocumentRecord): DocumentRecord {
  if (!sameDemoStudy(existing, incoming)) return existing;
  return isReadyForAnalysis(existing)
    ? { ...existing, studyMetadata: incoming.studyMetadata }
    : { ...incoming, id: existing.id };
}
