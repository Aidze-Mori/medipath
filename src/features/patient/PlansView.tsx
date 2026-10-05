import { useEffect, useRef, useState } from 'react';
import { CalendarArrowDown, Check, FileText, ListChecks, Pencil } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Status';
import { BookingDays } from '../booking/BookingDays';
import { downloadPlanCalendar } from '../booking/calendar';
import type { Booking } from '../booking/state';
import { bookingsForPlan, findVisitBooking, mergePlanVisits, overlappingVisitBookings } from './plans';
import type { PatientPlan } from './plans';
import { PlanFeedback } from './PlanFeedback';
import type { PlanFeedbackValue } from './PlanFeedback';
import './PlansView.css';

const dateLabel = (iso: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export function PlansList({ plans, bookings, onOpen, onCreate, onDelete }: { plans: PatientPlan[]; bookings: Booking[]; onOpen: (plan: PatientPlan) => void; onCreate: () => void; onDelete: (plan: PatientPlan) => void }) {
  return <section className="plans-library"><header className="panel-head"><div><p className="eyebrow">Медкарта · следующие шаги</p><h2>Мои планы</h2><p className="muted">Сохранённые маршруты и незавершённое планирование.</p></div><Button variant="secondary" onClick={onCreate}>Новый маршрут</Button></header>
    {plans.length ? <div className="stack">{[...plans].reverse().map(plan => <article className="panel saved-plan" key={plan.id}><div className="saved-plan-icon"><ListChecks size={24} /></div><div className="saved-plan-body"><span className={`plan-status${plan.completedAt ? ' is-complete' : ''}`}>{plan.completedAt ? 'Маршрут завершён' : 'Черновик'}</span><h3>{plan.documents.map(item => item.title).join(' + ')}</h3><p className="small muted">{dateLabel(plan.completedAt ?? plan.createdAt)} · Документов: {plan.documents.length} · Приёмов: {bookingsForPlan(plan, bookings).length}</p></div><Button variant="secondary" onClick={() => onOpen(plan)}>{plan.completedAt ? 'Открыть план' : 'Продолжить планирование'}</Button><Button variant="quiet" onClick={() => onDelete(plan)}>Удалить план</Button></article>)}</div> : <div className="panel empty-state"><ListChecks size={36} /><h3>Планов пока нет</h3><p className="muted">Выберите результаты в медкарте или добавьте документ. Готовый маршрут появится здесь.</p><Button onClick={onCreate}>Создать первый маршрут</Button></div>}
  </section>;
}

export function PlanSummary({ plan, bookings, revisions, onEdit, feedback, onFeedback, onCancelBooking, onDelete }: { plan: PatientPlan; bookings: Booking[]; revisions: Record<string, number>; onEdit: () => void; feedback: PlanFeedbackValue; onFeedback: (value: PlanFeedbackValue) => void; onCancelBooking: (booking: Booking) => void; onDelete: () => void }) {
  const [downloaded, setDownloaded] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const visits = mergePlanVisits(plan.documents, plan.additionalSteps);
  const confirmed = bookingsForPlan(plan, bookings);
  const stale = plan.documents.some(item => revisions[item.document.id] !== undefined && revisions[item.document.id] !== item.document.revision);
  return <section className="completed-plan"><header className="completed-plan-heading"><span className="completed-plan-check"><Check size={27} /></span><div><p className="eyebrow">План сохранён в «Мои планы»</p><h2 ref={heading} tabIndex={-1}>Маршрут завершён</h2><p className="muted">{plan.completedAt && dateLabel(plan.completedAt)} · Подтверждено приёмов: {confirmed.length}</p></div></header>
    {stale && <Notice tone="warning">Один из документов изменён. Этот завершённый план сохранён как история прежней редакции.</Notice>}
    <section className="panel"><h3><FileText size={20} /> Документы маршрута</h3><ul className="plan-documents">{plan.documents.map(item => <li key={item.document.id}>{item.title}{item.document.revision > 1 && <span className="muted small">Текст исправлен · версия {item.document.revision}</span>}</li>)}</ul></section>
    <BookingDays bookings={confirmed} revisions={revisions} onCancel={onCancelBooking} />
    <div className="stack">{visits.filter(visit => !findVisitBooking(visit, bookings)).map(visit => <article className="panel completed-visit" key={visit.step.id}><div className="panel-head"><div><h3>{visit.step.title}</h3><p className="small muted">{visit.sources.map(source => source.title).join(' · ')}</p></div><span className="plan-status">{visit.step.bookingAllowed ? 'Выбор врача отложен' : 'Шаг сохранён'}</span></div><p className="muted">{visit.step.bookingAllowed ? overlappingVisitBookings(visit, bookings).length ? 'Существующая запись учитывает часть исследований. Общий шаг ещё не спланирован. Вернуться к нему можно через редактирование плана.' : 'Запись не создана. Вернуться к выбору можно через редактирование плана.' : visit.step.explanation}</p></article>)}</div>
    {!visits.length && <Notice>Документ разобран. Явных направлений на приём в нём не найдено; новые консультации автоматически не добавлены.</Notice>}
    <div className="plan-summary-actions">{confirmed.length > 0 && <Button onClick={() => { downloadPlanCalendar(confirmed); setDownloaded(true); }}><CalendarArrowDown size={19} />Скачать календарь маршрута</Button>}<Button variant="quiet" onClick={onEdit}><Pencil size={17} />Редактировать маршрут</Button><Button variant="quiet" onClick={onDelete}>Удалить план</Button></div>
    {downloaded && <p className="small muted" role="status">Один ICS-файл содержит все {confirmed.length} подтверждённых приёма этого маршрута. Отложенные шаги не создают события.</p>}
    <PlanFeedback value={feedback} onChange={onFeedback} />
  </section>;
}
