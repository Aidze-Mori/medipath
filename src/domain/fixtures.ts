import { createDocument, type DocumentRecord, type DocumentSections } from './document';
import fixtureData from '../../data/synthetic/fixtures.json';
export interface SyntheticFixture {
  id: string; revision: number; title: string; subtitle: string;
  family: 'chest' | 'breast' | 'safety'; sections: DocumentSections;
  expected: 'referral' | 'insufficient' | 'conflict' | 'urgent';
  provenance: 'authored_synthetic'; clinicalReviewed: false;
  inputAdapter?: 'third_opinion_demo';
}
export const SYNTHETIC_FIXTURES = fixtureData as SyntheticFixture[];
export function getFixtureDocument(id: string): DocumentRecord {
  const fixture = SYNTHETIC_FIXTURES.find(candidate => candidate.id === id);
  if (!fixture) throw new Error('Неизвестный учебный пример.');
  return createDocument({ sections: fixture.sections, origin: 'builtin_fixture', fixtureId: id });
}
