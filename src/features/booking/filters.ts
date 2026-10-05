import type { Booking, Catalog, Doctor } from './state';
import { dateKey } from './state';

export interface PickerDraft {
  slotId: string;
  date: string;
  district: string;
  minPrice: string;
  maxPrice: string;
  experience: string;
  language: string;
  clinic: string;
  gender: string;
  metro: string;
  sort: string;
}

export const blankDraft = (): PickerDraft => ({
  slotId: '', date: '', district: '', minPrice: '', maxPrice: '', experience: '',
  language: '', clinic: '', gender: '', metro: '', sort: 'availability',
});

export function priceRangeError(draft: Pick<PickerDraft, 'minPrice' | 'maxPrice'>): string {
  const values = [draft.minPrice, draft.maxPrice].filter((value) => value !== '');
  if (values.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0))
    return 'Укажите стоимость от 0 ₽.';
  if (draft.minPrice && draft.maxPrice && Number(draft.minPrice) > Number(draft.maxPrice))
    return 'Минимальная стоимость не может быть выше максимальной.';
  return '';
}

export function doctorMatches(doctor: Doctor, draft: PickerDraft): boolean {
  return !priceRangeError(draft) &&
    (!draft.district || doctor.district === draft.district) &&
    (!draft.minPrice || doctor.price >= Number(draft.minPrice)) &&
    (!draft.maxPrice || doctor.price <= Number(draft.maxPrice)) &&
    (!draft.experience || doctor.experience >= Number(draft.experience)) &&
    (!draft.language || doctor.languages.includes(draft.language)) &&
    (!draft.clinic || doctor.clinic === draft.clinic) &&
    (!draft.gender || doctor.gender === draft.gender) &&
    (!draft.metro || doctor.metro === draft.metro);
}

export function availableSlots(catalog: Catalog, bookings: Booking[], specialtyId: string | null, now = new Date()) {
  const doctors = new Set(catalog.doctors.filter((doctor) => doctor.specialtyId === specialtyId).map((doctor) => doctor.id));
  const occupied = new Set(bookings.map((booking) => booking.slot.id));
  return catalog.slots.filter((slot) => doctors.has(slot.doctorId) &&
    Date.parse(slot.start) > now.getTime() && !occupied.has(slot.id) &&
    !bookings.some(item => Date.parse(slot.start) < Date.parse(item.slot.end) && Date.parse(slot.end) > Date.parse(item.slot.start)))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export function filteredDoctors(catalog: Catalog, bookings: Booking[], specialtyId: string | null, draft: PickerDraft, now = new Date()) {
  const slots = availableSlots(catalog, bookings, specialtyId, now);
  const selectedDay = draft.date || (slots[0] && dateKey(slots[0].start));
  const firstSlot = (id: string) => {
    const slot = slots.find((item) => item.doctorId === id && dateKey(item.start) === selectedDay);
    return slot ? Date.parse(slot.start) : Infinity;
  };
  return catalog.doctors.filter((doctor) => doctor.specialtyId === specialtyId && doctorMatches(doctor, draft))
    .sort((a, b) => {
      if (draft.sort === 'price_asc') return a.price - b.price;
      if (draft.sort === 'price_desc') return b.price - a.price;
      if (draft.sort === 'distance') return a.distanceKm - b.distanceKm || a.price - b.price;
      return firstSlot(a.id) - firstSlot(b.id) || a.price - b.price;
    });
}

export function activeFilterCount(draft: PickerDraft): number {
  return ['district', 'minPrice', 'maxPrice', 'experience', 'language', 'clinic', 'gender', 'metro']
    .filter((field) => Boolean(draft[field as keyof PickerDraft])).length;
}
