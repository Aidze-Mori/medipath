import { useId, useState } from 'react';
import { ArrowLeft, ArrowRight, ClipboardCheck, FileText, Info, Route, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import { isReadyForAnalysis } from '../../domain';
import type { ExtractedDocument } from '../intake/types';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Status';
import { NextStepNotice } from './NextStepNotice';
import { AnalysisExplanation } from './AnalysisExplanation';
import { ResultDate, ReadinessLabel, getOrigin } from './resultPresentation';
import type { LibraryEntry, FeedbackValue } from './ResultsLibrary';
import { OriginalDocument, StudySource, StudyPrivacyNote } from './StudySource';
import './ResultsLibrary.css';
import './ResultDetails.css';

export function ResultDetails({ entry, extraction, initialSourcePage, onBuild, onReview, onBack, feedback = null, onFeedback, onDelete, busy = false }: {
  entry: LibraryEntry;
  extraction?: ExtractedDocument | null;
  initialSourcePage?: number;
  onDelete?: () => void;
  busy?: boolean;
  onBuild: () => void;
  onReview: () => void;
  onBack: () => void;
  feedback?: FeedbackValue;
  onFeedback?: (value: FeedbackValue) => void;
}) {
  const { document } = entry;
  const [tab, setTab] = useState(initialSourcePage ? 'source' : 'result');
  const structured = !extraction && (document.origin === 'clinic_adapter' || Boolean(document.fixtureId));
  const tabsId = useId();
  const ready = isReadyForAnalysis(document);
  const analysis = ready && entry.analysis?.documentId === document.id
    && entry.analysis.documentRevision === document.revision ? entry.analysis : null;
  const explanationClaims = analysis?.claims.filter((claim) => claim.kind === 'explanation') ?? [];

  return <div className="result-details stack">
    <header className="results-detail-heading">
      <Button variant="quiet" className="results-back results-neutral-button" onClick={onBack} aria-label={entry.archived ? 'К архиву документов' : 'К результатам'}><ArrowLeft size={18} /><span className="results-back-caption">{entry.archived ? 'К архиву документов' : 'К результатам'}</span></Button>
      <div className="results-heading"><div><p className="eyebrow">Медкарта · Результат исследования</p><h2>{entry.title}</h2><p className="muted"><ResultDate value={entry.date} /> · {getOrigin(document)}{document.revision > 1 ? ` · Текст исправлен, версия ${document.revision}` : ''}</p></div><ReadinessLabel document={document} /></div>
    </header>
    {!ready && <Notice tone="warning">{structured ? 'Проверьте текущую редакцию текста исследования. ' : 'Сначала сравните распознанный текст с исходным документом. '}Содержательный анализ и маршрут появятся после подтверждения текущей редакции.<Button variant="secondary" className="spaced-top results-neutral-button" onClick={onReview}><ClipboardCheck size={17} />Перейти к сверке текста</Button></Notice>}
    {entry.analysis && !analysis && ready && <Notice>Документ изменился. Предыдущее пояснение больше не относится к текущей редакции; соберите маршрут заново.</Notice>}
    {ready && <NextStepNotice document={document} analysis={analysis} />}
    {!structured && <div className="study-result-tabs" role="tablist" aria-label="Исходник и результат">{([['source', 'Исходный файл'], ['result', 'Текст и пояснение']] as const).map(([id, label]) => <button key={id} id={`${tabsId}-tab-${id}`} role="tab" type="button" aria-selected={tab === id} aria-controls={`${tabsId}-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const next = id === 'source' ? 'result' : 'source'; setTab(next); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[aria-controls="${tabsId}-${next}"]`)?.focus(); }
    }}>{label}</button>)}</div>}
    <div className={`study-result-layout${structured ? ' is-structured' : ''}`} data-tab={tab}>
      {!structured && <div id={`${tabsId}-source`} className="study-result-original"><OriginalDocument document={document} extraction={extraction} title={entry.title} initialPage={initialSourcePage} /></div>}
      <div id={`${tabsId}-result`} className="study-result-content">
        <section className="panel study-result-fields" aria-label={structured ? 'Готовое исследование' : 'Текст исследования'}>
          <header className="panel-head"><div><p className="eyebrow">{structured ? 'Получено из источника' : 'Проверенный текст документа'}</p><h3><FileText size={21} />{structured ? 'Данные исследования' : 'В документе'}</h3></div><Button variant="quiet" onClick={onReview}>{structured ? 'Редактировать текст' : 'Сверить с оригиналом'}</Button></header>
          {structured && <p className="small muted study-structured-note">{document.origin === 'clinic_adapter' ? 'Готовые поля из учебной системы клиники. Их не нужно распознавать повторно.' : 'Поля подготовленного учебного исследования. PDF к этому примеру не приложен.'}</p>}
          <StudySource document={document} showSummary={!analysis?.llmExplanation} />
        </section>
        <section className="panel results-explanation-panel" aria-labelledby={`${tabsId}-explanation-heading`}>
          <div className="panel-head"><h3 id={`${tabsId}-explanation-heading`}><Info size={22} />Пояснение к результату</h3></div>
        {analysis ? <>
          <AnalysisExplanation analysis={analysis} />
          <div className="results-explanation-content" hidden={!!analysis.llmExplanation}><p>{analysis.summary}</p>{explanationClaims.map((claim) => <div key={claim.id} className="results-explanation-claim"><p>{claim.text}</p>{claim.sourceRefs.length > 0 && <details><summary>Основание в документе</summary>{claim.sourceRefs.map((source, index) => <blockquote key={`${source.blockId}-${index}`}>{source.quote}<footer className="small muted">{source.corrected ? `Исправленный текст · редакция ${source.revision}` : source.page ? `Страница ${source.page}` : 'Раздел исходного документа'}</footer></blockquote>)}</details>}</div>)}</div>
          {analysis.processingStatus === 'needs_review' && <Notice tone="warning">Есть неоднозначные или противоречивые сведения. Уточните их по оригиналу и с врачом; неподтверждённые шаги не добавляются.</Notice>}
          {analysis.processingStatus === 'insufficient' && <Notice>В документе недостаточно оснований для нового маршрута. Новые специальности и сроки не назначены.</Notice>}
          <p className="small muted">Пояснение не проходило врачебную проверку и не заменяет консультацию.</p>
          <details className="results-analysis-details"><summary>Источники и ограничения</summary><div className="stack-small">
            <p className="small">Обработка: {analysis.mode === 'anonymized_live' ? 'внешняя LLM · очищенный документ' : analysis.mode === 'synthetic_live' ? 'внешняя LLM · учебные данные' : analysis.mode === 'synthetic_replay' ? 'записанный учебный ответ' : 'локальный разбор документа'}.</p>
            <p className="small">Пояснение сверяется с подтверждённым текстом. Источники для клинических учебных предложений приводятся рядом с соответствующим шагом.</p>

            {analysis.warnings.length > 0 && <ul>{analysis.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
          </div></details>
          {onFeedback && <div className="results-feedback"><p className="small">Это пояснение было полезным?</p><div className="button-row"><button type="button" className="btn btn-secondary results-feedback-button" aria-pressed={feedback === 'helpful'} onClick={() => onFeedback(feedback === 'helpful' ? null : 'helpful')}><ThumbsUp size={17} />Полезно</button><button type="button" className="btn btn-secondary results-feedback-button" aria-pressed={feedback === 'unhelpful'} onClick={() => onFeedback(feedback === 'unhelpful' ? null : 'unhelpful')}><ThumbsDown size={17} />Не помогло</button>{feedback && <Button variant="quiet" className="results-neutral-button" onClick={() => onFeedback(null)}>Снять оценку</Button>}</div><p className="small muted" aria-live="polite">{feedback ? 'Оценка сохранена в этой сессии. Она не меняет маршрут.' : 'Оценку можно изменить или снять.'}</p></div>}
        </> : <div className="results-no-analysis"><span className="results-empty-icon"><FileText size={28} /></span><h4>{ready ? 'Документ готов к разбору' : 'Сначала проверьте текст'}</h4><p className="muted">{ready ? 'Соберите маршрут, чтобы увидеть пояснение и доступные следующие шаги с привязкой к исходнику.' : 'После вашей сверки система сможет использовать текущую редакцию. Отсутствующие сведения не восстанавливаются по догадке.'}</p></div>}
        </section>
      </div>
    </div>
    <StudyPrivacyNote />
    {onDelete && <Button variant="quiet" className="results-delete" onClick={onDelete}><Trash2 size={16} />Удалить документ</Button>}
    <div className="panel results-build-footer"><div><h3>{entry.archived ? 'Документ находится в архиве' : 'Что дальше'}</h3><p className="small muted">{entry.archived ? 'Для включения в новый маршрут верните его в результаты.' : 'Маршрут учитывает только допустимые рекомендации. Запись подтверждается отдельным действием.'}</p></div><Button onClick={onBuild} disabled={!ready || entry.archived || busy}><Route size={18} />Собрать маршрут<ArrowRight size={18} /></Button></div>
  </div>;
}
