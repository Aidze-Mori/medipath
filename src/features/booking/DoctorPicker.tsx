import { StyledSelect } from '../../ui/Select';
import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronLeft, MapPin, SlidersHorizontal, TrainFront } from 'lucide-react';
import type { RouteStep } from '../../domain';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Notice } from '../../ui/Status';
import { dateKey, dateLabel, timeLabel, priceLabel } from './state';
import type { Catalog, Booking, Doctor } from './state';
import { activeFilterCount, availableSlots, blankDraft, doctorMatches, filteredDoctors, priceRangeError } from './filters';
import type { PickerDraft } from './filters';
import './Booking.css';

export { blankDraft } from './filters';
export type { PickerDraft } from './filters';

const distanceLabel = (km: number) => `≈ ${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(km)} км`;

function DoctorAvatar({ doctor }: { doctor: Doctor }) {
  const [failed, setFailed] = useState(false);
  return <div className="booking-avatar" aria-hidden="true">
    <span>{doctor.name.split(' ').slice(0, 2).map((part) => part[0]).join('')}</span>
    {!failed && <img src={doctor.avatar} alt="" width="56" height="56" loading="lazy" onError={() => setFailed(true)} />}
  </div>;
}

export function DoctorPicker({ step, catalog, bookings, draft, setDraft, onConfirm, onClose }: {
  step: RouteStep;
  catalog: Catalog;
  bookings: Booking[];
  draft: PickerDraft;
  setDraft: (draft: PickerDraft) => void;
  onConfirm: (slotId: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [review, setReview] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const dialog = contentRef.current?.closest('dialog');
    // A selected slot may be far down the list. Start the review at the doctor's name.
    dialog?.scrollTo({ top: 0 });
    dialog?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }, [review]);
  const specialtyDoctors = catalog.doctors.filter((doctor) => doctor.specialtyId === step.specialtyId);
  const available = availableSlots(catalog, bookings, step.specialtyId);
  const days = [...new Set(available.map((slot) => dateKey(slot.start)))];
  const selectedDay = draft.date || days[0] || '';
  const filtered = filteredDoctors(catalog, bookings, step.specialtyId, draft);
  const slots = available.filter((slot) => dateKey(slot.start) === selectedDay);
  const selected = slots.find((slot) => slot.id === draft.slotId);
  const doctor = filtered.find((item) => item.id === selected?.doctorId);
  const rangeError = priceRangeError(draft);
  const filterCount = activeFilterCount(draft);
  const options = (field: 'metro' | 'district' | 'clinic') => [...new Set(specialtyDoctors.map((item) => item[field]))];

  function change(field: keyof PickerDraft, value: string) {
    const next = { ...draft, [field]: value };
    setError('');
    if (draft.slotId) {
      const selectedSlot = available.find((slot) => slot.id === draft.slotId);
      const selectedDoctor = specialtyDoctors.find((item) => item.id === selectedSlot?.doctorId);
      if (!selectedSlot || !selectedDoctor || dateKey(selectedSlot.start) !== (next.date || days[0]) || !doctorMatches(selectedDoctor, next)) {
        next.slotId = '';
        setError('Условия изменены. Выберите подходящее время заново.');
      }
    }
    setDraft(next);
  }

  function resetFilters() {
    setDraft({ ...blankDraft(), date: selectedDay, slotId: selected?.id ?? '', sort: draft.sort });
    setError('');
  }

  async function confirm() {
    if (pending.current) return;
    if (!selected || !doctor || Date.parse(selected.start) <= Date.now()) {
      setError('Выбранное время больше недоступно. Вернитесь к выбору врача и выберите другое.');
      return;
    }
    pending.current = true;
    setSubmitting(true);
    setError('');
    try {
      await onConfirm(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось создать демозапись. Повторите действие.');
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  return <Dialog
    title={review ? 'Проверьте запись' : 'Выберите врача'}
    onClose={onClose}
    onBack={review ? () => setReview(false) : undefined}
    footer={<div className="booking-footer">
      <div className="booking-selection" aria-live="polite">
        {doctor && selected ? <><strong>{priceLabel(doctor.price)}</strong><span>{dateLabel(selected.start)}, {timeLabel(selected.start)} мск</span><small>Запись ещё не подтверждена</small></> : <><strong>Выберите время</strong><span>Демозапись · без оплаты</span></>}
      </div>
      <div className="booking-footer-actions">
        {review && <Button variant="quiet" onClick={() => setReview(false)} disabled={submitting}><ChevronLeft size={16} />Назад</Button>}
        {review ? <Button disabled={submitting || !doctor || !selected} onClick={confirm}>{submitting ? 'Подтверждаем…' : 'Подтвердить демозапись'}</Button>
          : <Button disabled={!doctor || !selected} onClick={() => { setReview(true); setError(''); }}>Продолжить<ArrowRight size={16} /></Button>}
      </div>
    </div>}
  >
    <div className="booking-picker" ref={contentRef}>
      <div className="booking-context"><strong>{step.title}</strong><p>Учебные врачи, портреты и цены. Адреса и расстояния условные.</p></div>
      {error && <Notice tone="warning">{error}</Notice>}
      {review ? doctor && selected ? <>
        <div className="booking-review-doctor"><DoctorAvatar doctor={doctor} /><div><h3>{doctor.name}</h3><p>{doctor.specialty} · {doctor.qualification}</p></div></div>
        <dl className="detail-list">
          <div><dt>Услуга</dt><dd>{step.title}</dd></div>
          <div><dt>Дата и время</dt><dd>{dateLabel(selected.start)}, {timeLabel(selected.start)}<br /><span className="small muted">Europe/Moscow · 30 минут</span></dd></div>
          <div><dt>Место</dt><dd>{doctor.clinic}<br />{doctor.address}<br /><span className="small muted">м. {doctor.metro} · {distanceLabel(doctor.distanceKm)}, учебное расстояние</span></dd></div>
          <div><dt>Стоимость</dt><dd><strong>{priceLabel(doctor.price)}</strong> · учебная цена за консультацию</dd></div>
        </dl>
        <Notice>Это демозапись в текущей вкладке. Заявка не поступит в клинику, оплата не требуется. Запись появится в плане только после подтверждения.</Notice>
      </> : <Notice tone="warning">Выбранное время недоступно. Нажмите «Назад», чтобы выбрать другой приём.</Notice> : <>
        <div className="booking-toolbar">
          <label>Дата приёма<StyledSelect aria-label="Дата приёма" value={selectedDay} disabled={!days.length} onChange={(event) => change('date', event.target.value)}>{!days.length && <option value="">Нет доступных дат</option>}{draft.date && !days.includes(draft.date) && <option value={draft.date}>Выберите новую дату</option>}{days.map((day) => <option key={day} value={day}>{dateLabel(`${day}T09:00:00+03:00`)}</option>)}</StyledSelect></label>
          <Button variant="secondary" className="booking-filter-toggle" aria-controls="booking-filters" aria-expanded={showFilters} onClick={() => setShowFilters((value) => !value)}><SlidersHorizontal size={18} />Фильтры{filterCount > 0 && <span className="booking-filter-count">{filterCount}</span>}</Button>
        </div>
        {showFilters && <div className="booking-filters" id="booking-filters">
          <div className="booking-filter-grid">
            <label>Пол врача<StyledSelect aria-label="Пол врача" value={draft.gender} onChange={(event) => change('gender', event.target.value)}><option value="">Не важно</option><option value="female">Женщина</option><option value="male">Мужчина</option></StyledSelect></label>
            <label>Метро<StyledSelect aria-label="Метро" value={draft.metro} onChange={(event) => change('metro', event.target.value)}><option value="">Любая станция</option>{options('metro').map((value) => <option key={value}>{value}</option>)}</StyledSelect></label>
            <label>Цена от, ₽<input type="number" min="0" step="100" inputMode="numeric" placeholder="0" value={draft.minPrice} aria-invalid={Boolean(rangeError)} aria-describedby={rangeError ? 'booking-price-error' : undefined} onChange={(event) => change('minPrice', event.target.value)} /></label>
            <label>Цена до, ₽<input type="number" min="0" step="100" inputMode="numeric" placeholder="Любая" value={draft.maxPrice} aria-invalid={Boolean(rangeError)} aria-describedby={rangeError ? 'booking-price-error' : undefined} onChange={(event) => change('maxPrice', event.target.value)} /></label>
          </div>
          {rangeError && <p id="booking-price-error" className="booking-validation" role="alert">{rangeError}</p>}
          <details className="booking-extra-filters"><summary>Клиника, район, стаж и язык</summary><div className="booking-filter-grid">
            <label>Клиника<StyledSelect aria-label="Клиника" value={draft.clinic} onChange={(event) => change('clinic', event.target.value)}><option value="">Любая</option>{options('clinic').map((value) => <option key={value}>{value}</option>)}</StyledSelect></label>
            <label>Район<StyledSelect aria-label="Район" value={draft.district} onChange={(event) => change('district', event.target.value)}><option value="">Любой</option>{options('district').map((value) => <option key={value}>{value}</option>)}</StyledSelect></label>
            <label>Стаж<StyledSelect aria-label="Стаж" value={draft.experience} onChange={(event) => change('experience', event.target.value)}><option value="">Любой</option><option value="10">От 10 лет</option><option value="15">От 15 лет</option><option value="20">От 20 лет</option></StyledSelect></label>
            <label>Язык<StyledSelect aria-label="Язык" value={draft.language} onChange={(event) => change('language', event.target.value)}><option value="">Любой</option><option>Русский</option><option>Английский</option></StyledSelect></label>
          </div></details>
          <Button variant="quiet" onClick={resetFilters} disabled={!filterCount}>Сбросить фильтры</Button>
        </div>}
        {!showFilters && filterCount > 0 && <div className="booking-applied-filters"><span>Условия: {[draft.gender === 'female' ? 'женщина' : draft.gender === 'male' ? 'мужчина' : '', draft.metro && `м. ${draft.metro}`, draft.minPrice && `от ${priceLabel(Number(draft.minPrice))}`, draft.maxPrice && `до ${priceLabel(Number(draft.maxPrice))}`, draft.clinic, draft.district, draft.experience && `стаж от ${draft.experience} лет`, draft.language].filter(Boolean).join(' · ')}</span><Button variant="quiet" onClick={resetFilters}>Сбросить фильтры</Button></div>}
        <div className="booking-list-toolbar"><p aria-live="polite">Врачей: <strong>{filtered.length}</strong><span> · время мск</span></p><label><span className="sr-only">Сортировка врачей</span><StyledSelect aria-label="Сортировка врачей" value={draft.sort} onChange={(event) => change('sort', event.target.value)}><option value="availability">Ближайшее время</option><option value="price_asc">Сначала дешевле</option><option value="price_desc">Сначала дороже</option><option value="distance">Ближе к демо-точке</option></StyledSelect></label></div>
        {filtered.length === 0 && <div className="booking-empty"><h3>Нет врачей с такими условиями</h3><p>{rangeError || 'Попробуйте расширить диапазон стоимости или выбрать другую станцию метро.'}</p><Button variant="secondary" onClick={resetFilters}>Показать всех врачей</Button></div>}
        {available.length === 0 && filtered.length > 0 && <Notice>Свободного времени по этой специальности пока нет. Можно закрыть окно и вернуться к плану позже.</Notice>}
        <div className="booking-doctors">
          {filtered.map((item) => {
            const doctorSlots = slots.filter((slot) => slot.doctorId === item.id);
            const isSelected = doctor?.id === item.id;
            return <article className={`booking-doctor ${isSelected ? 'is-selected' : ''}`} key={item.id} data-doctor-id={item.id}>
              <div className="booking-doctor-heading"><DoctorAvatar doctor={item} /><div className="booking-doctor-name"><h3>{item.name}</h3><p>{item.specialty} · стаж {item.experience} лет</p></div><div className="booking-price"><strong>{priceLabel(item.price)}</strong><span>за приём</span></div></div>
              <p className="booking-qualification">{item.qualification}</p>
              <div className="booking-location"><p><TrainFront size={15} aria-hidden="true" />м. {item.metro}<span>{distanceLabel(item.distanceKm)}</span></p><p><MapPin size={15} aria-hidden="true" />{item.clinic}</p><p className="booking-address">{item.address}</p></div>
              <details className="booking-education"><summary>Образование и информация о враче</summary><p><strong>Образование:</strong> {item.education} Подготовка по специальности «{item.specialty}».</p><p><strong>Квалификация:</strong> {item.qualification}.</p><p>Пол: {item.gender === 'female' ? 'женщина' : 'мужчина'}. Языки: {item.languages.join(', ')}.</p><p className="muted">Учебная биография и портрет. Не является сведением о реальном специалисте. Расстояние задано для демо, геолокация не используется.</p></details>
              <div className="booking-slots" aria-label={`Время приёма: ${item.name}`}>
                {doctorSlots.map((slot) => <button className="booking-slot" type="button" key={slot.id} aria-pressed={draft.slotId === slot.id} onClick={() => { setDraft({ ...draft, slotId: slot.id }); setError(''); }}>{draft.slotId === slot.id && <Check size={14} aria-hidden="true" />}{timeLabel(slot.start)}</button>)}
                {!doctorSlots.length && <p>На эту дату времени нет. Выберите другую дату выше.</p>}
              </div>
            </article>;
          })}
        </div>
      </>}
    </div>
  </Dialog>;
}
