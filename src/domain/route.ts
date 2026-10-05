import type { SourceAnchor } from './document';
export type SpecialtyId = 'pulmonology' | 'mammology' | 'oncology' | 'therapy';
export interface RouteStep {
  id: string; actionId: string; specialtyId: SpecialtyId | null;
  basis: 'explicit_document' | 'demo_only' | 'needs_review';
  title: string; explanation: string; sourceRefs: SourceAnchor[];
  dueText: string | null; dueAt: string | null; bookingAllowed: boolean;
}
