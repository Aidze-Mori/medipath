import type { ProcessingMode } from '../../domain/document';
import portrait1 from './assets/portrait-1.png';
import portrait2 from './assets/portrait-2.png';
import portrait3 from './assets/portrait-3.png';
import portrait4 from './assets/portrait-4.png';
export interface Doctor {
  id: string;
  name: string;
  specialtyId: string;
  specialty: string;
  clinic: string;
  district: string;
  address: string;
  metro: string;
  distanceKm: number;
  education: string;
  qualification: string;
  avatar: string;
  synthetic: true;
  price: number;
  experience: number;
  languages: string[];
  gender: 'female' | 'male';
}
export interface Slot {
  id: string;
  doctorId: string;
  start: string;
  end: string;
}
export interface Catalog {
  doctors: Doctor[];
  slots: Slot[];
}
export interface Booking {
  id: string;
  key: string;
  documentId: string;
  revision: number;
  stepId: string;
  doctor: Doctor;
  slot: Slot;
  mode: ProcessingMode;
  createdAt: string;
  status: 'confirmed_demo';
  sourceDocuments?: { documentId: string; revision: number; stepId: string }[];
}
export interface BookingInput {
  key: string;
  documentId: string;
  revision: number;
  stepId: string;
  specialtyId: string;
  slotId: string;
  mode: ProcessingMode;
  sourceDocuments?: { documentId: string; revision: number; stepId: string }[];
}
const SPECIALTIES = {
  pulmonology: 'Пульмонолог',
  mammology: 'Маммолог',
  oncology: 'Онколог',
  therapy: 'Терапевт',
};
export function createCatalog(now = new Date()): Catalog {
  const names = [
    ['Мария Александровна Соколова', 'Алексей Игоревич Волков', 'Елена Сергеевна Миронова', 'Дмитрий Павлович Орлов'],
    ['Анна Викторовна Лебедева', 'Михаил Андреевич Серов', 'Ирина Олеговна Белова', 'Павел Николаевич Громов'],
    ['Ольга Дмитриевна Крылова', 'Андрей Сергеевич Лавров', 'Наталья Игоревна Морозова', 'Роман Алексеевич Зорин'],
    ['Екатерина Романовна Власова', 'Илья Викторович Тихонов', 'Татьяна Петровна Рябова', 'Сергей Олегович Светлов'],
  ];
  const doctors: Doctor[] = Object.entries(SPECIALTIES).flatMap(([id, specialty], specialtyIndex) => [
    {
      id: `${id}-1`,
      name: names[specialtyIndex][0],
      specialtyId: id,
      specialty,
      clinic: 'Медицинский центр «Ясно»',
      district: 'Центральный',
      address: 'Москва, ул. Учебная, 12 · вымышленный адрес',
      metro: 'Чистые пруды',
      distanceKm: 1.2,
      education: 'Медицинский институт: лечебное дело, 2012; ординатура, 2014.',
      qualification: 'Врач первой категории',
      avatar: portrait1,
      synthetic: true as const,
      price: 2900,
      experience: 12,
      languages: ['Русский', 'Английский'],
      gender: 'female' as const,
    },
    {
      id: `${id}-2`,
      name: names[specialtyIndex][1],
      specialtyId: id,
      specialty,
      clinic: 'Клиника «Новый день»',
      district: 'Северный',
      address: 'Москва, проспект Примеров, 8 · вымышленный адрес',
      metro: 'Аэропорт',
      distanceKm: 6.4,
      education: 'Медицинская академия: лечебное дело, 2008; ординатура, 2010.',
      qualification: 'Врач высшей категории',
      avatar: portrait2,
      synthetic: true as const,
      price: 3400,
      experience: 16,
      languages: ['Русский'],
      gender: 'male' as const,
    },
    {
      id: `${id}-3`,
      name: names[specialtyIndex][2],
      specialtyId: id,
      specialty,
      clinic: 'Медицинский центр «Ясно»',
      district: 'Центральный',
      address: 'Москва, ул. Учебная, 12 · вымышленный адрес',
      metro: 'Чистые пруды',
      distanceKm: 1.2,
      education: 'Медицинский институт: лечебное дело, 2003; ординатура, 2005.',
      qualification: 'Кандидат медицинских наук, врач высшей категории',
      avatar: portrait3,
      synthetic: true as const,
      price: 4200,
      experience: 21,
      languages: ['Русский', 'Английский'],
      gender: 'female' as const,
    },
    {
      id: `${id}-4`,
      name: names[specialtyIndex][3],
      specialtyId: id,
      specialty,
      clinic: 'Клиника «Тихий центр»',
      district: 'Центральный',
      address: 'Москва, пер. Демонстрационный, 5 · вымышленный адрес',
      metro: 'Парк культуры',
      distanceKm: 3.1,
      education: 'Медицинский университет: лечебное дело, 2016; ординатура, 2018.',
      qualification: 'Врач-специалист',
      avatar: portrait4,
      synthetic: true as const,
      price: 2600,
      experience: 8,
      languages: ['Русский', 'Английский'],
      gender: 'male' as const,
    },
  ]);
  const moscow = new Date(now.getTime() + 3 * 3600_000);
  const slots = doctors.flatMap((doctor, index) =>
    Array.from({ length: 7 }, (_, day) =>
      [9, 12, 16].map((hour) => {
        const start = new Date(
          Date.UTC(
            moscow.getUTCFullYear(),
            moscow.getUTCMonth(),
            moscow.getUTCDate() + day + 1,
            hour - 3,
            index % 2 ? 30 : 0,
          ),
        );
        return {
          id: `${doctor.id}-${start.toISOString()}`,
          doctorId: doctor.id,
          start: start.toISOString(),
          end: new Date(start.getTime() + 30 * 60000).toISOString(),
        };
      }),
    ).flat(),
  );
  return { doctors, slots };
}
export function createBooking(
  existing: Booking[],
  input: BookingInput,
  catalog: Catalog,
  now = new Date(),
): Booking {
  const sourceKey = (sources: BookingInput['sourceDocuments']) =>
    JSON.stringify(sources?.map(({ documentId, revision, stepId }) => [documentId, revision, stepId]).sort() ?? []);
  if (input.sourceDocuments && (!input.sourceDocuments.length || input.sourceDocuments.some(source =>
    !source.documentId || !source.stepId || !Number.isSafeInteger(source.revision) || source.revision < 1)))
    throw new Error('Связь записи с документами недействительна.');
  const prior = existing.find((item) => item.key === input.key);
  if (prior) {
    if (
      prior.documentId !== input.documentId ||
      prior.revision !== input.revision ||
      prior.stepId !== input.stepId ||
      sourceKey(prior.sourceDocuments) !== sourceKey(input.sourceDocuments) ||
      prior.slot.id !== input.slotId
    )
      throw new Error('Этот ключ уже относится к другой записи.');
    return prior;
  }
  const slot = catalog.slots.find((item) => item.id === input.slotId);
  const doctor = catalog.doctors.find((item) => item.id === slot?.doctorId);
  if (!slot || !doctor || doctor.specialtyId !== input.specialtyId)
    throw new Error('Выберите действительный слот по специальности маршрута.');
  if (new Date(slot.start) <= now) throw new Error('Время этого слота прошло. Выберите новый слот.');
  if (existing.some((item) => item.slot.id === slot.id))
    throw new Error('Слот уже занят в этой демосессии. Выберите другое время.');
  if (existing.some(item => Date.parse(slot.start) < Date.parse(item.slot.end) && Date.parse(slot.end) > Date.parse(item.slot.start)))
    throw new Error('Это время пересекается с другим приёмом в вашем плане. Выберите другой слот.');
  if (!Number.isInteger(input.revision) || input.revision < 1)
    throw new Error('Редакция маршрута недействительна.');
  return {
    id: crypto.randomUUID(),
    ...input,
    doctor: { ...doctor },
    slot: { ...slot },
    createdAt: now.toISOString(),
    status: 'confirmed_demo',
  };
}
export const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
export const timeLabel = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(
    new Date(value),
  );
export const dateKey = (value: string) =>
  new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
export const priceLabel = (value: number) => `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
