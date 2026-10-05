import { createClinicDocument, isReadyForAnalysis, SYNTHETIC_FIXTURES, type Analysis, type DocumentRecord } from '../domain';
import { canonicalContent } from '../privacy/policy';
import { analyzeLocal } from './index';
import { validateAnalysisEvidence } from './validateEvidence';
import replays from '../../data/synthetic/replay.json';
import manifest from '../../data/corpus-release/manifest.json';

export function getReplayAnalysis(document: DocumentRecord): Analysis | null {
  if (!isReadyForAnalysis(document) || !['builtin_fixture', 'clinic_adapter'].includes(document.origin)) return null;
  const fixture = SYNTHETIC_FIXTURES.find(candidate => candidate.id === document.fixtureId);
  const saved = replays.cases.find(candidate => candidate.fixtureId === document.fixtureId);
  const released = manifest.variants.find(candidate => candidate.fixtureId === document.fixtureId && candidate.fixtureRevision === fixture?.revision && candidate.reviewVariantId === 'canonical');
  if (!fixture || !saved || !released || saved.fixtureRevision !== fixture.revision || saved.contentDigest !== released.contentDigest || canonicalContent(document.sections) !== canonicalContent(fixture.sections)) return null;
  if (!validateAnalysisEvidence({ ...saved.analysis, mode: 'synthetic_live' }, createClinicDocument(fixture.id), false)) return null;
  const baseline = analyzeLocal(document);
  return { ...baseline, claims: saved.analysis.claims.map(claim => baseline.claims.find(current => current.id === claim.id) ?? claim), mode: 'synthetic_replay' } as Analysis;
}
