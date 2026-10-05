import type { Booking } from './state';
import { dateKey, dateLabel } from './state';
import { BookingResult } from './BookingResult';
import { Button } from '../../ui/Button';

export function BookingDays({ bookings, revisions, onCancel }: { bookings: Booking[]; revisions?: Record<string, number>; onCancel?: (booking: Booking) => void }) {
  const sorted = [...bookings].sort((a, b) => a.slot.start.localeCompare(b.slot.start));
  const days = [...new Set(sorted.map(booking => dateKey(booking.slot.start)))];
  return <div className="booking-days">{days.map(day => {
    const appointments = sorted.filter(booking => dateKey(booking.slot.start) === day);
    return <section className="booking-day" key={day} aria-label={`Приёмы ${day}`}>
      <header className="booking-day-heading"><CalendarDate value={appointments[0].slot.start} /><span className="small muted">Приёмов: {appointments.length} · московское время</span></header>
      <div className="stack">{appointments.map(booking => <div key={booking.id} className="booking-day-item"><BookingResult booking={booking} currentRevisions={revisions} showCalendar={false} />{onCancel && <Button variant="quiet" onClick={() => onCancel(booking)}>Отменить запись</Button>}</div>)}</div>
    </section>;
  })}</div>;
}
function CalendarDate({ value }: { value: string }) {
  return <h3><time dateTime={dateKey(value)}>{dateLabel(value)} {new Date(value).getUTCFullYear()}</time></h3>;
}
