import type { Analysis, DocumentRecord, RouteStep } from '../domain';
import corpus from '../../data/corpus-release/corpus.json';
import { analyzeLocal } from './index';
import { selectClinicalDemoProposals } from './clinicalDemo';
import { cleanDocumentSections, validDocumentExplanation } from '../privacy/documentContract';
import { minimize } from '../privacy/minimize';

const routeSafetyFields = (step: RouteStep) => ({ actionId: step.actionId, specialtyId: step.specialtyId, basis: step.basis, title: step.title, explanation: step.explanation, dueText: step.dueText, dueAt: step.dueAt, bookingAllowed: step.bookingAllowed, sourceRefs: step.sourceRefs });
export function validateAnalysisEvidence(value: unknown, document: DocumentRecord, requireExplanation = true): value is Analysis {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Analysis;
  if (candidate.corpusVersion !== corpus.corpusVersion || candidate.clinicalReviewed !== false || candidate.mode !== 'synthetic_live' || !Array.isArray(candidate.claims) || !Array.isArray(candidate.routeSteps) || !Array.isArray(candidate.warnings)) return false;
  if ((requireExplanation || candidate.llmExplanation !== undefined) && !validDocumentExplanation(candidate.llmExplanation, cleanDocumentSections(minimize(document.sections).sections))) return false;
  let expected = analyzeLocal(document);
  if (expected.clinicalDemo) {
    if (candidate.clinicalDemo?.generation !== 'validated_live_selection' || !Array.isArray(candidate.clinicalDemo.proposals)) return false;
    try { expected = selectClinicalDemoProposals(expected, candidate.clinicalDemo.proposals.map(proposal => proposal.id)); } catch { return false; }
    if (JSON.stringify(candidate.clinicalDemo) !== JSON.stringify(expected.clinicalDemo)) return false;
  } else if (candidate.clinicalDemo !== undefined) return false;
  if (candidate.summary !== expected.summary || candidate.processingStatus !== expected.processingStatus || JSON.stringify(candidate.warnings) !== JSON.stringify(expected.warnings)) return false;
  if (candidate.claims.length > 8 || candidate.routeSteps.length !== expected.routeSteps.length) return false;
  if (new Set(candidate.claims.map(claim => claim?.id)).size !== candidate.claims.length) return false;
  try {
    if (JSON.stringify(candidate.routeSteps.map(routeSafetyFields)) !== JSON.stringify(expected.routeSteps.map(routeSafetyFields))) return false;
    return candidate.claims.every(claim => {
      if (claim.certainty !== 'as_written' || typeof claim.id !== 'string' || !Array.isArray(claim.sourceRefs) || !Array.isArray(claim.sourceIds)) return false;
      if (claim.kind === 'document_statement') return expected.claims.some(original => original.id === claim.id && original.text === claim.text && JSON.stringify(original.sourceRefs) === JSON.stringify(claim.sourceRefs) && JSON.stringify(original.sourceIds) === JSON.stringify(claim.sourceIds));
      if (claim.kind === 'explanation') return corpus.chunks.some(chunk => claim.id === `explanation-${chunk.id}` && chunk.text === claim.text && claim.sourceIds.length === 1 && claim.sourceIds[0] === chunk.id && claim.sourceRefs.length === 0);
      return false;
    });
  } catch { return false; }
}
