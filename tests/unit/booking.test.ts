import { describe, expect, it } from 'vitest';
import { createBooking, createCatalog } from '../../src/features/booking/state';
import { calendarEvent } from '../../src/features/booking/calendar';
import { availableSlots, blankDraft, doctorMatches, filteredDoctors, priceRangeError } from '../../src/features/booking/filters';

describe('explicit demo booking', () => {
  const now = new Date('2026-10-04T09:00:00Z');
  it('uses future catalogue slots and one booking per idempotency key', () => {
    const catalog = createCatalog(now);
    const slot = catalog.slots[0];
    expect(new Date(slot.start).getTime()).toBeGreaterThan(now.getTime());
    const input = { key: 'attempt-1', documentId: 'd1', revision: 1, stepId: 's1', specialtyId: 'pulmonology', slotId: slot.id, mode: 'personal_local' as const };
    const first = createBooking([], input, catalog, now);
    expect(createBooking([first], input, catalog, now)).toEqual(first);
    expect(() => createBooking([], { ...input, slotId: 'invented' }, catalog, now)).toThrow();
    expect(() => createBooking([], { ...input, specialtyId: 'mammology' }, catalog, now)).toThrow();
  });
  it('does not reuse occupied or expired slots under another key', () => {
    const catalog = createCatalog(now);
    const input = { key: 'a', documentId: 'd', revision: 1, stepId: 's', specialtyId: 'pulmonology', slotId: catalog.slots[0].id, mode: 'personal_local' as const };
    const first = createBooking([], input, catalog, now);
    expect(() => createBooking([first], { ...input, key: 'b' }, catalog, now)).toThrow();
    expect(() => createBooking([], input, catalog, new Date('2027-01-01'))).toThrow();
  });
  it('prevents overlapping visits across different doctors while allowing adjacent visits', () => {
    const catalog = createCatalog(now);
    const firstSlot = catalog.slots[0];
    const booking = createBooking([], { key: 'first', documentId: 'd', revision: 1, stepId: 's', specialtyId: 'pulmonology', slotId: firstSlot.id, mode: 'personal_local' }, catalog, now);
    const conflict = catalog.slots.find(slot => slot.doctorId.startsWith('mammology-') && slot.start === firstSlot.start)!;
    expect(() => createBooking([booking], { key: 'second', documentId: 'd2', revision: 1, stepId: 's2', specialtyId: 'mammology', slotId: conflict.id, mode: 'personal_local' }, catalog, now)).toThrow(/пересекается/);
    const available = availableSlots(catalog, [booking], 'mammology', now);
    expect(available.some(slot => slot.id === conflict.id)).toBe(false);
    expect(available.some(slot => slot.start === firstSlot.end)).toBe(true);
  });
  it('exports a stable neutral calendar event in Moscow time without source text', () => {
    const catalog = createCatalog(now);
    const booking = createBooking([], { key: 'a', documentId: 'd', revision: 1, stepId: 's', specialtyId: 'pulmonology', slotId: catalog.slots[0].id, mode: 'personal_local' }, catalog, now);
    const ics = calendarEvent(booking);
    expect(ics).toContain('TZID=Europe/Moscow');
    expect(ics).toContain(`UID:${booking.id}@medipath.demo`);
    expect(ics).toContain('SUMMARY:Демонстрационный приём');
    expect(ics).not.toContain('documentId');
    expect(calendarEvent(booking)).toEqual(ics);
  });

  it('provides complete explicitly synthetic doctor profiles for every specialty', () => {
    const catalog = createCatalog(now);
    expect(new Set(catalog.doctors.map((doctor) => doctor.name)).size).toBe(catalog.doctors.length);
    for (const doctor of catalog.doctors) {
      expect(doctor.synthetic).toBe(true);
      expect(doctor.avatar).toContain('portrait-');
      expect(doctor.education).not.toBe('');
      expect(doctor.qualification).not.toBe('');
      expect(doctor.metro).not.toBe('');
      expect(doctor.address).toContain('вымышленный адрес');
      expect(doctor.distanceKm).toBeGreaterThan(0);
      expect(doctor.price).toBeGreaterThan(0);
    }
  });

  it('combines gender, metro and inclusive price range without changing the catalog', () => {
    const catalog = createCatalog(now);
    const originalOrder = catalog.doctors.map((doctor) => doctor.id);
    const draft = { ...blankDraft(), gender: 'female', metro: 'Чистые пруды', minPrice: '2900', maxPrice: '3400' };
    expect(filteredDoctors(catalog, [], 'pulmonology', draft, now).map((doctor) => doctor.id)).toEqual(['pulmonology-1']);
    expect(doctorMatches(catalog.doctors[0], { ...draft, minPrice: '3000' })).toBe(false);
    expect(catalog.doctors.map((doctor) => doctor.id)).toEqual(originalOrder);
  });

  it('validates price inputs and lets reset recover empty results', () => {
    const catalog = createCatalog(now);
    for (const invalid of [{ minPrice: '-1', maxPrice: '' }, { minPrice: 'no', maxPrice: '' }, { minPrice: '4000', maxPrice: '3000' }]) {
      const draft = { ...blankDraft(), ...invalid };
      expect(priceRangeError(draft)).not.toBe('');
      expect(filteredDoctors(catalog, [], 'pulmonology', draft, now)).toEqual([]);
    }
    expect(filteredDoctors(catalog, [], 'pulmonology', { ...blankDraft(), maxPrice: '100' }, now)).toEqual([]);
    expect(filteredDoctors(catalog, [], 'pulmonology', blankDraft(), now)).toHaveLength(4);
  });

  it('sorts by price in both directions and by demo distance', () => {
    const catalog = createCatalog(now);
    const sorted = (sort: string) => filteredDoctors(catalog, [], 'pulmonology', { ...blankDraft(), sort }, now);
    expect(sorted('price_asc').map((doctor) => doctor.price)).toEqual([2600, 2900, 3400, 4200]);
    expect(sorted('price_desc').map((doctor) => doctor.price)).toEqual([4200, 3400, 2900, 2600]);
    expect(sorted('distance').map((doctor) => doctor.distanceKm)).toEqual([1.2, 1.2, 3.1, 6.4]);
  });

  it('offers only future unoccupied slots for the selected specialty', () => {
    const catalog = createCatalog(now);
    const slot = catalog.slots[0];
    const booking = createBooking([], { key: 'a', documentId: 'd', revision: 1, stepId: 's', specialtyId: 'pulmonology', slotId: slot.id, mode: 'personal_local' }, catalog, now);
    const later = new Date(new Date(slot.start).getTime() + 1);
    const slots = availableSlots(catalog, [booking], 'pulmonology', later);
    expect(slots.every((item) => item.doctorId.startsWith('pulmonology-') && new Date(item.start) > later)).toBe(true);
    expect(slots.some((item) => item.id === slot.id)).toBe(false);
    expect(availableSlots(catalog, [], null, now)).toEqual([]);
    expect(availableSlots(catalog, [], 'pulmonology', new Date('2027-01-01'))).toEqual([]);
  });
});
