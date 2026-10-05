import type { Analysis, DocumentRecord, RouteStep, SourceAnchor } from '../../domain';
import type { Booking } from '../booking/state';

export interface PlanDocument { document: DocumentRecord; title: string; analysis: Analysis }
export interface VisitSource { documentId: string; revision: number; stepId: string; title: string }
export interface PlanVisit { step: RouteStep; sources: VisitSource[]; evidence: { documentId: string; ref: SourceAnchor }[] }
export interface PatientPlan {
  id: string;
  createdAt: string;
  completedAt: string | null;
  documents: PlanDocument[];
  additionalSteps: RouteStep[];
  deferredIds: string[];
}

/** Reopening the same evidence in the same analysis mode continues the saved plan. */
export function matchingPlan(plans: PatientPlan[], documents: PlanDocument[]): PatientPlan | undefined {
  const key = (items: PlanDocument[]) => JSON.stringify(items.map(item => [item.document.id, item.document.revision,
    item.analysis.mode, item.analysis.corpusVersion]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const wanted = key(documents);
  return [...plans].reverse().find(plan => key(plan.documents) === wanted);
}

/** Only explicit directions to the same specialty share a visit; every original source remains bound. */
export function mergePlanVisits(documents: PlanDocument[], additionalSteps: RouteStep[] = []): PlanVisit[] {
  const groups = new Map<string, PlanVisit>();
  for (const item of documents) {
    for (const step of item.analysis.routeSteps) {
      const key = step.basis === 'explicit_document' && step.bookingAllowed && step.specialtyId ? `specialty:${step.specialtyId}` : `${item.document.id}:${step.id}`;
      const source = { documentId: item.document.id, revision: item.document.revision, stepId: step.id, title: item.title };
      const evidence = step.sourceRefs.map(ref => ({ documentId: item.document.id, ref }));
      const existing = groups.get(key);
      if (existing) { existing.sources.push(source); existing.evidence.push(...evidence); }
      else groups.set(key, { step: { ...step, sourceRefs: [...step.sourceRefs] }, sources: [source], evidence });
    }
  }
  const visits = [...groups.values()].map(visit => {
    if (visit.sources.length === 1) return visit;
    const sourceSteps = visit.sources.map(source => documents.find(item => item.document.id === source.documentId)!.analysis.routeSteps.find(step => step.id === source.stepId)!);
    const dueTexts = [...new Set(sourceSteps.flatMap(step => step.dueText ? [step.dueText] : []))];
    const dueDates = sourceSteps.flatMap(step => step.dueAt ? [step.dueAt] : []).sort();
    return { ...visit, step: { ...visit.step,
      id: `visit:${visit.step.specialtyId}:${visit.sources.map(source => `${source.documentId}@${source.revision}:${source.stepId}`).sort().join('|')}`,
      sourceRefs: visit.evidence.map(item => item.ref),
      dueText: dueTexts.join(' · ') || null, dueAt: dueDates[0] ?? null,
      explanation: 'Одна консультация по выбранным документам: в каждом исходнике явно указана эта специальность. Возьмите все исследования на приём. Сроки каждого исходника сохранены.',
    } };
  });
  const first = documents[0];
  if (first) for (const step of additionalSteps) visits.push({ step, sources: [{ documentId: first.document.id, revision: first.document.revision, stepId: step.id, title: first.title }], evidence: [] });
  return visits;
}

export function findVisitBooking(visit: PlanVisit, bookings: Booking[]): Booking | undefined {
  return bookings.find(booking => {
    const sources = booking.sourceDocuments ?? [{ documentId: booking.documentId, revision: booking.revision, stepId: booking.stepId }];
    return visit.sources.every(source => sources.some(item => item.documentId === source.documentId && item.revision === source.revision && item.stepId === source.stepId));
  });
}

/** A partially covered merged visit must reveal its existing appointments before offering another slot. */
export function overlappingVisitBookings(visit: PlanVisit, bookings: Booking[]): Booking[] {
  return bookings.filter(booking => {
    const sources = booking.sourceDocuments ?? [{ documentId: booking.documentId, revision: booking.revision, stepId: booking.stepId }];
    return visit.sources.some(source => sources.some(item => item.documentId === source.documentId && item.revision === source.revision && item.stepId === source.stepId));
  });
}

export function bookingsForPlan(plan: PatientPlan, bookings: Booking[]): Booking[] {
  const selected = mergePlanVisits(plan.documents, plan.additionalSteps).flatMap(visit => overlappingVisitBookings(visit, bookings));
  return [...new Map(selected.map(item => [item.id, item])).values()].sort((a, b) => a.slot.start.localeCompare(b.slot.start));
}
