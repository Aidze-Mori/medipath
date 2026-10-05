import { isReadyForAnalysis, SECTION_KINDS, sourceAnchor, SYNTHETIC_FIXTURES, type Analysis, type ClinicalDemo, type ClinicalDemoProposal, type ClinicalDemoSource, type DocumentRecord, type RouteStep, type SectionKind } from '../domain';
import registry from '../../data/synthetic/clinical-scenarios.json';
import manifest from '../../data/corpus-release/manifest.json';

export const CLINICAL_DEMO_VERSION = registry.version;
export const THIRD_OPINION_DEMO_LABEL = 'Учебный адаптер «Третье Мнение»';
export const CLINICAL_DEMO_SOURCES = registry.sources as ClinicalDemoSource[];

/** These reviewed technical examples never generalize from arbitrary patient text. */
export function getClinicalDemo(document: DocumentRecord): ClinicalDemo | undefined {
  if (!isReadyForAnalysis(document) || !['builtin_fixture', 'clinic_adapter'].includes(document.origin)) return undefined;
  const fixture = SYNTHETIC_FIXTURES.find(item => item.id === document.fixtureId);
  const scenario = registry.scenarios.find(item => item.fixtureId === fixture?.id);
  if (!fixture || !scenario || fixture.inputAdapter !== 'third_opinion_demo' ||
    !manifest.variants.some(item => item.fixtureId === fixture.id && item.fixtureRevision === fixture.revision && item.reviewVariantId === 'canonical') ||
    !SECTION_KINDS.every(kind => document.sections[kind] === fixture.sections[kind] && document.originalSections[kind] === fixture.sections[kind])) return undefined;
  const proposals = scenario.proposals.map(proposal => ({
    id: proposal.id, kind: proposal.kind, title: proposal.title, rationale: proposal.rationale,
    specialtyId: proposal.specialtyId, sourceIds: [...proposal.sourceIds], requiresDoctorReview: true,
    sourceRefs: [sourceAnchor(document, proposal.evidenceSection as SectionKind, document.sections[proposal.evidenceSection as SectionKind])],
  })) as ClinicalDemoProposal[];
  return {
    scenarioId: fixture.id, registryVersion: CLINICAL_DEMO_VERSION, generation: 'prepared_clinical_demo', inputAdapter: 'third_opinion_demo', inputLabel: THIRD_OPINION_DEMO_LABEL,
    sources: CLINICAL_DEMO_SOURCES.filter(source => proposals.some(proposal => proposal.sourceIds.includes(source.id))), proposals,
  };
}

export function clinicalDemoRoutes(document: DocumentRecord, demo: ClinicalDemo): RouteStep[] {
  // Examination proposals appear as explanation cards, never an invented doctor or booked procedure.
  return demo.proposals.filter(proposal => proposal.kind === 'specialist' && proposal.specialtyId).map(proposal => ({
    id: `${document.id}:r${document.revision}:${proposal.id}`, actionId: proposal.id,
    specialtyId: proposal.specialtyId, basis: 'demo_only', title: proposal.title,
    explanation: `${proposal.rationale} Учебный сценарий; клиническая валидация не выполнена.`,
    sourceRefs: proposal.sourceRefs, dueText: null, dueAt: null, bookingAllowed: true,
  }));
}

export function selectClinicalDemoProposals(analysis: Analysis, selectedIds: string[]): Analysis {
  const demo = analysis.clinicalDemo;
  if (!demo || selectedIds.some(id => !demo.proposals.some(proposal => proposal.id === id)) || new Set(selectedIds).size !== selectedIds.length) throw new Error('Неизвестное учебное клиническое предложение.');
  return {
    ...analysis,
    clinicalDemo: { ...demo, generation: 'validated_live_selection', proposals: demo.proposals.filter(proposal => selectedIds.includes(proposal.id)) },
    routeSteps: analysis.routeSteps.filter(step => step.basis !== 'demo_only' || selectedIds.includes(step.actionId)),
  };
}
