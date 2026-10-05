import { CalendarArrowDown, Check, Clock3, MapPin } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Status';
import { downloadCalendar } from './calendar';
import { dateLabel, priceLabel, timeLabel } from './state';
import type { Booking } from './state';
import './BookingResult.css';

export function BookingResult({ booking, currentRevision, currentRevisions, showCalendar = true }: { booking: Booking; currentRevision?: number; currentRevisions?: Record<string, number>; showCalendar?: boolean }) {
  const [downloaded, setDownloaded] = useState(false);
  const sources = booking.sourceDocuments ?? [{ documentId: booking.documentId, revision: booking.revision }];
  const stale = currentRevisions ? sources.some(source => currentRevisions[source.documentId] !== undefined && currentRevisions[source.documentId] !== source.revision) : currentRevision !== undefined && booking.revision !== currentRevision;
  return <article className="booking-card visit-booking">
    <div className="visit-booking-status"><span><Check size={16} />Подтверждено в демо</span><span>{dateLabel(booking.slot.start)}</span></div>
    <h3 className="visit-booking-confirmation">Демозапись создана. Клиника не получала заявку.</h3>
    {stale && <Notice tone="warning">Маршрут изменён. Эта запись сохранена как история прежних редакций документов.</Notice>}
    <div className="visit-booking-person"><img src={booking.doctor.avatar} alt="" loading="lazy" /><div><h4>{booking.doctor.name}</h4><p>{booking.doctor.specialty} · {booking.doctor.clinic}</p></div></div>
    <dl className="visit-booking-facts">
      <div><dt><Clock3 size={17} />Время</dt><dd>{timeLabel(booking.slot.start)}–{timeLabel(booking.slot.end)} мск</dd></div>
      <div><dt><MapPin size={17} />Клиника</dt><dd>м. {booking.doctor.metro}<span>{booking.doctor.address}</span></dd></div>
      <div><dt>Стоимость приёма</dt><dd>{priceLabel(booking.doctor.price)}<span>Учебная цена · без оплаты</span></dd></div>
    </dl>
    {showCalendar && <Button variant="secondary" onClick={() => { downloadCalendar(booking); setDownloaded(true); }}><CalendarArrowDown size={18} />Скачать событие календаря</Button>}
    {downloaded && <p className="small muted" role="status">Файл подготовлен. Откройте его в своём календаре — автоматический импорт не выполнялся.</p>}
  </article>;
}
