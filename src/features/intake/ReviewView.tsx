import { StyledSelect } from '../../ui/Select';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, FileCheck2, FileText, Info, Maximize2, Minus, Plus, Save, ShieldCheck } from 'lucide-react';
import type { DocumentRecord, DocumentSections, SectionKind } from '../../domain';
import { SYNTHETIC_FIXTURES } from '../../domain';
import { canonicalContent } from '../../privacy/policy';
import type { ExtractedDocument } from './types';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Notice } from '../../ui/Status';
import { PrivacyPreview } from './PrivacyPreview';
import { reviewContextFields, type ReviewContextField } from './sections';
import { StudySource, StudyPrivacyNote } from '../patient/StudySource';
import './Intake.css';

export interface ReviewViewState { tab: string; page: number; zoom: number; scroll: Record<number, number> }
export const initialReviewView = (): ReviewViewState => ({ tab: 'text', page: 0, zoom: 1, scroll: {} });
const labels: Record<SectionKind, string> = { description: 'Описание', conclusion: 'Заключение', recommendations: 'Рекомендации', other: 'Другой контекст' };
export function ReviewView({ document, extraction, busy, onEdit, onConfirm, onSave, onBack, onResolveUnread, processing, setProcessing, liveAllowed, personalLiveAllowed = false, error, onCancel, view, onViewChange, showProcessingControl = true }: {
  showProcessingControl?: boolean;
  document: DocumentRecord;
  extraction: ExtractedDocument | null;
  busy: boolean;
  onEdit: (sections: DocumentSections) => void;
  onConfirm: () => void;
  onSave?: () => void;
  onBack: () => void;
  onResolveUnread: () => void;
  processing: string;
  setProcessing: (value: string) => void;
  liveAllowed: boolean;
  personalLiveAllowed?: boolean;
  error: string;
  onCancel: () => void;
  view?: ReviewViewState;
  onViewChange?: (view: ReviewViewState) => void;
}) {
  const [localView, setLocalView] = useState(initialReviewView);
  const currentView = view ?? localView;
  const { tab, page, zoom } = currentView;
  const setView = onViewChange ?? setLocalView;
  const setTab = (tab: string) => setView({ ...currentView, tab });
  const setPage = (fn: (page: number) => number) => setView({ ...currentView, page: fn(page) });
  const setZoom = (fn: (zoom: number) => number) => setView({ ...currentView, zoom: fn(zoom) });
  const viewport = useRef<HTMLDivElement>(null);
  const tabId = useId();
  useLayoutEffect(() => { if (viewport.current) viewport.current.scrollTop = currentView.scroll[page] ?? 0; }, [page, tab]);
  const [resolved, setResolved] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const pages = extraction?.blocks.length ? extraction.blocks : document.blocks.map(block => ({ id: block.id, originalText: block.text, previewUrl: undefined, pageNumber: block.page }));
  const current = pages[Math.min(page, pages.length - 1)];
  const clinicSource = document.origin === 'clinic_adapter';
  const structuredSource = !extraction && (clinicSource || Boolean(document.fixtureId));
  const structuredClinic = clinicSource && structuredSource;
  const hasImagePreview = pages.some(item => item.previewUrl);
  const changedFixture = document.origin === 'builtin_fixture' && !SYNTHETIC_FIXTURES.some(fixture => fixture.id === document.fixtureId && canonicalContent(fixture.sections) === canonicalContent(document.sections));
  const originalKinds = (Object.keys(labels) as SectionKind[]).filter(kind => document.originalSections[kind].trim());
  const unclassifiedOnly = !originalKinds.some(kind => kind !== 'other');
  const shownKinds = originalKinds.length ? originalKinds : ['other'] as SectionKind[];
  const contextFields = reviewContextFields(document.sections.other);
  const originalContextFields = reviewContextFields(document.originalSections.other);
  const documentTitle = extraction?.name ?? SYNTHETIC_FIXTURES.find(fixture => fixture.id === document.fixtureId)?.title ?? 'Медицинский документ';
  function field(kind: SectionKind, context?: ReviewContextField, index = 0) {
    const sourceContext = context && extraction?.sections.filter(part => part.heading === context.heading)[0];
    const anchorIndex = pages.findIndex(item => (sourceContext?.anchors ?? document.sectionAnchors[kind])?.includes(item.id));
    const anchorPage = anchorIndex >= 0 ? pages[anchorIndex].pageNumber : undefined;
    const changed = context ? context.text !== originalContextFields[index]?.text : document.sections[kind] !== document.originalSections[kind];
    const label = context?.heading ?? (kind === 'other' && unclassifiedOnly ? 'Текст документа' : labels[kind]);
    const fieldId = `${tabId}-${kind}-${index}`;
    return <div className={`review-field${kind === 'recommendations' ? ' review-recommendations-field' : ''}${context ? ' review-context-field' : ''}`} key={fieldId}>
      <div className="review-field-heading"><label htmlFor={fieldId}>{label}</label>{!structuredSource && anchorIndex >= 0 && <button type="button" className="review-source-link" onClick={() => setView({ ...currentView, tab: 'original', page: anchorIndex })} aria-label={`Показать исходный раздел «${label}»`}>{anchorPage ? `стр. ${anchorPage}` : 'В исходнике'}<ArrowUpRight size={14} /></button>}</div>
      <textarea id={fieldId} aria-label={label} value={context?.text ?? document.sections[kind]} disabled={busy} rows={context ? Math.min(6, Math.max(2, context.text.split('\n').length)) : unclassifiedOnly ? 16 : kind === 'description' ? 8 : 5}
        onChange={event => { setResolved(false); const value = context ? document.sections[kind].slice(0, context.start) + event.target.value + document.sections[kind].slice(context.end) : event.target.value; onEdit({ ...document.sections, [kind]: value }); }} />
      <p className="review-field-note">{changed ? 'Исправлено вами · исходный текст сохранён' : structuredSource ? 'Поле подготовленного исследования' : 'Сравните с исходным документом'}</p>
    </div>;
  }
  function viewerTools() {
    return <div className="review-viewer-tools">
      {hasImagePreview ? <div className="review-tool-group"><button type="button" className="icon-button" aria-label="Предыдущая страница" disabled={page === 0} onClick={() => setPage(value => value - 1)}><ChevronLeft size={18} /></button><span>Страница {current?.pageNumber ?? page + 1} / {pages.length}</span><button type="button" className="icon-button" aria-label="Следующая страница" disabled={page >= pages.length - 1} onClick={() => setPage(value => value + 1)}><ChevronRight size={18} /></button></div> : <span className="review-source-caption">Полный исходный текст</span>}
      <div className="review-tool-group"><button type="button" className="icon-button" aria-label="Уменьшить оригинал" disabled={zoom <= 1} onClick={() => setZoom(value => value - 0.25)}><Minus size={18} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" className="icon-button" aria-label="Увеличить оригинал" disabled={zoom >= 4} onClick={() => setZoom(value => value + 0.25)}><Plus size={18} /></button><Button variant="quiet" onClick={() => setZoom(() => 1)}>По ширине</Button></div>
    </div>;
  }
  function original() {
    return current?.previewUrl ? <img src={current.previewUrl} alt={`Оригинал, страница ${current.pageNumber ?? page + 1}`} style={{ width: `${zoom * 100}%` }} /> : <div className="review-text-original"><FileText size={24} /><p className="review-text-original-label">Исходный текст документа</p><pre style={{ fontSize: `${zoom * 16}px` }}>{pages.map(item => item.originalText).join('\n\n') || 'Нет доступного исходного текста'}</pre></div>;
  }
  return <section className="review-workspace" aria-label="Проверка документа">
    <header className="review-page-heading"><div><h2>{structuredClinic ? 'Данные исследования' : structuredSource ? 'Проверьте текст исследования' : 'Проверьте распознанный текст'}</h2><p>{structuredClinic ? 'Готовые поля из системы клиники. Повторное распознавание не требуется.' : structuredSource ? 'Подготовленный учебный текст. Все разделы показаны вместе; исходные значения сохранены.' : 'Сверьте текст с оригиналом и исправьте неточности.'}</p></div>{document.revision > 1 && <span className="review-revision"><FileText size={17} />Редакция {document.revision}</span>}</header>
    <div className="review-notices">
      {structuredClinic && <Notice><ShieldCheck size={18} /><p>Принадлежность учебному пациенту, источник и версия проверены. Правка создаст новую редакцию для локальной сверки.</p></Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {changedFixture && <Notice tone="warning">Текст отличается от разрешённого учебного примера. Правки будут обработаны только локально и не передадутся внешней модели.</Notice>}
      {extraction?.warnings.map(warning => <Notice tone="warning" key={warning}>{warning}</Notice>)}
      {unclassifiedOnly ? <Notice>{contextFields.length ? 'Сведения об исследовании выделены автоматически. Отдельные медицинские разделы не найдены; весь доступный текст сохранён ниже. Сверьте его с оригиналом.' : 'Разделы не удалось выделить автоматически. Весь доступный текст показан ниже. Не нужно распределять текст по разделам вручную — достаточно сверить его с оригиналом и исправить ошибки распознавания.'}</Notice> : document.missingSections.length > 0 && <Notice>Автоматически не выделены разделы: {document.missingSections.map(kind => labels[kind]).join(', ')}. Подтвердите доступный текст; дописывать отсутствующие сведения не требуется.</Notice>}
    </div>
    {!structuredSource && <div className="review-mobile-tabs" role="tablist" aria-label="Сверка документа">
      <button id={`${tabId}-original-tab`} role="tab" aria-selected={tab === 'original'} aria-controls={`${tabId}-original`} onClick={() => setTab('original')}>Оригинал</button>
      <button id={`${tabId}-text-tab`} role="tab" aria-selected={tab === 'text'} aria-controls={`${tabId}-text`} onClick={() => setTab('text')}>{structuredClinic ? 'Текст результата' : 'Распознанный текст'}</button>
    </div>}
    <div className={`review-document-grid${structuredSource ? ' is-structured' : ''}`} data-tab={structuredSource ? 'text' : tab}>
      {!structuredSource && <section className="panel review-original-pane" id={`${tabId}-original`} aria-label="Оригинал документа">
        <header className="review-pane-heading"><div><h3>Оригинал документа</h3><p>{documentTitle}</p></div>{document.fixtureId && <span className="review-source-tag">Учебный документ</span>}</header>
        <Button className="review-expand-control" variant="secondary" onClick={() => { setZoom(() => 1); setExpanded(true); }}><Maximize2 size={17} />Развернуть оригинал</Button>
        {viewerTools()}
        <div className="review-original-viewport" ref={viewport} onScroll={event => setView({ ...currentView, scroll: { ...currentView.scroll, [page]: event.currentTarget.scrollTop } })}>
          {original()}
        </div>
      </section>}
      <section className="panel review-fields-pane" id={`${tabId}-text`} aria-label={structuredSource ? 'Текст результата' : 'Распознанные разделы'}>
        <header className="review-pane-heading"><div><h3>{structuredSource ? document.studyMetadata?.studyName ?? documentTitle : 'Распознанный текст'}</h3><p>{structuredSource ? 'Разделы готового исследования' : unclassifiedOnly ? 'Полный текст без автоматического распределения' : 'Разделы выделены автоматически — проверьте текст'}</p></div><Info size={19} /></header>
        <div className="review-found-fields">{shownKinds.filter(kind => kind !== 'other').map(kind => field(kind))}{shownKinds.includes('other') && (contextFields.length ? <section className="review-context-fields" aria-label="Сведения из документа"><h4>Сведения из документа</h4><p>Место, дата и другие поля из исходника. Медицинские разделы показаны отдельно.</p>{contextFields.map((context, index) => field('other', context, index))}</section> : field('other'))}</div>
        <div className="review-check-note"><FileCheck2 size={21} /><p>{structuredClinic ? 'Правки сохраняются отдельно от исходного результата и потребуют повторной сверки.' : 'Проверьте числа, единицы измерения и отрицания. Любая правка потребует нового подтверждения.'}</p></div>
        {structuredSource && <details className="review-preserved-fields"><summary>Исходные поля до правок</summary><StudySource document={document} original showSummary={false} /></details>}
      </section>
    </div>
    {(document.extractionStatus !== 'ready' || document.unreadPages.length > 0) && <Notice tone="warning"><p>Не прочитаны части документа: {document.unreadPages.length ? document.unreadPages.map(item => `страница ${item}`).join(', ') : extraction?.unreadAnchors.join(', ')}. Внесите их полный текст из оригинала в нужные разделы или загрузите чёткую копию.</p><label className="review-unread-confirm"><input type="checkbox" checked={resolved} onChange={event => setResolved(event.target.checked)} /><span>Я вручную восстановил весь текст непрочитанных страниц по оригиналу</span></label><Button variant="secondary" disabled={!resolved} onClick={onResolveUnread}>Зафиксировать ручное исправление</Button></Notice>}
    <footer className="review-confirm-footer">
      <Button variant="quiet" onClick={busy ? onCancel : onBack}><ArrowLeft size={18} />{busy ? 'Отменить анализ' : 'Назад к выбору документа'}</Button>
      <div className="review-confirm-copy"><strong>{structuredClinic ? 'Источник и версия проверены' : structuredSource ? 'Подтверждаю проверку текста' : 'Подтверждаю сверку с оригиналом'}</strong><p>{onSave ? 'Сохраните документ в медкарту или сразу получите пояснение и соберите маршрут. Обе кнопки подтверждают проверку текста, а не медицинскую проверку.' : structuredClinic ? 'Маршрут строится по текущему результату.' : 'Кнопка подтверждает проверку текста вами, а не медицинскую проверку врачом.'}</p></div>
      <div className="review-confirm-actions">{onSave && <Button variant="secondary" disabled={busy || document.extractionStatus !== 'ready' || document.unreadPages.length > 0} onClick={onSave}><Save size={18} />Подтвердить и сохранить</Button>}<Button disabled={busy || document.extractionStatus !== 'ready' || document.unreadPages.length > 0} onClick={onConfirm}><FileCheck2 size={18} />{busy ? 'Обрабатываем подтверждённый текст…' : structuredClinic ? 'Создать маршрут по результату' : 'Подтвердить текст и создать маршрут'}</Button></div>
    </footer>
    <div className="review-data-boundary"><ShieldCheck size={17} /><p>{processing === 'live' && liveAllowed ? 'Сервер использует разрешённый учебный пример. Личный или изменённый текст не отправляется.' : processing === 'live' && personalLiveAllowed ? 'После подтверждения очищенный медицинский текст будет передан настроенному AI-сервису. Исходный файл не отправляется.' : structuredClinic ? 'Готовый результат проверен как учебный источник.' : 'Выбрана локальная обработка: текст анализируется в браузере, без внешнего AI.'}</p></div>
    <StudyPrivacyNote />
    {liveAllowed && showProcessingControl && <label className="review-processing-control">Обработка учебного примера<StyledSelect aria-label="Обработка учебного примера" value={processing} onChange={event => setProcessing(event.target.value)} disabled={busy}><option value="local">Локальный разбор без внешнего AI</option><option value="live">Настоящий внешний AI · требуется настроенный сервер</option><option value="replay">Сохранённый учебный результат</option></StyledSelect></label>}
    {liveAllowed && <PrivacyPreview sections={document.sections} />}
    {expanded && <Dialog title="Оригинал документа" eyebrow="Сверка с исходником" className="review-original-dialog" onClose={() => setExpanded(false)}>{viewerTools()}<div className="review-original-viewport">{original()}</div></Dialog>}
  </section>;
}
