import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, Check, ChevronDown, FileSearch, FileText, Info, Plus, Stethoscope } from 'lucide-react';
import type { Analysis, DocumentRecord, RouteStep, SourceAnchor } from '../../domain';
import { SourceQuote } from './SourceQuote';
import { Button } from '../../ui/Button';
import { Explanation } from '../../ui/Explanation';
import { ModeLabel, Notice } from '../../ui/Status';
import { BookingResult } from '../booking/BookingResult';
import { dateLabel, timeLabel, type Booking } from '../booking/state';
import { findVisitBooking, mergePlanVisits, overlappingVisitBookings } from './plans';
import { AnalysisExplanation } from './AnalysisExplanation';
import { NextStepNotice } from './NextStepNotice';
import './RouteView.css';

type RouteDocument = { document: DocumentRecord; title: string; analysis: Analysis };
export function RouteView({ analysis, documents, bookings, onBook, onEdit, onSource, onEditDocument, onSourceDocument,
  title = 'Ваш маршрут', subtitle = 'Каждое исследование и связанные с ним следующие шаги.', bookingAvailable = true, deferredIds = [], onDefer, compact = false, additionalSteps = [], onAddVisit, onFinish, onCancelBooking,
}: {
  title?: string; subtitle?: string; analysis: Analysis; documents?: RouteDocument[]; bookings: Booking[];
  onBook: (step: RouteStep) => void; onEdit?: () => void; onSource?: (anchor: SourceAnchor) => void;
  onEditDocument?: (id: string) => void; onSourceDocument?: (id: string, anchor: SourceAnchor) => void;
  bookingAvailable?: boolean; deferredIds?: string[]; onDefer?: (step: RouteStep) => void;
  compact?: boolean; additionalSteps?: RouteStep[]; onAddVisit?: () => void; onFinish?: () => void; onCancelBooking?: (booking: Booking) => void;
}) {
  const groups = documents?.length ? documents.map(item => ({ id: item.document.id, title: item.title, analysis: item.analysis, document: item.document })) : [{ id: analysis.documentId, title: 'Текущий документ', analysis, document: undefined }];
  const canBook = (id: string) => bookingAvailable && (!documents || documents.some(item => item.document.id === id && ['builtin_fixture', 'clinic_adapter'].includes(item.document.origin)));
  const visits = documents?.length ? mergePlanVisits(documents, additionalSteps) : analysis.routeSteps.map(step => ({ step, sources: [{ documentId: analysis.documentId, revision: analysis.documentRevision, stepId: step.id, title: 'Текущий документ' }], evidence: step.sourceRefs.map(ref => ({ documentId: analysis.documentId, ref })) }));
  const pending = visits.filter(visit => visit.sources.every(source => canBook(source.documentId)) && visit.step.bookingAllowed && !deferredIds.includes(visit.step.id) && !overlappingVisitBookings(visit, bookings).length);
  const urgent = visits.some(visit => visit.step.actionId === 'source-urgent-instruction');
  const sourceAction = (id: string) => onSourceDocument ? (anchor: SourceAnchor) => onSourceDocument(id, anchor) : onSource;
  const editAction = (id: string) => onEditDocument ? () => onEditDocument(id) : onEdit;
  return <section className={`visit-route${compact ? ' is-compact' : ''}`}>
    <div className="visit-route-heading"><div><p className="eyebrow">MediPath · план посещений</p><h2>{title}</h2><p className="muted">{subtitle}</p></div><ModeLabel mode={analysis.mode} /></div>
    {groups.length > 1 && <div className="route-context-caption"><h3>План посещений</h3><span>Исследований: {groups.length} · Повторные направления к одному специалисту объединены</span></div>}
    <div className="route-workspace">
      <div className="route-main">
        {groups.map((group, index) => {
          const related = visits.filter(visit => visit.sources.some(source => source.documentId === group.id));
          const own = related.filter(visit => visit.sources[0].documentId === group.id);
          const relatedBookings = [...new Map(related.flatMap(visit => overlappingVisitBookings(visit, bookings).map(booking => [booking.id, booking] as const))).values()];
          const actionable = related.filter(visit => visit.step.bookingAllowed);
          const complete = actionable.length > 0 && actionable.every(visit => findVisitBooking(visit, bookings));
          return <StudyGroup key={`${group.id}:${relatedBookings.map(booking => booking.id).join(',')}`} title={group.title} index={index + 1} complete={complete} bookings={relatedBookings}>
            {group.analysis.llmExplanation ? <AnalysisExplanation analysis={group.analysis} /> : <div className="study-short-result"><h3>Пояснение к результату</h3><p>{group.document?.sections.conclusion || group.analysis.summary}</p><p className="small muted">{group.analysis.mode === 'synthetic_replay' ? 'Сохранённый учебный разбор.' : 'Исходное заключение. Подробное AI-пояснение появится после анализа во внешней модели.'}</p></div>}
            {group.document && <NextStepNotice document={group.document} analysis={group.analysis} />}
            {group.document && <details className="study-source-details"><summary>Текст исследования по разделам</summary>{(['description', 'conclusion', 'recommendations', 'other'] as const).map((kind, i) => group.document!.sections[kind] && <div key={kind}><h4>{['Описание', 'Заключение', 'Рекомендации', 'Дополнительные сведения'][i]}</h4><p>{group.document!.sections[kind]}</p></div>)}{editAction(group.id) && <Button variant="quiet" onClick={editAction(group.id)}>Открыть исследование</Button>}</details>}
            <div className="route-recommendations">
              {!related.length && <div className="empty-state"><FileSearch size={28} /><h3>В документе нет явного направления</h3><p className="muted">Результат сохранён. Если следующий шаг не указан, его можно уточнить у врача.</p></div>}
              {own.map(visit => {
                const { step } = visit;
                const booking = findVisitBooking(visit, bookings), deferred = deferredIds.includes(step.id);
                const partialBookings = booking ? [] : overlappingVisitBookings(visit, bookings);
                const available = visit.sources.every(source => canBook(source.documentId));
                return <article className={`route-card${deferred ? ' is-deferred' : ''}${booking ? ' is-booked' : ''}`} key={step.id}>
                  <div className={`route-step-symbol${booking ? ' is-complete' : ''}`} aria-hidden="true">{booking ? <Check size={23} /> : <Stethoscope size={26} />}</div>
                  <div className="route-card-body"><div className="route-card-heading"><div><h3>{step.title}</h3><p className="route-deadline"><CalendarDays size={16} />{step.dueText || 'В документе не указан срок'}</p></div>{available && step.bookingAllowed && !booking && !partialBookings.length && <Button className="route-select" variant="secondary" onClick={() => onBook(step)}>Выбрать врача<ArrowRight size={16} /></Button>}</div>
                    <p className="small muted">{step.id.startsWith('manual:') ? 'По вашему выбору · вне медицинских рекомендаций' : visit.sources.length > 1 ? `Один приём по ${visit.sources.length} исследованиям: ${visit.sources.map(source => source.title).join(' · ')}` : step.basis === 'explicit_document' ? step.specialtyId ? 'Специальность указана в документе' : 'Следующий шаг прямо указан в документе' : group.analysis.clinicalDemo ? 'Предложение по клиническому источнику · обсудите с врачом' : 'Требует уточнения'}</p>
                    <div className="route-card-actions"><Explanation>{step.explanation}</Explanation>{onDefer && step.bookingAllowed && !booking && <Button variant="quiet" onClick={() => onDefer(step)}>{deferred ? 'Вернуть в план' : 'Выбрать позже'}</Button>}</div>
                    {deferred && !booking && <p className="small muted">{partialBookings.length ? 'Общий шаг отложен · существующие записи сохранены' : 'Выбор отложен · записи пока нет'}</p>}
                    {!available && step.bookingAllowed && <p className="small muted">Онлайн-запись пока не подключена. Обратитесь в выбранную клинику с этим направлением.</p>}
                    <details className="study-visit-evidence"><summary>Почему этот шаг</summary>{visit.evidence.map(({ ref, documentId }, i) => <SourceQuote key={`${documentId}:${i}`} source={ref} onSource={sourceAction(documentId)} />)}</details>
                    {partialBookings.length > 0 && <div className="stack spaced-top" role="region" aria-label="Существующие записи по части исследований"><Notice><strong>У вас уже есть запись по части исследований</strong><p>Новые исследования не добавлены к ней автоматически. Чтобы запланировать общий приём, сначала отмените связанные записи. До этого общий шаг можно оставить отложенным.</p></Notice>{partialBookings.map(existing => <div key={existing.id}><BookingResult booking={existing} showCalendar={false} />{onCancelBooking && <Button variant="secondary" onClick={() => onCancelBooking(existing)}>Отменить и спланировать общий приём</Button>}</div>)}</div>}
                    {booking && <div className="spaced-top"><BookingResult booking={booking} currentRevision={group.analysis.documentRevision} showCalendar={false} />{onCancelBooking && <Button variant="quiet" onClick={() => onCancelBooking(booking)}>Отменить запись</Button>}</div>}
                  </div>
                </article>;
              })}
              {related.filter(visit => visit.sources[0].documentId !== group.id).map(visit => <div className="study-shared-visit" key={visit.step.id}><Stethoscope size={20} /><p><strong>{visit.step.title}</strong><span>{findVisitBooking(visit, bookings) ? 'Вы записаны. Этот приём учитывает и данное исследование.' : `Общий приём с исследованием «${visit.sources[0].title}» выше. Второй раз записываться не нужно.`}</span></p></div>)}
            </div>
          </StudyGroup>;
        })}
        <div className="panel route-recommendations">{onAddVisit && bookingAvailable && !urgent && <button className="add-visit-control" onClick={onAddVisit}><Plus size={24} /><span><strong>Записаться ещё к врачу</strong><small>По вашему выбору, вне рекомендаций</small></span><ArrowRight size={18} /></button>}
          {onFinish && <div className="route-plan-actions">{bookingAvailable && pending.length > 0 && <Button onClick={() => onBook(pending[0].step)}><CalendarDays size={18} />Подобрать время для {pending.length} {pending.length === 1 ? 'врача' : 'врачей'}</Button>}<Button variant={pending.length ? 'secondary' : 'primary'} onClick={onFinish}>Завершить планирование</Button><p className="small muted">Завершение сохранит итоговый план. Невыбранные приёмы останутся отложенными.</p></div>}
        </div>
        {groups.some(group => group.analysis.mode === 'synthetic_replay') && <Notice>Сохранённый учебный шаблон. Это не live-ответ модели.</Notice>}
        <details className="route-method-details"><summary>Основания и ограничения обработки</summary>{groups.map(group => <div className="spaced-top" key={group.id}><strong>{group.title}</strong><p>{group.analysis.summary}</p><ul>{group.analysis.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul><p className="small muted">Версия оснований: {group.analysis.corpusVersion}.</p></div>)}</details>
        <p className="route-limit-note"><Info size={17} /><span>Это организационный маршрут, а не диагноз или врачебная проверка.{bookingAvailable ? ' Приём будет демонстрационным.' : ''}</span></p>
      </div>
      {!compact && <aside className="route-aside"><section className="panel route-documents-panel"><h3><FileText size={23} />Выбранные документы</h3>{groups.map(group => <div className="route-document-row" key={group.id}><FileText size={21} /><div><strong>{group.title}</strong>{group.analysis.documentRevision > 1 && <span className="small muted">Текст исправлен · версия {group.analysis.documentRevision}</span>}</div>{editAction(group.id) && <Button variant="quiet" onClick={editAction(group.id)}>Открыть исследование</Button>}</div>)}<p className="small muted">Каждый приём связан с исследованием. Правки текста потребуют новой проверки.</p></section></aside>}
    </div>
  </section>;
}

function StudyGroup({ title, index, complete, bookings, children }: { title: string; index: number; complete: boolean; bookings: Booking[]; children: ReactNode }) {
  const [open, setOpen] = useState(!complete);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => { if (complete) summary.current?.focus({ preventScroll: true }); }, [complete]);
  return <details className={`panel route-study${complete ? ' is-booked' : ''}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary ref={summary}><span className="study-number" aria-hidden="true">{complete ? <Check size={20} /> : index}</span><span className="study-summary"><span className="eyebrow">Исследование {index}</span><strong>{title}</strong>{complete ? <span className="study-booked-label">Вы записаны{bookings.map(booking => <span key={booking.id}>{booking.doctor.name} · {dateLabel(booking.slot.start)}, {timeLabel(booking.slot.start)} мск</span>)}</span> : <span className="small muted">Результат и следующие шаги{bookings.length ? ` · Подтверждено: ${bookings.length}` : ''}</span>}</span><ChevronDown size={20} className="study-chevron" aria-hidden="true" /></summary>
    <div className="study-content">{children}</div>
  </details>;
}
