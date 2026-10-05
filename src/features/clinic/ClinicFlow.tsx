import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, ChevronRight, Clock3, FileText, PencilLine, Phone, Plus, Search, ShieldCheck } from 'lucide-react';
import {
  confirmDocument,
  createClinicDocument,
  isReadyForAnalysis,
  SYNTHETIC_FIXTURES,
  updateDocumentSections,
} from '../../domain';
import type { Analysis, DocumentRecord, DocumentSections, RouteStep } from '../../domain';
import { analyzeLocal } from '../../engine';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Notice } from '../../ui/Status';
import { RouteView } from '../patient/RouteView';
import { ReviewView, initialReviewView } from '../intake/ReviewView';
import { IntakeView } from '../intake/IntakeView';
import { toDocument } from '../intake/toDocument';
import { disposeExtraction, extractDocument, extractPhotoPages, extractText } from '../intake/extract';
import type { ExtractedDocument, ExtractionProgress, PhotoPageInput } from '../intake/types';
import { DoctorPicker, blankDraft } from '../booking/DoctorPicker';
import type { PickerDraft } from '../booking/DoctorPicker';
import { BookingResult } from '../booking/BookingResult';
import { createCatalog, createBooking, dateLabel } from '../booking/state';
import type { Booking } from '../booking/state';
import { getActiveDemoBookings, publishDemoActivity, sameDemoRouteStep, useDemoActivities } from '../demo/bridge';
import { ClinicDemoTools } from './ClinicDemoTools';
import type { DemoNotification, StaffFeedback } from './demoState';
import './Clinic.css';

interface ClinicEvent {
  id: string;
  caseId: string;
  kind: 'contact' | 'deferred' | 'booked' | 'revised';
  reason: string;
  due: string | null;
  at: string;
  revision: number;
}
interface ClinicCase {
  id: string;
  title: string;
  extraction: ExtractedDocument | null;
  label: string;
  document: DocumentRecord;
  analysis: Analysis | null;
  patientId: string;
  receivedAt: string;
  pending: boolean;
}
const patientNames = ['Анна Соколова', 'Мария Лебедева', 'Дмитрий Волков', 'Елена Орлова', 'Алексей Миронов', 'Ольга Белова', 'Ирина Морозова', 'Сергей Павлов', 'Вера Егорова', 'Наталья Крылова', 'Екатерина Новикова', 'Илья Смирнов'];
const statusLabels: Record<string, string> = {
  open: 'Новый результат',
  contact: 'Связаться с пациентом',
  deferred: 'Ожидаем ответа',
  proposed: 'План предложен',
  booked: 'Записан',
  cancelled: 'Запись отменена',
  viewed: 'Результат открыт',
  revised: 'Текст подтверждён',
  processing: 'Ожидаем результат',
  review: 'Нужна сверка текста',
};
const eventLabels: Record<string, string> = { contact: 'Запланирован звонок', deferred: 'Ожидание ответа', booked: 'Подтверждён приём', revised: 'Сверен текст' };
function shortDate(value: string) { return new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
const sectionLabels: Record<string, string> = {
  description: 'Описание',
  conclusion: 'Заключение',
  recommendations: 'Рекомендации',
  other: 'Другой контекст',
};

export function ClinicFlow({ demo, active, onOpenPatient, onHome, queueToken = 0 }: {
  demo: boolean;
  active: boolean;
  onOpenPatient?: (fixtureId: string) => void;
  onHome?: () => void;
  queueToken?: number;
}) {
  const [cases, setCases] = useState<ClinicCase[]>(() =>
    demo ? SYNTHETIC_FIXTURES.map((fixture, i) => {
      const document = createClinicDocument(fixture.id);
      return {
        id: fixture.id,
        title: fixture.title,
        extraction: null,
        label: patientNames[i] ?? `Пациент демо ${i + 1}`,
        patientId: `demo-patient-${i + 1}`,
        receivedAt: new Date(Date.now() - i * 3_600_000).toISOString(),
        pending: fixture.id === 'chest-negative',
        document,
        analysis: fixture.id === 'chest-negative' ? null : analyzeLocal(document),
      };
    }) : [],
  );
  const catalog = useMemo(() => createCatalog(), []);
  const activities = useDemoActivities();
  const [notifications, setNotifications] = useState<DemoNotification[]>([]);
  const [staffFeedback, setStaffFeedback] = useState<StaffFeedback[]>([]);
  const [selection, setSelection] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [caseTab, setCaseTab] = useState<'documents' | 'plan' | 'history'>('documents');
  const [adding, setAdding] = useState(false);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [intakeError, setIntakeError] = useState('');
  const [reviewView, setReviewView] = useState(initialReviewView);
  const operation = useRef<AbortController | null>(null);
  const casesRef = useRef(cases);
  casesRef.current = cases;
  const [reviewError, setReviewError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [events, setEvents] = useState<ClinicEvent[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const bookingRef = useRef(bookings);
  bookingRef.current = bookings;
  const [step, setStep] = useState<RouteStep | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PickerDraft>>({});
  const [taskType, setTaskType] = useState<'contact' | 'deferred' | null>(null);
  const [reason, setReason] = useState('');
  const [due, setDue] = useState('');
  const [taskError, setTaskError] = useState('');
  const queueScroll = useRef(0);
  useEffect(() => {
    operation.current?.abort();
    operation.current = null;
    setProgress(null);
    setSelection(null);
    setEditing(false);
    setAdding(false);
    setStep(null);
    setTaskType(null);
  }, [queueToken]);
  useEffect(() => {
    if (!active) {
      operation.current?.abort();
      operation.current = null;
      setProgress(null);
      setStep(null);
      setTaskType(null);
    }
  }, [active]);
  useEffect(() => () => {
    operation.current?.abort();
    for (const item of casesRef.current) {
      if (item.extraction) disposeExtraction(item.extraction);
    }
  }, []);
  const current = cases.find((c) => c.id === selection);
  const isDemoDocument = (document: DocumentRecord) => demo
    && (document.origin === 'builtin_fixture' || document.origin === 'clinic_adapter');
  const patientBookings = demo ? getActiveDemoBookings(activities) : [];
  const cancelledIds = new Set(activities.filter(item => item.kind === 'booking_cancelled').map(item => item.bookingId));
  const activeBookings = bookings.filter(booking => !cancelledIds.has(booking.id));
  const status = (item: ClinicCase) => {
    if (item.pending) return 'processing';
    if (!item.analysis) return 'review';
    if (activeBookings.some((b) => b.documentId === item.document.id && b.revision === item.document.revision))
      return 'booked';
    if (patientBookings.some((booking) => booking.fixtureId === item.document.fixtureId
      && booking.documentRevision === item.document.revision)) return 'booked';
    if (activities.some(event => event.kind === 'booking_cancelled' && event.fixtureId === item.document.fixtureId && event.documentRevision === item.document.revision)) return 'cancelled';
    if (notifications.some((notice) => notice.fixtureId === item.document.fixtureId && notice.revision === item.document.revision && notice.reason === 'unbooked')) return 'proposed';
    if (activities.some((event) => event.fixtureId === item.document.fixtureId && event.documentRevision === item.document.revision && event.kind === 'result_opened')) return 'viewed';
    return (
      events
        .filter(
          (e) =>
            e.caseId === item.id &&
            e.kind !== 'revised' &&
            e.kind !== 'booked' &&
            e.revision === item.document.revision,
        )
        .at(-1)?.kind ?? 'open'
    );
  };
  const patientGroups = Array.from(new Set(cases.map(item => item.patientId))).map(patientId => {
    const documents = cases.filter(item => item.patientId === patientId);
    return { patientId, documents, latest: documents.at(-1)! };
  });
  const filtered = patientGroups.filter(({ documents, latest }) =>
    (!search || `${latest.label} ${documents.map(item => item.title).join(' ')}`.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')))
    && (filter === 'all' || documents.some(item => status(item) === filter)),
  );
  const patientDocuments = current ? cases.filter(item => item.patientId === current.patientId) : [];
  const permitted = cases.filter((c) =>
    isDemoDocument(c.document) && c.analysis?.routeSteps.some((s) => s.bookingAllowed),
  );
  const completed = permitted.filter((c) =>
    c
      .analysis!.routeSteps.filter((s) => s.bookingAllowed)
      .every((s) =>
        activeBookings.some(
          (b) => b.documentId === c.document.id && b.revision === c.document.revision && b.stepId === s.id,
        ) || patientBookings.some((booking) => booking.fixtureId === c.document.fixtureId
          && booking.documentRevision === c.document.revision && sameDemoRouteStep(booking.stepId, s.id)),
      ),
  ).length;
  const historicalBookings = current
    ? activeBookings.filter((b) => b.documentId === current.document.id && b.revision !== current.document.revision)
    : [];

  function cancelImport() {
    operation.current?.abort();
    operation.current = null;
    setProgress(null);
  }
  function addDocument(extraction: ExtractedDocument, origin: 'local_file' | 'paste') {
    const document = toDocument(extraction, origin);
    const item: ClinicCase = {
      id: document.id,
      patientId: current?.patientId ?? document.id,
      receivedAt: new Date().toISOString(),
      pending: false,
      label: current?.label ?? `Пациент · локальная карточка ${casesRef.current.filter((item) => !isDemoDocument(item.document)).length + 1}`,
      title: extraction.name,
      extraction,
      document,
      analysis: null,
    };
    const next = [...casesRef.current, item];
    casesRef.current = next;
    setCases(next);
    setSelection(item.id);
    setSearch('');
    setFilter('all');
    setAdding(false);
    setEditing(true);
    setCaseTab('documents');
    setReviewError('');
    setReviewView(initialReviewView());
    if (window.innerWidth < 768) window.scrollTo(0, 0);
  }
  async function readImport(input: File | PhotoPageInput[]) {
    cancelImport();
    const controller = new AbortController();
    operation.current = controller;
    setIntakeError('');
    setProgress({ stage: 'validating', current: 0, total: 0, percent: 0, label: 'Проверяем документ' });
    try {
      const options = {
        signal: controller.signal,
        onProgress: (value: ExtractionProgress) => {
          if (!controller.signal.aborted) setProgress(value);
        },
      };
      const extraction = Array.isArray(input)
        ? await extractPhotoPages(input, options)
        : await extractDocument(input, options);
      if (controller.signal.aborted) {
        disposeExtraction(extraction);
        return;
      }
      // User imports remain local even when their text resembles a demo fixture.
      addDocument(extraction, 'local_file');
    } catch (error) {
      if (!controller.signal.aborted)
        setIntakeError(error instanceof Error ? error.message : 'Не удалось прочитать документ.');
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setProgress(null);
      }
    }
  }
  function pasteImport(text: string) {
    cancelImport();
    setIntakeError('');
    try {
      addDocument(extractText(text), 'paste');
    } catch (error) {
      setIntakeError(error instanceof Error ? error.message : 'Проверьте введённый текст.');
    }
  }
  function resolveUnread() {
    if (!current) return;
    setCases((all) => all.map((item) => item.id === current.id ? {
      ...item,
      analysis: null,
      document: {
        ...item.document,
        revision: item.document.revision + 1,
        unreadPages: [],
        extractionStatus: 'ready',
        confirmedRevision: null,
        confirmedAt: null,
      },
    } : item));
    setDrafts({});
    setReviewError('');
  }

  function select(id: string) {
    cancelImport();
    queueScroll.current = window.scrollY;
    setSelection(id);
    setCaseTab('documents');
    setStep(null);
    setTaskType(null);
    setEditing(false);
    setReviewError('');
    setReviewView(initialReviewView());
    setAdding(false);
    if (window.innerWidth < 768) window.scrollTo(0, 0);
  }
  function back() {
    setSelection(null);
    setEditing(false);
    requestAnimationFrame(() => window.scrollTo(0, queueScroll.current));
  }
  function editSource(sections: DocumentSections) {
    if (!current) return;
    const document = updateDocumentSections(current.document, sections);
    setCases((all) =>
      all.map((item) =>
        item.id === current.id ? { ...item, document, analysis: null } : item,
      ),
    );
    setStep(null);
    setDrafts((all) =>
      Object.fromEntries(Object.entries(all).filter(([key]) => !key.startsWith(`${current.id}:`))),
    );
    setReviewError('');
  }
  function confirmSource() {
    if (!current) return;
    try {
      const document = confirmDocument(current.document);
      const analysis = analyzeLocal(document);
      setCases((all) =>
        all.map((item) => (item.id === current.id ? { ...item, document, analysis } : item)),
      );
      if (current.document.confirmedRevision !== current.document.revision) {
        setEvents((all) => [
          ...all,
          {
            id: crypto.randomUUID(),
            caseId: current.id,
            kind: 'revised',
            reason: 'Координатор сверил текст с исходником. Врачебная проверка не выполнялась.',
            due: null,
            at: new Date().toISOString(),
            revision: document.revision,
          },
        ]);
      }
      setEditing(false);
      setCaseTab('plan');
      setReviewError('');
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Не удалось подтвердить текст.');
    }
  }
  function task(kind: 'contact' | 'deferred') {
    setTaskType(kind);
    setReason('');
    setTaskError('');
    setDue('');
  }
  function saveTask() {
    if (!current || !taskType) return;
    if (
      reason.trim().length < 5 ||
      reason.trim().length > 500 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(due) ||
      !Number.isFinite(Date.parse(`${due}T12:00:00+03:00`))
    ) {
      setTaskError('Укажите причину от 5 до 500 символов и корректный срок задачи.');
      return;
    }
    setEvents((all) => [
      ...all,
      {
        id: crypto.randomUUID(),
        caseId: current.id,
        kind: taskType,
        reason: reason.trim(),
        due,
        at: new Date().toISOString(),
        revision: current.document.revision,
      },
    ]);
    setTaskType(null);
    setCaseTab('history');
  }
  function book(slotId: string) {
    if (
      !demo ||
      !current || !isDemoDocument(current.document) ||
      !current?.analysis ||
      !isReadyForAnalysis(current.document) ||
      !step?.bookingAllowed ||
      !current.analysis.routeSteps.some(
        (s) => s.id === step.id && s.specialtyId === step.specialtyId && s.bookingAllowed,
      ) ||
      !step.specialtyId
    )
      throw new Error('Допустимый подтверждённый шаг не выбран.');
    const booking = createBooking(
      bookingRef.current.filter(item => !cancelledIds.has(item.id)),
      {
        key: `${current.document.id}:${current.document.revision}:${step.id}`,
        documentId: current.document.id,
        revision: current.document.revision,
        stepId: step.id,
        specialtyId: step.specialtyId,
        slotId,
        mode: current.analysis.mode,
      },
      catalog,
    );
    if (!bookingRef.current.some((b) => b.id === booking.id)) {
      const next = [...bookingRef.current, booking];
      bookingRef.current = next;
      setBookings(next);
      setEvents((all) => [
        ...all,
        {
          id: crypto.randomUUID(),
          caseId: current.id,
          kind: 'booked',
          reason: 'Подтверждён учебный слот',
          due: booking.slot.start,
          at: booking.createdAt,
          revision: current.document.revision,
        },
      ]);
      if (current.document.fixtureId) publishDemoActivity({
        fixtureId: current.document.fixtureId,
        documentRevision: current.document.revision,
        kind: 'booking_confirmed',
        bookingId: booking.id,
        stepId: step.id,
      });
    }
    setStep(null);
  }
  if (!active) return null;
  const currentEvents = events.filter(event => patientDocuments.some(item => item.id === event.caseId));
  const currentNotifications = notifications.filter(notice => patientDocuments.some(item => item.document.fixtureId === notice.fixtureId));
  const patientBookingEvents = activities.filter(event => ['booking_confirmed', 'booking_cancelled'].includes(event.kind) && patientDocuments.some(item => item.document.fixtureId === event.fixtureId)
    && (event.kind === 'booking_cancelled' || !bookings.some(booking => booking.id === event.bookingId)));
  return <div className="clinic-workspace">
    <nav className="clinic-breadcrumbs" aria-label="Хлебные крошки клиники">
      <button type="button" onClick={onHome ?? back}>MediPath</button><ChevronRight size={14} aria-hidden="true" />
      {current || adding ? <button type="button" onClick={() => { cancelImport(); setAdding(false); back(); }}>Рабочее место клиники</button> : <span aria-current="page">Рабочее место клиники</span>}
      {(current || adding) && <><ChevronRight size={14} aria-hidden="true" /><span aria-current="page">{current?.label ?? 'Новая карточка'}</span></>}
    </nav>
    {!current && !adding && <>
      <div className="clinic-dashboard-heading"><div><p className="eyebrow">Координатор клиники</p><h2>Пациенты и результаты</h2><p className="muted">Новые исследования, следующие шаги и связь с пациентами.</p></div>
        <Button variant="secondary" onClick={() => { setAdding(true); setIntakeError(''); }}><Plus size={18} />Добавить документ</Button>
      </div>
      {demo && <p className="small muted clinic-synthetic-label">Демонстрационная база · имена, исследования и события вымышлены</p>}
      <div className="clinic-metrics" aria-label="Обзор очереди">
        <button onClick={() => setFilter('all')} aria-pressed={filter === 'all'}><span>Пациентов</span><strong>{patientGroups.length}</strong><small>в этой сессии</small></button>
        <button onClick={() => setFilter('open')} aria-pressed={filter === 'open'}><span>Новые результаты</span><strong>{cases.filter(item => status(item) === 'open').length}</strong><small>ожидают следующего шага</small></button>
        <button onClick={() => setFilter('proposed')} aria-pressed={filter === 'proposed'}><span>План предложен</span><strong>{cases.filter(item => status(item) === 'proposed').length}</strong><small>приглашение подготовлено</small></button>
        <button onClick={() => setFilter('booked')} aria-pressed={filter === 'booked'}><span>Записаны</span><strong>{patientGroups.filter(group => group.documents.some(item => status(item) === 'booked')).length}</strong><small>{demo ? 'подтверждённые приёмы' : 'интеграция не подключена'}</small></button>
      </div>
      <section className="panel clinic-registry" aria-labelledby="clinic-queue-heading">
        <div className="clinic-card-heading"><h3 id="clinic-queue-heading">Пациенты в работе <span className="clinic-count">{filtered.length}</span></h3>
          <label className="clinic-search"><Search size={18} /><span className="sr-only">Поиск пациента</span><input placeholder="Имя или исследование" value={search} onChange={event => setSearch(event.target.value)} /></label>
        </div>
        <div className="clinic-status-filters" aria-label="Фильтр статуса">
          {[['all', 'Все пациенты'], ...Object.entries(statusLabels).filter(([key]) => key !== 'revised')].map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
        </div>
        <div className="clinic-registry-columns" aria-hidden="true"><span>Пациент / исследование</span><span>Поступило</span><span>Статус</span><span /></div>
        <div className="clinic-queue-list">{filtered.map(({ patientId, documents, latest }) => <button className="clinic-patient-row" key={patientId} onClick={() => select(latest.id)}>
          <span className="clinic-queue-identity"><strong>{latest.label}</strong><span>{latest.title}{documents.length > 1 ? ` · ещё ${documents.length - 1}` : ''}</span></span>
          <span className="clinic-received">{shortDate(latest.receivedAt)}</span>
          <span className={`clinic-status status-${status(latest)}`}>{statusLabels[status(latest)]}</span><ChevronRight size={18} />
        </button>)}</div>
        {!filtered.length && <div className="empty-state"><FileText size={32} /><h3>{cases.length ? 'Нет пациентов по выбранным условиям' : 'В очереди пока нет документов'}</h3><p className="muted">{cases.length ? 'Попробуйте другое имя или статус.' : 'Загрузите документ для локальной карточки или откройте учебную очередь через демопанель.'}</p>{cases.length > 0 && <Button variant="quiet" onClick={() => { setSearch(''); setFilter('all'); }}>Сбросить фильтры</Button>}</div>}
      </section>
    </>}
    {adding && <section className="stack"><div className="clinic-card-heading"><div><p className="eyebrow">{current ? current.label : 'Новая локальная карточка'}</p><h2>Добавить документ</h2></div><Button variant="quiet" onClick={() => { cancelImport(); setAdding(false); }}>Закрыть загрузку</Button></div>
      <IntakeView onFile={readImport} onPhotos={readImport} onText={pasteImport} progress={progress} error={intakeError} onCancel={cancelImport} hasDocument={false} onResume={() => setAdding(false)} />
    </section>}
    {current && !adding && <div className="clinic-selected-case stack">
      <div className="clinic-case-top">
        <Button className="clinic-back" variant="quiet" onClick={back}><ArrowLeft size={18} />К списку пациентов</Button>
        <div className="clinic-case-heading"><div><p className="eyebrow">{isDemoDocument(current.document) ? 'Карточка пациента' : 'Локальная карточка · без сохранения в МИС'}</p><h2>{current.label}</h2><p className="small muted">Документов: {patientDocuments.length} · Последнее поступление: {shortDate(patientDocuments.at(-1)!.receivedAt)}</p></div><span className={`clinic-status status-${status(current)}`}>{statusLabels[status(current)]}</span></div>
        {!editing && <div className="clinic-patient-actions">
          <Button onClick={() => setCaseTab('plan')} disabled={!current.analysis}><CalendarDays size={18} />Подготовить план посещений</Button>
          <Button variant="secondary" onClick={() => task('contact')}><Phone size={17} />Запланировать звонок</Button>
          <Button variant="quiet" onClick={() => { setAdding(true); setIntakeError(''); }}><Plus size={17} />Добавить документ</Button>
        </div>}
      </div>
      {!editing && demo && current.document.fixtureId && <ClinicDemoTools key={current.document.id}
        document={current.document} analysis={current.analysis} label={current.label} activities={activities}
        bookedStepIds={activeBookings.filter(booking => booking.documentId === current.document.id && booking.revision === current.document.revision).map(booking => booking.stepId)}
        notifications={notifications} feedback={staffFeedback} onNotificationsChange={setNotifications} onFeedbackChange={setStaffFeedback} onOpenPatient={onOpenPatient} />}
      {editing ? <ReviewView key={current.id} view={reviewView} onViewChange={setReviewView} document={current.document} extraction={current.extraction} busy={false} onEdit={editSource} onConfirm={confirmSource} onBack={() => setEditing(false)} onResolveUnread={resolveUnread} processing="local" setProcessing={() => undefined} liveAllowed={false} error={reviewError} onCancel={() => setEditing(false)} /> : <>
        <div className="clinic-tabs" role="tablist" aria-label="Карточка пациента">{([['documents', 'Медкарта'], ['plan', 'План посещений'], ['history', 'История действий']] as const).map(([key, title]) => <button role="tab" id={`clinic-tab-${key}`} aria-controls={`clinic-panel-${key}`} aria-selected={caseTab === key} tabIndex={caseTab === key ? 0 : -1} key={key} onClick={() => setCaseTab(key)} onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const keys = ['documents', 'plan', 'history'] as const; const index = keys.indexOf(caseTab); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3; setCaseTab(keys[next]); requestAnimationFrame(() => document.getElementById(`clinic-tab-${keys[next]}`)?.focus()); }}>{title}{key === 'documents' && <span>{patientDocuments.length}</span>}</button>)}</div>
        <section role="tabpanel" id={`clinic-panel-${caseTab}`} aria-labelledby={`clinic-tab-${caseTab}`} className="clinic-tab-panel">
        {caseTab === 'documents' && <div className="clinic-medcard-layout">
          <section className="panel clinic-document-list"><div className="clinic-card-heading"><h3>Документы пациента</h3></div>{patientDocuments.map(item => <button key={item.id} className={`clinic-document-option${current.id === item.id ? ' active' : ''}`} aria-pressed={current.id === item.id} onClick={() => setSelection(item.id)}><FileText size={20} /><span><strong>{item.title}</strong><small>{shortDate(item.receivedAt)}</small><span className={`clinic-status status-${status(item)}`}>{statusLabels[status(item)]}</span></span></button>)}</section>
          <section className="panel clinic-document"><div className="clinic-card-heading"><h3 id="clinic-source-title"><FileText size={21} />{current.title}</h3></div>
            {current.pending ? <div className="clinic-pending-result"><Clock3 size={30} /><h3>Исследование ещё готовится</h3><p className="muted">В учебной системе есть запись об исследовании. Заключение пока не опубликовано, план по нему недоступен.</p><Button onClick={() => setCases(all => all.map(item => item.id === current.id ? { ...item, pending: false, analysis: analyzeLocal(item.document) } : item))}>Получить готовый результат в демо</Button></div> : <>
              <p className="small muted clinic-source-note">{current.document.sourceValidation ? 'Структурированный результат учебной системы. Принадлежность и версия проверены; врачебная проверка в MediPath не выполнялась.' : 'Исходник сохранён в текущей вкладке. Исправления требуют повторной сверки.'}</p>
              <div className="clinic-source-sections">{Object.entries(current.document.sections).filter(([, text]) => text).map(([key, text]) => <div key={key}><h4>{sectionLabels[key] ?? key}</h4><p>{text}</p></div>)}</div>
              <div className="button-row spaced-top"><Button variant="secondary" disabled={!current.analysis} onClick={() => setCaseTab('plan')}>Посмотреть следующий шаг<ArrowRight size={17} /></Button><Button variant="quiet" onClick={() => { setEditing(true); setStep(null); }}><PencilLine size={17} />Исправить текст документа</Button></div>
            </>}
          </section>
        </div>}
        {caseTab === 'plan' && <div className="stack">{current.analysis ? <><p className="small muted">Пациент: {current.label}. Администратор может согласовать приём по телефону и выбрать время вместе с пациентом.</p><RouteView title="План посещений пациента" compact analysis={current.analysis} bookings={activeBookings} bookingAvailable={isDemoDocument(current.document)} onBook={setStep} onSource={anchor => { const index = current.extraction?.blocks.findIndex(block => block.id === anchor.blockId) ?? current.document.blocks.findIndex(block => block.id === anchor.blockId); if (index < 0) return; setReviewView(view => ({ ...view, tab: 'original', page: index })); setEditing(true); }} /></> : <Notice tone="warning">{current.pending ? 'Заключение ещё не готово. Получите результат на вкладке «Медкарта».' : 'Сверьте и подтвердите текст документа, чтобы получить актуальный план.'}{!current.pending && <Button className="spaced-top" onClick={() => setEditing(true)}>Перейти к сверке текста</Button>}</Notice>}
          <Button variant="quiet" onClick={() => task('deferred')}><Clock3 size={17} />Ожидать ответа пациента</Button>
          {historicalBookings.length > 0 && <section className="panel stack"><h3>Предыдущие записи</h3>{historicalBookings.map(booking => <BookingResult key={booking.id} booking={booking} currentRevision={current.document.revision} />)}</section>}
        </div>}
        {caseTab === 'history' && <section className="panel clinic-history"><h3>История действий</h3><p className="small muted">События карточки {current.label}. Данные остаются в текущей сессии.</p>
          <ol className="clinic-event-list">{patientDocuments.map(item => <li key={`received-${item.id}`}><span className="clinic-event-dot" /><div><strong>{item.pending ? 'Ожидаем заключение' : 'Документ поступил'}</strong><p>{item.title}</p><small>{shortDate(item.receivedAt)}</small></div></li>)}{currentEvents.map(event => <li key={event.id}><span className="clinic-event-dot" /><div><strong>{eventLabels[event.kind]}</strong><p>{event.reason}</p><small>{shortDate(event.at)}{event.due ? ` · Срок: ${event.due.includes('T') ? dateLabel(event.due) : event.due}` : ''}{(event.kind === 'contact' || event.kind === 'deferred') ? ' · Сообщение не отправлялось.' : ''}</small></div></li>)}{patientBookingEvents.map(event => <li key={event.id}><span className="clinic-event-dot" /><div><strong>{event.kind === 'booking_cancelled' ? 'Запись отменена пациентом' : 'Пациент подтвердил запись'}</strong><p>{patientDocuments.find(item => item.document.fixtureId === event.fixtureId)?.title}</p><small>{shortDate(event.at)}</small></div></li>)}{currentNotifications.map(notice => <li key={notice.id}><span className="clinic-event-dot" /><div><strong>{notice.reason === 'unbooked' ? 'Подготовлено предложение плана' : 'Создано демоуведомление'}</strong><p>{notice.channel === 'push' ? 'Push' : 'SMS'} · {notice.openedAt ? 'Открыто в демо' : 'Создано в демо'} · Отправки не было</p><small>{shortDate(notice.createdAt)}</small></div></li>)}</ol>
        </section>}
        </section>
      </>}
    </div>}
    <p className="clinic-session-description"><ShieldCheck size={15} /><span>{demo ? `Учебная сессия · маршрутов с подтверждёнными приёмами: ${completed} из ${permitted.length}. Реальная запись и доставка сообщений не подключены.` : 'Локальная сессия · данные не сохраняются после обновления страницы. Запись и сообщения в клинику не отправляются.'}</span></p>
    {current && isDemoDocument(current.document) && step && <DoctorPicker step={step} catalog={catalog} bookings={activeBookings} draft={drafts[`${current.id}:${step.id}`] ?? blankDraft()} setDraft={draft => setDrafts(all => ({ ...all, [`${current.id}:${step.id}`]: draft }))} onConfirm={book} onClose={() => setStep(null)} />}
    {taskType && current && <Dialog title={taskType === 'contact' ? 'Запланировать звонок пациенту' : 'Ожидать ответа пациента'} eyebrow={current.label} onClose={() => setTaskType(null)} footer={<Button onClick={saveTask}>{taskType === 'contact' ? 'Сохранить задачу звонка' : 'Сохранить ожидание'}</Button>}><div className="stack"><Notice>Задача для координатора по карточке {current.label}. Звонок и отправка сообщения не выполняются.</Notice>{taskError && <Notice tone="error">{taskError}</Notice>}<label>Причина<textarea rows={4} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder={taskType === 'contact' ? 'Например, согласовать время приёма по готовому направлению' : 'Какого ответа или документа ожидаем'} /></label><label>Срок<input type="date" value={due} onChange={event => setDue(event.target.value)} /></label></div></Dialog>}
  </div>;
}
