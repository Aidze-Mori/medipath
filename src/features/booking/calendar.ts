import type { Booking } from './state';
const escape = (value: string) =>
  value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,');
const timestamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').slice(0, 15);
const fold = (line: string) => {
  const encoder = new TextEncoder();
  let current = '',
    result = '';
  for (const char of line) {
    if (encoder.encode(current + char).length > 73) {
      result += current + '\r\n';
      current = ' ';
    }
    current += char;
  }
  return result + current;
};
export function calendarEvent(booking: Booking): string {
  return calendarEvents([booking]);
}
export function calendarEvents(bookings: Booking[]): string {
  const moscow = (iso: string) => timestamp(new Date(new Date(iso).getTime() + 3 * 3600000));
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MediPath//Demo//RU',
    'CALSCALE:GREGORIAN',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Moscow',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0300',
    'TZOFFSETTO:+0300',
    'TZNAME:MSK',
    'END:STANDARD',
    'END:VTIMEZONE',
    ...[...new Map(bookings.map(booking => [booking.id, booking])).values()].flatMap(booking => [
    'BEGIN:VEVENT',
    `UID:${booking.id}@medipath.demo`,
    `DTSTAMP:${timestamp(new Date(booking.createdAt))}Z`,
    `DTSTART;TZID=Europe/Moscow:${moscow(booking.slot.start)}`,
    `DTEND;TZID=Europe/Moscow:${moscow(booking.slot.end)}`,
    'SUMMARY:Демонстрационный приём',
    `LOCATION:${escape(booking.doctor.address)}`,
    'DESCRIPTION:Учебное событие. Клиника не получала заявку.',
    'END:VEVENT',
    ]),
    'END:VCALENDAR',
    '',
  ]
    .map(fold)
    .join('\r\n');
}
export function downloadCalendar(booking: Booking) {
  downloadPlanCalendar([booking]);
}
export function downloadPlanCalendar(bookings: Booking[]) {
  const url = URL.createObjectURL(
    new Blob([calendarEvents(bookings)], { type: 'text/calendar;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'medipath-plan.ics';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
