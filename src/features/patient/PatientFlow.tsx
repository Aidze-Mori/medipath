import { ProcessingStatus } from '../../ui/ProcessingStatus';
import { StyledSelect } from '../../ui/Select';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import {
  confirmDocument,
  isReadyForAnalysis,
  getFixtureDocument,
  SYNTHETIC_FIXTURES,
  updateDocumentSections,
} from '../../domain';
import type { Analysis, DocumentRecord, DocumentSections, RouteStep, SpecialtyId } from '../../domain';
import { analyzeLocal, getReplayAnalysis } from '../../engine';
import { analyzeDemo, canonicalContent, detectSyntheticFixture } from '../../privacy/policy';
import { analyzeDocument, fetchCapabilities } from '../../privacy/documentAnalysis';
import { PlansList, PlanSummary } from './PlansView';
import { bookingsForPlan, findVisitBooking, matchingPlan, mergePlanVisits, overlappingVisitBookings } from './plans';
import { mergeClinicStudy, sameDemoStudy } from './studyIdentity';
import type { PatientPlan } from './plans';
import { PlanFeedback } from './PlanFeedback';
import type { PlanFeedbackValue } from './PlanFeedback';
import { downloadPlanCalendar } from '../booking/calendar';
import { Stepper } from '../../ui/Stepper';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Notice } from '../../ui/Status';
import { IntakeView } from '../intake/IntakeView';
import { toDocument } from '../intake/toDocument';
import { ReviewView, initialReviewView } from '../intake/ReviewView';
import { extractDocument, extractPhotoPages, extractText, disposeExtraction } from '../intake/extract';
import type { ExtractedDocument, ExtractionProgress, PhotoPageInput } from '../intake/types';
import { DoctorPicker, blankDraft } from '../booking/DoctorPicker';
import type { PickerDraft } from '../booking/DoctorPicker';
import { BookingDays } from '../booking/BookingDays';
import { createBooking, createCatalog, dateLabel, timeLabel } from '../booking/state';
import type { Booking } from '../booking/state';
import { RouteView } from './RouteView';
import { ResultsLibrary, ResultDetails } from './ResultsLibrary';
import type { LibraryEntry } from './ResultsLibrary';
import { loadClinicResults } from './clinicAdapter';
import { publishDemoActivity, useDemoActivities } from '../demo/bridge';
import { PrivacyPreview } from '../intake/PrivacyPreview';
import type { DemoProcessing, DemoScenario } from '../demo/DemoPanel';
export type PatientSection = 'new' | 'plans' | 'plan-edit' | 'plan-detail' | 'result-detail' | 'review' | 'bookings' | 'results' | 'archive';
export function PatientFlow({
  section,
  setSection,
  demo,
  active,
  scenario,
  processingMode,
}: {
  section: PatientSection;
  setSection: (section: PatientSection) => void;
  demo: boolean;
  active: boolean;
  scenario: DemoScenario | null;
  processingMode: DemoProcessing;
}) {
  const [plans, setPlans] = useState<PatientPlan[]>([]);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, PlanFeedbackValue>>({});
  const [processingStage, setProcessingStage] = useState('');
  const [documentLiveConfigured, setDocumentLiveConfigured] = useState(false);
  const [providerLabel, setProviderLabel] = useState('внешняя модель');
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [routeIds, setRouteIds] = useState<string[]>([]);
  const [deferred, setDeferred] = useState<string[]>([]);
  const [additionalSteps, setAdditionalSteps] = useState<RouteStep[]>([]);
  const [addVisit, setAddVisit] = useState(false);
  const [additionalSpecialty, setAdditionalSpecialty] = useState<SpecialtyId>('therapy');
  const [analysisIds, setAnalysisIds] = useState<Record<string, string>>({});
  const [contextRevision, setContextRevision] = useState(1);
  const [clinicError, setClinicError] = useState('');
  const [loadingClinic, setLoadingClinic] = useState(false);
  const [retryScenario, setRetryScenario] = useState(0);
  const resources = useRef(new Map<string, ExtractedDocument>());
  const activities = useDemoActivities();
  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [extraction, setExtraction] = useState<ExtractedDocument | null>(null);
  const [reviewView, setReviewView] = useState(initialReviewView);
  const [stage, setStage] = useState(0);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteWord, setDeleteWord] = useState('');
  const [cancelBooking, setCancelBooking] = useState<Booking | null>(null);
  const [deletePlanId, setDeletePlanId] = useState<string | null>(null);
  const [cancelPlanBookings, setCancelPlanBookings] = useState(false);
  const [processing, setProcessing] = useState('local');
  const [currentProcessing, setCurrentProcessing] = useState('local');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selectedStep, setSelectedStep] = useState<RouteStep | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PickerDraft>>({});
  const catalog = useMemo(() => createCatalog(), []);
  const operation = useRef<AbortController | null>(null);
  const processingSection = useRef(section);
  const currentSection = useRef(section); currentSection.current = section;
  const latest = useRef(doc);
  latest.current = doc;
  const currentExtraction = useRef(extraction);
  currentExtraction.current = extraction;
  const bookingRef = useRef(bookings);
  const bookingResultHeading = useRef<HTMLHeadingElement>(null);
  const scenarioToken = useRef<string | null>(null);
  bookingRef.current = bookings;
  const liveAllowed =
    demo &&
    !!doc &&
    ['builtin_fixture', 'clinic_adapter'].includes(doc.origin) &&
    SYNTHETIC_FIXTURES.some(
      (f) => f.id === doc.fixtureId && canonicalContent(f.sections) === canonicalContent(doc.sections),
    );
  const cancel = () => {
    operation.current?.abort();
    operation.current = null;
    setBusy(false);
    setProgress(null);
    setLoadingClinic(false);
  };
  useEffect(() => {
    if ((busy || progress || loadingClinic) && section !== processingSection.current) cancel();
  }, [busy, progress, loadingClinic, section]);
  useEffect(() => { if (active) window.scrollTo(0, 0); }, [active, section, stage, doc?.id]);
  useEffect(() => {
    if (!active) {
      cancel();
      setSelectedStep(null);
    }
  }, [active]);
  useEffect(() => { if (demo) setProcessing(processingMode); }, [demo, processingMode]);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    fetchCapabilities({ signal: controller.signal }).then(result => {
      setDocumentLiveConfigured(result.documentAnalysisAllowed);
      setProviderLabel(result.provider === 'codex_cli' ? 'Codex CLI' : result.provider === 'openai' ? 'OpenAI API' : 'внешняя модель');
      setProcessing(result.documentAnalysisAllowed ? 'live' : 'local');
    }).catch(() => { if (!controller.signal.aborted) setDocumentLiveConfigured(false); });
    return () => controller.abort();
  }, [demo]);
  useEffect(() => {
    if (!doc) return;
    setEntries(previous => {
      const existing = previous.find(item => item.document.id === doc.id);
      const entry: LibraryEntry = {
        document: doc,
        title: existing?.title ?? SYNTHETIC_FIXTURES.find(item => item.id === doc.fixtureId)?.title ?? extraction?.name ?? 'Внешний документ',
        date: existing?.date ?? new Date().toISOString(),
        receivedAt: existing?.receivedAt,
        analysis, archived: existing?.archived ?? false,
      };
      return existing ? previous.map(item => item.document.id === doc.id ? entry : item) : [...previous, entry];
    });
  }, [doc, analysis, extraction]);
  useEffect(() => {
    if (!active || !demo || !scenario || scenarioToken.current === `${scenario.token}:${retryScenario}`) return;
    scenarioToken.current = `${scenario.token}:${retryScenario}`;
    cancel();
    setProcessing(scenario.processing);
    setClinicError('');
    if (scenario.kind === 'clinic') {
      const controller = new AbortController();
      operation.current = controller;
      processingSection.current = 'results';
      setLoadingClinic(true);
      setSection('results');
      loadClinicResults(scenario.fixtureId === 'clinic-episode' ? undefined : scenario.fixtureId, controller.signal).then(records => {
        if (controller.signal.aborted) return;
        // Re-opening a notification reuses the same source revision in this session.
        setEntries(previous => {
          const merged = previous.map(entry => {
            const record = records.find(record => sameDemoStudy(entry.document, record.document));
            return record ? { ...entry, document: mergeClinicStudy(entry.document, record.document), date: record.date, receivedAt: record.receivedAt, archived: scenario.openResult ? false : entry.archived } : entry;
          });
          const added = records.filter(record => !previous.some(entry => sameDemoStudy(entry.document, record.document)));
          return [...merged, ...added.map(record => ({ ...record, analysis: null, archived: false }))];
        });
        const record = records.find(record => latest.current && sameDemoStudy(latest.current, record.document));
        if (record && latest.current) { const merged = mergeClinicStudy(latest.current, record.document); latest.current = merged; setDoc(merged); }
        if (scenario.openResult && records.length === 1) {
          const record = records[0];
          const existing = entries.find(entry => sameDemoStudy(entry.document, record.document));
          const opened = existing ? mergeClinicStudy(existing.document, record.document) : record.document;
          setDoc(opened); latest.current = opened;
          setAnalysis(existing?.analysis ?? null);
          setExtraction(resources.current.get(opened.id) ?? null);
          setReviewView(initialReviewView()); setStage(4);
          setLoadingClinic(false); setSection('result-detail');
          event('result_opened', opened);
        }

      }).catch(error => {
        if (!controller.signal.aborted) setClinicError(error instanceof Error ? error.message : 'Не удалось получить результаты клиники.');
      }).finally(() => {
        if (operation.current === controller) { operation.current = null; setLoadingClinic(false); }
      });
    } else if (scenario.kind === 'file') {
      processingSection.current = 'new';
      setSection('new');
      setStage(0);
      const controller = new AbortController();
      operation.current = controller;
      setProgress({ stage: 'reading', current: 0, total: 1, percent: 0, label: 'Загружаем учебный PDF' });
      fetch(scenario.fixtureId === 'doctor-report' ? '/examples/synthetic-doctor-report.pdf' : '/examples/synthetic-chest-referral.pdf', { signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error('Учебный PDF недоступен. Повторите сценарий в демопанели.');
        const bytes = await response.arrayBuffer();
        if (!controller.signal.aborted) await loadFile(new File([bytes], scenario.fixtureId === 'doctor-report' ? 'Развёрнутый отчёт врача.pdf' : 'Учебный результат КТ.pdf', { type: 'application/pdf' }));
      }).catch(error => {
        if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : 'Не удалось загрузить PDF.'); setProgress(null); }
      });
    } else replaceDocument(getFixtureDocument(scenario.fixtureId), null);
  }, [active, demo, scenario, retryScenario]);
  useEffect(() => {
    const retained = resources.current;
    return () => { operation.current?.abort(); retained.forEach(disposeExtraction); retained.clear(); };
  }, []);
  function replaceDocument(next: DocumentRecord, result: ExtractedDocument | null) {
    const existing = demo ? entries.find(entry => sameDemoStudy(entry.document, next)) : undefined;
    if (existing) {
      // The PDF is another view of the same prepared study, not another clinical episode.
      next = existing.document;
      setEntries(values => values.map(entry => entry.document.id === next.id ? { ...entry, archived: false } : entry));
      setNotice('Это исследование уже есть в медкарте. Открыли его без создания копии.');
    }
    setActivePlanId(null);
    const priorResource = resources.current.get(next.id);
    if (result && priorResource && priorResource !== result) disposeExtraction(priorResource);
    if (result) resources.current.set(next.id, result);
    setReviewView(initialReviewView());
    setExtraction(result ?? priorResource ?? null);
    setDoc(next);
    latest.current = next;
    setAnalysis(existing?.analysis ?? null);
    setDrafts({});
    setSelectedStep(null);
    setStage(1);
    setSection('review');
    setError('');
  }
  function event(kind: Parameters<typeof publishDemoActivity>[0]['kind'], source = doc, extra: Partial<Parameters<typeof publishDemoActivity>[0]> = {}) {
    if (demo && source?.fixtureId && ['builtin_fixture', 'clinic_adapter'].includes(source.origin)) publishDemoActivity({ fixtureId: source.fixtureId, documentRevision: source.revision, contextRevision, analysisId: analysisIds[source.id], kind, ...extra });
  }
  function openEntry(id: string, review = false) {
    const entry = entries.find(item => item.document.id === id);
    if (!entry) return;
    cancel();
    setDoc(entry.document); latest.current = entry.document;
    setExtraction(resources.current.get(id) ?? null);
    setAnalysis(entry.analysis);
    setReviewView(initialReviewView());
    setStage(review || !isReadyForAnalysis(entry.document) ? 1 : 4);
    setSection(review || !isReadyForAnalysis(entry.document) ? 'review' : 'result-detail'); setError('');
    event('result_opened', entry.document);
    if (entry.analysis) event('explanation_viewed', entry.document);
  }
  function changeSelection(ids: string[]) {
    cancel(); setActivePlanId(null); setSelectedIds(ids); setContextRevision(value => value + 1); setSelectedStep(null); setRouteIds([]); setAdditionalSteps([]);
  }
  async function loadFile(file: File) {
    cancel();
    processingSection.current = currentSection.current;
    const controller = new AbortController();
    operation.current = controller;
    setError('');
    setStage(0);
    setProgress({ stage: 'validating', current: 0, total: 0, percent: 0, label: 'Проверяем файл' });
    try {
      const result = await extractDocument(file, {
        signal: controller.signal,
        onProgress: (value) => {
          if (!controller.signal.aborted) setProgress(value);
        },
      });
      if (controller.signal.aborted) {
        disposeExtraction(result);
        return;
      }
      const fixtureId = demo ? await detectSyntheticFixture(await file.arrayBuffer()) : null;
      if (controller.signal.aborted) {
        disposeExtraction(result);
        return;
      }
      const next = toDocument(result, fixtureId ? 'builtin_fixture' : 'local_file', fixtureId ?? undefined);
      replaceDocument(next, result);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Не удалось прочитать документ.');
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setProgress(null);
      }
    }
  }
  async function loadPhotos(pages: PhotoPageInput[]) {
    processingSection.current = currentSection.current;
    if (doc && !window.confirm('Заменить текущий документ и его правки выбранными фотографиями?')) return;
    cancel();
    const controller = new AbortController();
    operation.current = controller;
    setError('');
    setStage(0);
    setProgress({
      stage: 'validating',
      current: 0,
      total: pages.length,
      percent: 0,
      label: 'Проверяем фотографии',
    });
    try {
      const result = await extractPhotoPages(pages, {
        signal: controller.signal,
        onProgress: (value) => {
          if (!controller.signal.aborted) setProgress(value);
        },
      });
      if (controller.signal.aborted) {
        disposeExtraction(result);
        return;
      }
      const fixtureId =
        demo && pages.length === 1 ? await detectSyntheticFixture(await pages[0].file.arrayBuffer()) : null;
      if (controller.signal.aborted) {
        disposeExtraction(result);
        return;
      }
      replaceDocument(
        toDocument(result, fixtureId ? 'builtin_fixture' : 'local_file', fixtureId ?? undefined),
        result,
      );
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Не удалось прочитать фотографии.');
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setProgress(null);
      }
    }
  }
  function loadText(text: string) {
    if (doc && !window.confirm('Заменить текущий документ вставленным текстом?')) return;
    try {
      const result = extractText(text);
      cancel();
      replaceDocument(toDocument(result, 'paste'), result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Проверьте введённый текст.');
    }
  }

  function edit(sections: DocumentSections) {
    if (!doc) return;
    cancel();
    const next = updateDocumentSections(doc, sections);
    setDoc(next);
    latest.current = next;
    setAnalysis(null);
    setActivePlanId(null);
    setRouteIds([]);
    setAdditionalSteps([]);
    setContextRevision(value => value + 1);
    setDrafts({});
    setError('');
  }
  async function processDocument(source: DocumentRecord, signal: AbortSignal): Promise<Analysis> {
    const allowed = demo && ['builtin_fixture', 'clinic_adapter'].includes(source.origin) && SYNTHETIC_FIXTURES.some(item => item.id === source.fixtureId && canonicalContent(item.sections) === canonicalContent(source.sections));
    setCurrentProcessing(allowed || !demo ? processing : 'local');
    if (processing === 'live') {
      setProcessingStage('Удаляем персональные данные');
      if (allowed) { setProcessingStage('Анализируем учебный документ во внешней модели'); return analyzeDemo(source, { signal }); }
      if (!demo) return analyzeDocument(source, { signal, onProgress: phase => setProcessingStage(phase === 'anonymizing' ? 'Удаляем персональные данные' : phase === 'analyzing' ? `Анализируем медицинский текст · ${providerLabel}` : 'Проверяем ответ и связь с исходником') });
    }
    const result = processing === 'replay' && allowed ? getReplayAnalysis(source) : analyzeLocal(source);
    if (!result) throw new Error('Для этой редакции нет сохранённого результата. Выберите локальный разбор или внешний AI в демопанели.');
    return result;
  }
  async function buildRoute(sources: DocumentRecord[]) {
    if (busy || !sources.length) return;
    cancel();
    const controller = new AbortController(); operation.current = controller;
    processingSection.current = section;
    setBusy(true); setError(''); setNotice('');
    try {
      const results: Array<{ source: DocumentRecord; analysis: Analysis }> = [];
      for (const source of sources) {
        if (entries.some(entry => entry.document.id === source.id && entry.archived)) throw new Error('Сначала верните документ из архива в результаты.');
        if (!isReadyForAnalysis(source)) throw new Error('Сначала сверьте и подтвердите каждый выбранный документ.');
        const existing = entries.find(entry => entry.document.id === source.id && entry.analysis?.documentRevision === source.revision)?.analysis;
        const targetMode = processing === 'live' ? demo ? 'synthetic_live' : 'anonymized_live' : processing === 'replay' ? 'synthetic_replay' : 'personal_local';
        const result = existing?.mode === targetMode ? existing : await processDocument(source, controller.signal);
        if (controller.signal.aborted) return;
        results.push({ source, analysis: result });
      }
      setEntries(previous => previous.map(entry => {
        const result = results.find(item => item.source.id === entry.document.id && item.source.revision === entry.document.revision);
        return result ? { ...entry, analysis: result.analysis } : entry;
      }));
      const current = results.find(item => item.source.id === latest.current?.id && item.source.revision === latest.current?.revision);
      if (current) setAnalysis(current.analysis);
      const nextAnalysisIds = Object.fromEntries(sources.map(source => [source.id, analysisIds[source.id] ?? crypto.randomUUID()]));
      setAnalysisIds(previous => ({ ...previous, ...nextAnalysisIds }));
      if (routeIds.join('|') !== sources.map(source => source.id).join('|')) setAdditionalSteps([]);
      setRouteIds(sources.map(source => source.id));
      sources.forEach(source => event('route_viewed', source, { analysisId: nextAnalysisIds[source.id] }));
      const nextDocuments = results.map(result => ({ document: result.source, analysis: result.analysis, title: entries.find(entry => entry.document.id === result.source.id)?.title ?? extraction?.name ?? 'Медицинский документ' }));
      const existingPlan = matchingPlan(plans, nextDocuments);
      const nextPlan: PatientPlan = existingPlan ?? { id: crypto.randomUUID(), createdAt: new Date().toISOString(), completedAt: null, documents: nextDocuments, additionalSteps: [], deferredIds: [] };
      if (!existingPlan) setPlans(previous => [...previous, nextPlan]);
      setActivePlanId(nextPlan.id);
      setAdditionalSteps(nextPlan.additionalSteps);
      setDeferred(nextPlan.deferredIds);
      setStage(nextPlan.completedAt ? 3 : 2); setSection(nextPlan.completedAt ? 'plan-detail' : 'plan-edit');
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Не удалось обработать документ. Повторите действие.');
    } finally {
      if (operation.current === controller) { operation.current = null; setBusy(false); }
    }
  }
  function saveDocument() {
    if (!doc || busy) return;
    try {
      const confirmed = doc.origin === 'clinic_adapter' ? doc : confirmDocument(doc);
      setDoc(confirmed); latest.current = confirmed;
      setSection('results'); setSelectedIds([confirmed.id]); setError('');
      setNotice('Документ сохранён в медкарте. Когда будете готовы, выберите его и соберите маршрут.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Проверьте распознанный текст.'); }
  }
  function deleteDocument() {
    if (!deletingId || deleteWord.trim().toLocaleUpperCase('ru') !== 'УДАЛЕНИЕ') return;
    const id = deletingId;
    cancel();
    const retained = resources.current.get(id);
    if (retained) { disposeExtraction(retained); resources.current.delete(id); }
    setEntries(previous => previous.filter(entry => entry.document.id !== id));
    // Saved plans contain document snapshots; delete those too rather than retaining medical text.
    const removedPlans = plans.filter(plan => plan.documents.some(item => item.document.id === id)).map(plan => plan.id);
    setPlans(previous => previous.filter(plan => !removedPlans.includes(plan.id)));
    setFeedback(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(`${id}:`) && !removedPlans.some(planId => key === `plan:${planId}`))));
    removeBookings(bookings.filter(booking => booking.documentId === id || booking.sourceDocuments?.some(source => source.documentId === id)));
    setAnalysisIds(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== id)));
    setSelectedIds(previous => previous.filter(value => value !== id)); setRouteIds([]); setActivePlanId(null); setAdditionalSteps([]); setSelectedStep(null);
    if (doc?.id === id) { setDoc(null); latest.current = null; setExtraction(null); setAnalysis(null); }
    setDeletingId(null); setDeleteWord(''); setSection('results'); setError(''); setNotice('Документ и связанные планы удалены из этой сессии. Исходный файл на вашем устройстве не изменён.');
  }
  async function confirm() {
    if (!doc || busy) return;
    try {
      const confirmed = doc.origin === 'clinic_adapter' ? doc : confirmDocument(doc);
      setDoc(confirmed); latest.current = confirmed;
      await buildRoute([confirmed]);
    } catch (error) { setError(error instanceof Error ? error.message : 'Проверьте распознанный текст.'); }
  }
  const activePlan = plans.find(plan => plan.id === activePlanId);
  const routeEntries = entries.filter(entry => routeIds.includes(entry.document.id) && entry.analysis?.documentRevision === entry.document.revision).map(entry => {
    const snapshot = activePlan?.documents.find(item => item.document.id === entry.document.id && item.document.revision === entry.document.revision);
    return snapshot ? { ...entry, analysis: snapshot.analysis } : entry;
  });
  const routeDocuments = routeEntries.map(entry => ({ document: entry.document, title: entry.title, analysis: entry.analysis! }));
  const visits = mergePlanVisits(routeDocuments, additionalSteps);
  const selectedVisit = selectedStep ? visits.find(visit => visit.step.id === selectedStep.id) : undefined;
  useEffect(() => {
    // Selection/review state must never overwrite a saved draft while outside its editor.
    if (!activePlanId || section !== 'plan-edit') return;
    setPlans(previous => previous.map(plan => plan.id === activePlanId && !plan.completedAt ? { ...plan, additionalSteps, deferredIds: deferred } : plan));
  }, [activePlanId, additionalSteps, deferred, section]);
  function visitEvent(kind: 'doctor_picker_opened' | 'recommendation_deferred', step: RouteStep) {
    const visit = visits.find(item => item.step.id === step.id);
    visit?.sources.forEach(binding => event(kind, routeEntries.find(entry => entry.document.id === binding.documentId)?.document, { stepId: binding.stepId }));
  }
  function rate(key: string, value: PlanFeedbackValue, sources = routeDocuments.map(item => item.document)) {
    setFeedback(previous => ({ ...previous, [key]: value }));
    for (const source of sources) event('patient_feedback_changed', source, { value });
  }
  function book(slotId: string) {
    const source = selectedVisit && routeEntries.find(entry => entry.document.id === selectedVisit.sources[0].documentId)?.document;
    if (!demo || !source || !selectedStep?.specialtyId || !selectedStep.bookingAllowed || !selectedVisit || !selectedVisit.sources.every(binding => routeEntries.some(entry => entry.document.id === binding.documentId && entry.document.revision === binding.revision && isReadyForAnalysis(entry.document) && ['builtin_fixture', 'clinic_adapter'].includes(entry.document.origin)))) throw new Error('Маршрут изменился. Проверьте текущие документы заново.');
    if (overlappingVisitBookings(selectedVisit, bookingRef.current).length) throw new Error('По этому шагу уже есть запись. Сначала отмените её, чтобы запланировать общий приём.');
    const booking = createBooking(bookingRef.current, { key: selectedStep.id, documentId: source.id, revision: source.revision, stepId: selectedStep.id, specialtyId: selectedStep.specialtyId, slotId, mode: routeEntries.find(entry => entry.document.id === source.id)!.analysis!.mode, sourceDocuments: selectedVisit.sources }, catalog);
    const next = bookingRef.current.some(item => item.id === booking.id) ? bookingRef.current : [...bookingRef.current, booking];
    bookingRef.current = next; setBookings(next);
    setDeferred(values => values.filter(id => id !== selectedStep.id));
    selectedVisit.sources.forEach(binding => event('booking_confirmed', routeEntries.find(entry => entry.document.id === binding.documentId)!.document, { stepId: binding.stepId, bookingId: booking.id }));
    setSelectedStep(null); setStage(2); setSection('plan-edit');
  }
  function removeBookings(removed: Booking[]) {
    const ids = new Set(removed.map(booking => booking.id));
    for (const booking of removed) {
      const bindings = booking.sourceDocuments ?? [{ documentId: booking.documentId, revision: booking.revision, stepId: booking.stepId }];
      for (const binding of bindings) {
        const source = entries.find(entry => entry.document.id === binding.documentId)?.document;
        // Cancelling an existing demo booking remains valid after its source was edited locally.
        if (demo && source?.fixtureId) publishDemoActivity({ kind: 'booking_cancelled', fixtureId: source.fixtureId, documentRevision: binding.revision, stepId: binding.stepId, bookingId: booking.id, contextRevision });
      }
    }
    const next = bookingRef.current.filter(booking => !ids.has(booking.id));
    bookingRef.current = next; setBookings(next);
    setDrafts({});
    // Return cancelled recommendations to planning, including completed plans.
    setPlans(previous => previous.map(plan => {
      const affected = mergePlanVisits(plan.documents, plan.additionalSteps).filter(visit => overlappingVisitBookings(visit, removed).length);
      return affected.length ? { ...plan, completedAt: null, deferredIds: [...new Set([...plan.deferredIds, ...affected.map(visit => visit.step.id)])] } : plan;
    }));
  }
  function confirmCancelBooking() {
    if (!cancelBooking) return;
    removeBookings([cancelBooking]);
    setCancelBooking(null);
    if (section === 'plan-detail' && activePlan) editPlan({ ...activePlan, completedAt: null });
    setNotice('Запись отменена в этой сессии. Теперь можно выбрать другое время. Если вы уже импортировали событие в календарь, удалите его там отдельно.');
  }
  function removePlan() {
    const plan = plans.find(item => item.id === deletePlanId);
    if (!plan) return;
    if (cancelPlanBookings) removeBookings(bookingsForPlan(plan, bookings));
    setPlans(previous => previous.filter(item => item.id !== plan.id));
    setFeedback(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== `plan:${plan.id}`)));
    if (activePlanId === plan.id) { setActivePlanId(null); setRouteIds([]); setAdditionalSteps([]); setDeferred([]); }
    setDeletePlanId(null); setSection('plans'); setNotice(cancelPlanBookings ? 'План удалён, связанные записи отменены. Исследования остались в медкарте.' : 'План удалён. Исследования и подтверждённые записи сохранены.');
  }
  function openPlan(plan: PatientPlan) {
    cancel(); setActivePlanId(plan.id); setError('');
    if (plan.completedAt) { setSection('plan-detail'); return; }
    editPlan(plan);
  }
  function editPlan(plan: PatientPlan) {
    cancel();
    if (plan.documents.some(item => entries.some(entry => entry.document.id === item.document.id && entry.archived))) { setSection('archive'); setError('Верните документ из архива в результаты, чтобы продолжить планирование.'); return; }
    if (plan.documents.some(item => !entries.some(entry => entry.document.id === item.document.id && entry.document.revision === item.document.revision && entry.analysis))) { setSection('results'); setError('Документ изменён. Выберите актуальные результаты и соберите новый маршрут; прежний план сохранён как история.'); return; }
    setActivePlanId(plan.id); setRouteIds(plan.documents.map(item => item.document.id)); setSelectedIds(plan.documents.map(item => item.document.id));
    setAdditionalSteps(plan.additionalSteps); setDeferred(plan.deferredIds);
    setPlans(previous => previous.map(item => item.id === plan.id ? { ...item, completedAt: null } : item));
    setStage(2); setSection('plan-edit'); setError('');
  }
  function finishPlan() {
    if (!activePlan) return;
    const pending = visits.filter(visit => visit.step.bookingAllowed && !findVisitBooking(visit, bookings));
    const nextDeferred = [...new Set([...deferred, ...pending.map(visit => visit.step.id)])];
    setDeferred(nextDeferred);
    setPlans(previous => previous.map(plan => plan.id === activePlan.id ? { ...plan, documents: routeDocuments, additionalSteps, deferredIds: nextDeferred, completedAt: new Date().toISOString() } : plan));
    pending.forEach(visit => visit.sources.forEach(binding => event('recommendation_deferred', routeEntries.find(entry => entry.document.id === binding.documentId)!.document, { stepId: binding.stepId })));
    setStage(3); setSection('plan-detail'); setSelectedStep(null);
  }
  function resumeDeferred(step: RouteStep) {
    const plan = plans.find(plan => mergePlanVisits(plan.documents, plan.additionalSteps).some(visit => visit.step.id === step.id));
    if (plan) editPlan(plan);
  }
  const showBookings = section === 'bookings';
  const showRoute = section === 'plan-edit' && routeEntries.length > 0;
  const showLibrary = section === 'results' || section === 'archive';
  const showSummary = section === 'plan-detail' && activePlan?.completedAt;
  const detail = section === 'result-detail' ? entries.find(item => item.document.id === doc?.id) : undefined;
  const deferredSteps = plans.flatMap(plan => mergePlanVisits(plan.documents, plan.additionalSteps).filter(visit => plan.deferredIds.includes(visit.step.id) && !findVisitBooking(visit, bookings)).map(visit => visit.step)).filter((step, index, all) => all.findIndex(item => item.id === step.id) === index);
  useEffect(() => {
    // The picker opener leaves the DOM when a successful booking replaces the route.
    if (active && showBookings) bookingResultHeading.current?.focus();
  }, [active, showBookings]);
  if (!active) return null;
  return (
    <>
      <div className={`route-layout ${showLibrary || detail || section === 'plans' ? 'library-layout' : ''}`}>
        {!showLibrary && !detail && section !== 'plans' && <Stepper current={showSummary || showBookings ? 3 : showRoute ? 2 : section === 'review' ? 1 : 0} completed={!!showSummary} />}
        <div className="stack">
          {notice && <Notice>{notice}<Button variant="quiet" onClick={() => setNotice('')}>Понятно</Button></Notice>}
          {busy && <ProcessingStatus live={currentProcessing === 'live'} stage={currentProcessing === 'live' ? processingStage || 'Удаляем персональные данные' : 'Проверяем текст и основания маршрута'} detail={currentProcessing === 'live' ? 'Очищенный текст обрабатывается сервером. Ответ ещё не готов и будет проверен перед показом.' : currentProcessing === 'replay' ? 'Открываем сохранённый учебный результат без нового вызова модели.' : 'Обработка в браузере, без внешнего AI.'} onCancel={cancel} />}
          {error && (showLibrary || detail || showRoute || section === 'plans') && <Notice tone="error"><p>{error}</p><p className="small">Документы сохранены. Повторите «Собрать маршрут» или измените режим в демопанели.</p></Notice>}
          {section === 'plans' ? <PlansList plans={plans} bookings={bookings} onOpen={openPlan} onDelete={plan => { setDeletePlanId(plan.id); setCancelPlanBookings(false); }} onCreate={() => { setStage(0); setSection('new'); }} /> : showSummary && activePlan ? <PlanSummary key={activePlan.id} plan={activePlan} bookings={bookings} revisions={Object.fromEntries(entries.map(entry => [entry.document.id, entry.document.revision]))} onEdit={() => editPlan(activePlan)} onCancelBooking={setCancelBooking} onDelete={() => { setDeletePlanId(activePlan.id); setCancelPlanBookings(false); }} feedback={feedback[`plan:${activePlan.id}`] ?? null} onFeedback={value => rate(`plan:${activePlan.id}`, value, activePlan.documents.map(item => item.document))} /> : showLibrary ? <>
            {loadingClinic && <Notice>Получаем результаты · проверяем пациента, источник и версию…</Notice>}
            {clinicError && <Notice tone="error"><p>{clinicError}</p><Button variant="secondary" onClick={() => setRetryScenario(value => value + 1)}>Повторить загрузку результатов</Button></Notice>}
            <ResultsLibrary busy={busy} entries={entries} archived={section === 'archive'} selectedIds={selectedIds}
              onSelection={changeSelection} onOpen={openEntry}
              onUpload={() => { cancel(); setStage(0); setSection('new'); }}
              onBuild={() => buildRoute(entries.filter(entry => selectedIds.includes(entry.document.id) && !entry.archived).map(entry => entry.document))}
              onArchive={(id, archived) => { cancel(); setActivePlanId(null); setAdditionalSteps([]); setEntries(values => values.map(entry => entry.document.id === id ? { ...entry, archived } : entry)); setSelectedIds(values => values.filter(value => value !== id)); setRouteIds(values => values.filter(value => value !== id)); setContextRevision(value => value + 1); }} />
          </> : detail ? <>
            <ResultDetails key={`${detail.document.id}:${detail.document.revision}`} entry={detail} initialSourcePage={reviewView.tab === 'original' ? reviewView.page + 1 : undefined} extraction={resources.current.get(detail.document.id) ?? null} busy={busy} onDelete={() => { setDeletingId(detail.document.id); setDeleteWord(''); }} onBuild={() => buildRoute([detail.document])} onReview={() => openEntry(detail.document.id, true)} onBack={() => setSection(detail.archived ? 'archive' : 'results')}
              feedback={feedback[`${detail.document.id}:${detail.document.revision}`] ?? activities.find(item => item.kind === 'patient_feedback_changed' && item.fixtureId === detail.document.fixtureId && item.documentRevision === detail.document.revision && item.contextRevision === contextRevision && item.analysisId === analysisIds[detail.document.id])?.value}
              onFeedback={value => rate(`${detail.document.id}:${detail.document.revision}`, value, [detail.document])} />
            {demo && ['builtin_fixture', 'clinic_adapter'].includes(detail.document.origin) && <PrivacyPreview sections={detail.document.sections} />}
          </> : showBookings ? (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2 ref={bookingResultHeading} tabIndex={-1}>Записи и календарь</h2>
                  <p className="small muted">{demo ? 'Демонстрационные записи текущей сессии' : 'Ваши записи на приём'}</p>
                </div>
              </div>
              {bookings.length || deferredSteps.length ? (
                <div className="stack">
                  {deferredSteps.map(step => <article className="deferred-card" key={step.id}><strong>{step.title}</strong><p className="small muted">Выбор врача отложен · запись не создана</p><Button variant="secondary" onClick={() => resumeDeferred(step)}>Вернуться к планированию</Button></article>)}
                  <BookingDays bookings={bookings} revisions={Object.fromEntries(entries.map(entry => [entry.document.id, entry.document.revision]))} onCancel={setCancelBooking} />
                  {bookings.length > 0 && <Button onClick={() => downloadPlanCalendar(bookings)}>Скачать все события календаря</Button>}
                </div>
              ) : (
                <div className="empty-state">
                  <CalendarDays size={36} />
                  <h3>{routeEntries.length ? 'План просмотрен' : demo ? 'Здесь появятся ваши демозаписи' : 'Записей пока нет'}</h3>
                  <p className="muted">{routeEntries.length ? 'В выбранных документах нет подтверждённых записей или отложенных направлений. Результаты сохранены в медкарте.' : demo ? 'Сначала подтвердите документ, затем выберите врача и время.' : 'Онлайн-запись в клиники пока не подключена. Вы можете подготовить маршрут по своему документу.'}</p>
                  <Button onClick={() => { setSection(routeEntries.length ? 'results' : 'new'); if (!routeEntries.length) setStage(0); }}>{routeEntries.length ? 'К результатам' : 'Создать маршрут'}</Button>
                </div>
              )}
            </section>
          ) : showRoute ? (<>
            <RouteView analysis={routeEntries[0].analysis!}
              documents={routeEntries.map(entry => ({ ...entry, analysis: entry.analysis! }))}
              bookings={bookings} deferredIds={deferred} additionalSteps={additionalSteps}
              bookingAvailable={demo} onCancelBooking={setCancelBooking}
              onBook={step => {
                const visit = visits.find(item => item.step.id === step.id);
                if (!visit || overlappingVisitBookings(visit, bookingRef.current).length) { setError('По этому шагу уже есть запись. Сначала отмените её, чтобы запланировать общий приём.'); return; }
                setSelectedStep(step); visitEvent('doctor_picker_opened', step);
              }}
              onDefer={step => { setDeferred(values => values.includes(step.id) ? values.filter(id => id !== step.id) : [...values, step.id]); visitEvent('recommendation_deferred', step); }}
              onSourceDocument={(id, anchor) => {
                const entry = entries.find(item => item.document.id === id);
                if (!entry) return;
                openEntry(id);
                const resource = resources.current.get(id);
                const index = resource?.blocks.findIndex(block => block.id === anchor.blockId || (!!anchor.page && block.pageNumber === anchor.page)) ?? entry.document.blocks.findIndex(block => block.id === anchor.blockId);
                if (index >= 0) setReviewView(value => ({ ...value, tab: 'original', page: index }));
              }}
              onEditDocument={id => openEntry(id)}
              onAddVisit={demo && ['builtin_fixture', 'clinic_adapter'].includes(routeEntries[0].document.origin) ? () => setAddVisit(true) : undefined}
              onFinish={finishPlan} />
            <PlanFeedback value={feedback[`plan:${activePlanId}`] ?? null} onChange={value => rate(`plan:${activePlanId}`, value)} />
          </>) : doc && section === 'review' ? (<>
            {!demo && <section className="panel work-processing-choice"><label>Обработка документа<StyledSelect aria-label="Обработка документа" value={processing} disabled={busy} onChange={event => setProcessing(event.target.value)}><option value="live">AI-разбор после обезличивания</option><option value="local">Локальный разбор без внешней модели</option></StyledSelect></label><p className="small muted">{processing === 'live' ? `${providerLabel}: перед отправкой текст очищается в браузере и повторно на сервере. Это не гарантия полной анонимности.` : 'Внешняя модель не вызывается. Работают только локальные правила для явных направлений.'}</p>{!documentLiveConfigured && <p className="small muted">AI для загруженных документов в этом окружении не подключён. Локальный разбор доступен.</p>}</section>}
            {demo && !liveAllowed && <Notice>Это ваш внешний документ в демосессии. Для него доступен локальный разбор без AI. Чтобы отправить очищенную копию в настроенную модель, откройте рабочий режим и загрузите документ там.</Notice>}
            <ReviewView
              showProcessingControl={false}
              view={reviewView}
              onViewChange={setReviewView}
              document={doc}
              extraction={extraction}
              busy={busy}
              onEdit={edit}
              onConfirm={confirm}
              onSave={saveDocument}
              onBack={() => {
                cancel();
                setStage(0);
                setSection('new');
              }}
              onResolveUnread={() => {
                const next = {
                  ...doc,
                  revision: doc.revision + 1,
                  unreadPages: [],
                  extractionStatus: 'ready' as const,
                  confirmedRevision: null,
                  confirmedAt: null,
                };
                setDoc(next);
                latest.current = next;
                setAnalysis(null);
                setDrafts({});
              }}
              processing={processing}
              setProcessing={setProcessing}
              liveAllowed={liveAllowed}
              personalLiveAllowed={!demo && documentLiveConfigured}

              error={error}
              onCancel={cancel}
            />
            {!demo && processing === 'live' && <PrivacyPreview sections={doc.sections} kind="document" />}
          </>) : (
            <>
              {section !== 'new' && (
                <Notice>
                  В этой сессии ещё нет подтверждённого маршрута. Начните с документа или учебного примера.
                </Notice>
              )}
              <IntakeView
                onPhotos={loadPhotos}
                onFile={loadFile}
                onText={loadText}
                progress={progress}
                error={error}
                onCancel={cancel}
                hasDocument={!!doc}
                onResume={() => {
                  setStage(1);
                  setSection('review');
                }}
              />
            </>
          )}
        </div>
      </div>
      {cancelBooking && <Dialog title="Отменить запись?" onClose={() => setCancelBooking(null)} footer={<div className="button-row"><Button variant="secondary" onClick={() => setCancelBooking(null)}>Сохранить запись</Button><Button onClick={confirmCancelBooking}>Да, отменить запись</Button></div>}><div className="stack"><p><strong>{cancelBooking.doctor.name}</strong><br />{dateLabel(cancelBooking.slot.start)}, {timeLabel(cancelBooking.slot.start)} мск</p><p>Слот освободится, и вы сможете выбрать другое время. Если приём объединяет несколько исследований, отмена относится ко всем ним. Клиника не получает уведомление: это демонстрационная запись.</p></div></Dialog>}
      {deletePlanId && <Dialog title="Удалить план?" onClose={() => setDeletePlanId(null)} footer={<div className="button-row"><Button variant="secondary" onClick={() => setDeletePlanId(null)}>Оставить план</Button><Button onClick={removePlan}>Удалить план</Button></div>}><div className="stack"><p>Исследования останутся в медкарте. Позже можно собрать новый маршрут по тем же документам.</p>{bookingsForPlan(plans.find(plan => plan.id === deletePlanId)!, bookings).length > 0 && <label className="checkbox-label"><input type="checkbox" checked={cancelPlanBookings} onChange={event => setCancelPlanBookings(event.target.checked)} />Также отменить связанные записи</label>}<p className="small muted">Без этого выбора записи сохранятся в разделе «Записи и календарь». Общая запись может учитываться в нескольких планах. События, уже импортированные в календарь, нужно удалить отдельно.</p></div></Dialog>}
      {deletingId && <Dialog title="Удалить документ?" eyebrow="Удаление из текущей сессии" onClose={() => setDeletingId(null)} footer={<div className="button-row"><Button variant="secondary" onClick={() => setDeletingId(null)}>Отмена</Button><Button disabled={deleteWord.trim().toLocaleUpperCase('ru') !== 'УДАЛЕНИЕ'} onClick={deleteDocument}>Удалить документ</Button></div>}>
        <div className="stack"><p className="document-delete-title">{entries.find(entry => entry.document.id === deletingId)?.title}</p><p>Документ, пояснения, планы с этим документом и связанные демозаписи будут удалены из этой вкладки. Остальные документы сохранятся. Файл на устройстве останется на месте.</p><label>Введите слово УДАЛЕНИЕ<input autoComplete="off" value={deleteWord} onChange={event => setDeleteWord(event.target.value)} /></label></div>
      </Dialog>}
      {addVisit && <Dialog title="Приём по вашему выбору" eyebrow="Дополнительная консультация" onClose={() => setAddVisit(false)}><div className="stack">
        <p>Вы можете добавить приём самостоятельно. Это не рекомендация приложения и не направление из документа.</p>
        <label>Специальность<StyledSelect aria-label="Специальность" value={additionalSpecialty} onChange={event => setAdditionalSpecialty(event.target.value as SpecialtyId)}>{[...new Map(catalog.doctors.map(doctor => [doctor.specialtyId, doctor.specialty])).entries()].map(([id, title]) => <option key={id} value={id}>{title}</option>)}</StyledSelect></label>
        <Button onClick={() => {
          const doctor = catalog.doctors.find(item => item.specialtyId === additionalSpecialty)!;
          setAdditionalSteps(values => [...values, { id: `manual:${crypto.randomUUID()}`, actionId: 'patient-choice', specialtyId: additionalSpecialty, basis: 'demo_only', title: doctor.specialty, explanation: 'Консультация добавлена по вашему выбору. Медицинского направления в выбранных документах для этого шага нет.', sourceRefs: [], dueText: 'По вашему выбору', dueAt: null, bookingAllowed: true }]);
          setAddVisit(false);
        }}>Добавить в план</Button>
      </div></Dialog>}
      {selectedStep && (
        <DoctorPicker
          step={selectedStep}
          catalog={catalog}
          bookings={bookings}
          draft={drafts[selectedStep.id] ?? blankDraft()}
          setDraft={(draft) => setDrafts((d) => ({ ...d, [selectedStep.id]: draft }))}
          onConfirm={book}
          onClose={() => setSelectedStep(null)}
        />
      )}
    </>
  );
}
