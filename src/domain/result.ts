import type { ProcessingMode, SourceAnchor } from './document';
import type { RouteStep, SpecialtyId } from './route';
export interface ClinicalDemoSource {
  id: string; title: string; version: string; url: string; section: string; quote: string;
  checkedAt: string; review: 'technical_only'; clinicalReviewed: false;
}
export interface ClinicalDemoProposal {
  id: string; kind: 'specialist' | 'additional_exam' | 'no_additional_exam';
  title: string; rationale: string; specialtyId: SpecialtyId | null;
  sourceIds: string[]; sourceRefs: SourceAnchor[]; requiresDoctorReview: true;
}
export interface ClinicalDemo {
  scenarioId: string; registryVersion: string; generation: 'prepared_clinical_demo' | 'validated_live_selection';
  inputAdapter: 'third_opinion_demo'; inputLabel: string;
  sources: ClinicalDemoSource[]; proposals: ClinicalDemoProposal[];
}
export interface Claim { id: string; text: string; kind: 'document_statement' | 'explanation' | 'system_proposal'; sourceRefs: SourceAnchor[]; sourceIds: string[]; certainty: 'as_written' }
export interface Analysis {
  documentId: string; documentRevision: number; corpusVersion: string; mode: ProcessingMode;
  processingStatus: 'complete' | 'partial' | 'insufficient' | 'needs_review';
  summary: string; claims: Claim[]; routeSteps: RouteStep[]; warnings: string[]; clinicalReviewed: false;
  llmExplanation?: { summary: string; findings: { sectionId: 'description' | 'conclusion' | 'recommendations' | 'unclassified'; quote: string; explanation: string }[] };
  clinicalDemo?: ClinicalDemo;
}
export interface DemoReviewBinding {
  fixtureId: string; fixtureRevision: number; reviewVariantId: string; contentDigest: string;
  documentId: string; documentRevision: number;
  requestId: string;
}
export interface DemoRequest { fixtureId: string; fixtureRevision: number; reviewVariantId: string; operation: 'explain'; requestId: string }
export interface DemoResponse { binding: Omit<DemoReviewBinding, 'documentId' | 'documentRevision'> & { requestId: string }; analysis: Analysis }
