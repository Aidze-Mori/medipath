import { describe, expect, it } from 'vitest';
import { confirmDocument, getFixtureDocument } from '../../src/domain';
import { analyzeLocal } from '../../src/engine';
import { bookingsForPlan, mergePlanVisits, findVisitBooking, overlappingVisitBookings } from '../../src/features/patient/plans';
import { calendarEvents } from '../../src/features/booking/calendar';
import { createBooking, createCatalog } from '../../src/features/booking/state';

function source(id: string, title: string) {
  const document = confirmDocument(getFixtureDocument(id));
  return { document, title, analysis: analyzeLocal(document) };
}
describe('patient plans', () => {
  it('combines two documents directing to one specialty while keeping both sources and revisions', () => {
    const documents = [source('chest-referral', 'КТ 1'), source('chest-referral', 'КТ 2')];
    const visits = mergePlanVisits(documents);
    expect(visits).toHaveLength(1);
    expect(visits[0].sources.map(item => item.documentId)).toEqual(documents.map(item => item.document.id));
    expect(visits[0].step.sourceRefs).toHaveLength(2);
    expect(mergePlanVisits([...documents].reverse())[0].step.id).toBe(visits[0].step.id);
  });
  it('does not collapse different specialties or manual choices', () => {
    const documents = [source('chest-referral', 'КТ'), source('breast-referral', 'Маммография')];
    const manual = { ...documents[0].analysis.routeSteps[0], id: 'manual:choice', basis: 'demo_only' as const };
    expect(mergePlanVisits(documents, [manual])).toHaveLength(3);
  });
  it('a combined booking binds every source and cannot cover a changed revision', () => {
    const documents = [source('chest-referral', 'КТ 1'), source('chest-referral', 'КТ 2')];
    const visit = mergePlanVisits(documents)[0];
    const now = new Date('2026-10-05T08:00:00Z'), catalog = createCatalog(now);
    const booking = createBooking([], { key: visit.step.id, documentId: documents[0].document.id, revision: 1, stepId: visit.step.id, specialtyId: 'pulmonology', slotId: catalog.slots[0].id, mode: 'personal_local', sourceDocuments: visit.sources }, catalog, now);
    expect(findVisitBooking(visit, [booking])?.id).toBe(booking.id);
    expect(findVisitBooking({ ...visit, sources: visit.sources.map((item, i) => ({ ...item, revision: i ? 2 : 1 })) }, [booking])).toBeUndefined();
    expect(() => createBooking([booking], { key: visit.step.id, documentId: documents[0].document.id, revision: 1, stepId: visit.step.id, specialtyId: 'pulmonology', slotId: catalog.slots[0].id, mode: 'personal_local', sourceDocuments: visit.sources.map((item, i) => ({ ...item, revision: i ? 2 : 1 })) }, catalog, now)).toThrow('Этот ключ уже относится к другой записи');
  });
  it('exports one calendar with all confirmed visits, stable UIDs and no duplicates', () => {
    const now = new Date('2026-10-05T08:00:00Z'), catalog = createCatalog(now);
    const first = createBooking([], { key: 'first', documentId: 'd', revision: 1, stepId: 'a', specialtyId: 'pulmonology', slotId: catalog.slots[0].id, mode: 'personal_local' }, catalog, now);
    const second = createBooking([first], { key: 'second', documentId: 'd', revision: 1, stepId: 'b', specialtyId: 'pulmonology', slotId: catalog.slots[1].id, mode: 'personal_local' }, catalog, now);
    const ics = calendarEvents([first, second, first]);
    expect(ics.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain(`UID:${first.id}@medipath.demo`);
    expect(ics).not.toContain('КТ');
  });

  it('retains a partial appointment in the plan without silently covering additional sources', () => {
    const documents = [source('chest-referral', 'КТ'), source('doctor-report', 'Отчёт')];
    const single = mergePlanVisits([documents[0]])[0], combined = mergePlanVisits(documents)[0];
    const now = new Date('2026-10-05T08:00:00Z'), catalog = createCatalog(now);
    const booking = createBooking([], { key: single.step.id, documentId: single.sources[0].documentId, revision: 1, stepId: single.step.id, specialtyId: 'pulmonology', slotId: catalog.slots[0].id, mode: 'personal_local', sourceDocuments: single.sources }, catalog, now);
    const originalBindings = structuredClone(booking.sourceDocuments);
    expect(findVisitBooking(combined, [booking])).toBeUndefined();
    expect(overlappingVisitBookings(combined, [booking])).toEqual([booking]);
    expect(bookingsForPlan({ id: 'p', documents, createdAt: now.toISOString(), completedAt: null, additionalSteps: [], deferredIds: [] }, [booking])).toEqual([booking]);
    expect(booking.sourceDocuments).toEqual(originalBindings);
    expect(overlappingVisitBookings({ ...combined, sources: combined.sources.map(item => ({ ...item, revision: 2 })) }, [booking])).toEqual([]);
  });

  it('keeps multiple partial appointments separate until each is explicitly cancelled', () => {
    const documents = [source('chest-referral', 'КТ'), source('doctor-report', 'Отчёт')];
    const now = new Date('2026-10-05T08:00:00Z'), catalog = createCatalog(now);
    const bookings = documents.map((document, index) => {
      const visit = mergePlanVisits([document])[0];
      return createBooking([], { key: visit.step.id, documentId: document.document.id, revision: 1, stepId: visit.step.id, specialtyId: 'pulmonology', slotId: catalog.slots[index].id, mode: 'personal_local', sourceDocuments: visit.sources }, catalog, now);
    });
    const combined = mergePlanVisits(documents)[0];
    expect(findVisitBooking(combined, bookings)).toBeUndefined();
    expect(overlappingVisitBookings(combined, bookings)).toEqual(bookings);
    expect(overlappingVisitBookings(combined, bookings.slice(1))).toEqual([bookings[1]]);
    expect(overlappingVisitBookings(combined, [])).toEqual([]);
  });
});
