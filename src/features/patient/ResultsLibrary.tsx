import { Archive, ArchiveRestore, ArrowRight, ChevronRight, ClipboardCheck, FileText, FolderOpen, Plus, Route, Upload } from 'lucide-react';
import { isReadyForAnalysis } from '../../domain';
import type { Analysis, DocumentRecord } from '../../domain';
import { Button } from '../../ui/Button';
import { ResultDate, ReadinessLabel, getOrigin } from './resultPresentation';
export { ResultDetails } from './ResultDetails';
import './ResultsLibrary.css';

export interface LibraryEntry {
  document: DocumentRecord;
  title: string;
  date: string;
  receivedAt?: string;
  analysis: Analysis | null;
  archived: boolean;
}
export type FeedbackValue = 'helpful' | 'unhelpful' | null;

export function ResultsLibrary({
  entries, archived = false, selectedIds, onSelection, onOpen, onUpload, onBuild, onArchive, onUseDemo, busy = false,
}: {
  entries: LibraryEntry[];
  busy?: boolean;
  archived?: boolean;
  selectedIds: string[];
  onSelection: (ids: string[]) => void;
  onOpen: (id: string) => void;
  onUpload: () => void;
  onBuild: () => void;
  onArchive: (id: string, archived: boolean) => void;
  onUseDemo?: () => void;
}) {
  const visible = entries.filter((entry) => entry.archived === archived).sort((a, b) => (b.receivedAt ?? b.date).localeCompare(a.receivedAt ?? a.date));
  const dayKey = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  const days = [...new Set(visible.map(entry => dayKey(entry.receivedAt ?? entry.date)))];
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86400000).toISOString());
  const eligible = visible.filter((entry) => isReadyForAnalysis(entry.document));
  const selected = eligible.filter((entry) => selectedIds.includes(entry.document.id));

  function toggle(id: string, checked: boolean) {
    if (!eligible.some((entry) => entry.document.id === id) || archived) return;
    onSelection(checked ? [...new Set([...selectedIds, id])] : selectedIds.filter((value) => value !== id));
  }

  return <div className="results-library stack">
    <div className="results-heading">
      <div><p className="eyebrow">Медкарта</p><h2>{archived ? 'Архив документов' : 'Ваши результаты'}</h2>
        <p className="muted">{archived ? 'Документы, которые вы убрали из активной медкарты, доступны для просмотра. Верните документ в результаты, чтобы учесть его в маршруте.' : 'Результаты исследований и документы, которые вы добавили.'}</p>
      </div>
      {!archived && visible.length > 0 && <Button variant="secondary" className="results-neutral-button" onClick={onUpload}><Plus size={17} />Добавить документ</Button>}
    </div>

    {visible.length === 0 ? <section className="panel results-empty">
      <span className="results-empty-icon">{archived ? <Archive size={28} /> : <FolderOpen size={28} />}</span>
      <h3>{archived ? 'В архиве пока пусто' : 'Здесь появятся ваши документы'}</h3>
      <p className="muted">{archived ? 'Сохранённые результаты можно перенести сюда из медкарты. Архив не удаляет исходный документ.' : 'Добавьте заключение или результат исследования. После извлечения вы сможете сравнить текст с оригиналом.'}</p>
      {!archived && <Button variant="secondary" className="results-neutral-button" onClick={onUpload}><Upload size={18} />Добавить документ из другой клиники</Button>}
      {!archived && onUseDemo && <Button variant="quiet" className="results-neutral-button" onClick={onUseDemo}>Открыть демопанель</Button>}
      <p className="small muted">Документы хранятся в этой вкладке до её перезагрузки.</p>
    </section> : <div className={`results-library-layout${archived ? ' is-archive' : ''}`}>
      <section className="panel results-collection" aria-label={archived ? 'Архивированные документы' : 'Результаты исследований'}>
        <div className="results-collection-head"><div><h3>{archived ? 'Сохранённые документы' : 'Исследования и заключения'}</h3><p className="small muted">Документов: {visible.length}{!archived ? ` · Готовы к маршруту: ${eligible.length}` : ''}</p></div><FileText size={22} aria-hidden="true" /></div>
        {!archived && eligible.length > 0 && <div className="results-bulk-control"><Button variant="quiet" disabled={busy} onClick={() => onSelection(selected.length ? [] : eligible.map(entry => entry.document.id))}>{selected.length ? 'Снять выделение' : 'Выбрать все'}</Button><span className="small muted">{selected.length ? `Выбрано ${selected.length} из ${eligible.length}` : 'Все готовые результаты'}</span></div>}
        <div className="results-list">{days.map(day => <section className="results-day" key={day} aria-label={`Поступили ${day}`}><h4>{day === today ? 'Сегодня' : day === yesterday ? 'Вчера' : <ResultDate value={day} />}<span>Поступили в медкарту</span></h4>{visible.filter(entry => dayKey(entry.receivedAt ?? entry.date) === day).map((entry) => {
          const ready = isReadyForAnalysis(entry.document);
          const checked = selected.some((item) => item.document.id === entry.document.id);
          return <article key={entry.document.id} className={`results-row${checked ? ' is-selected' : ''}`} aria-label={entry.title}>
            {!archived && <label className="results-select-control" title={ready ? 'Учесть документ в маршруте' : 'Сначала откройте документ и подтвердите текст'}>
              <input type="checkbox" checked={checked} disabled={!ready} onChange={(event) => toggle(entry.document.id, event.target.checked)} aria-label={`Учесть в маршруте: ${entry.title}`} />
            </label>}
            <button type="button" className="results-row-open" onClick={() => onOpen(entry.document.id)} aria-label={`Открыть результат: ${entry.title}`}>
              <span className="results-document-icon"><FileText size={23} /></span>
              <span className="results-document-body"><strong>{entry.title}</strong><ReadinessLabel document={entry.document} /><span className="small muted">{entry.document.origin === 'clinic_adapter' ? 'Исследование: ' : 'Добавлен: '}<ResultDate value={entry.date} /> · {getOrigin(entry.document)}</span>{entry.receivedAt && <span className="small muted">Получен в {new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date(entry.receivedAt))}</span>}{entry.document.revision > 1 && <span className="small muted">Текст исправлен · версия {entry.document.revision}</span>}</span>
              <span className="results-open-caption">Открыть<ChevronRight size={18} /></span>
            </button>
            <button type="button" className="icon-button results-archive-action" aria-label={`${archived ? 'Вернуть в результаты' : 'В архив'}: ${entry.title}`} title={archived ? 'Вернуть в результаты' : 'В архив'} onClick={() => onArchive(entry.document.id, !archived)}>
              {archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
            </button>
          </article>;
        })}</section>)}</div>
        {!archived && eligible.length < visible.length && <p className="small muted results-collection-note"><ClipboardCheck size={16} />Документы без подтверждённого текста сначала нужно открыть и сверить с оригиналом.</p>}
      </section>
      {!archived && <aside className="panel results-next-step" aria-labelledby="results-next-step-heading">
        <span className="results-empty-icon"><Route size={24} /></span>
        <h3 id="results-next-step-heading">Следующий шаг</h3>
        <p>Выберите документы, которые нужно учесть в плане посещений.</p>
        <div className="results-selected-count" aria-live="polite"><strong>{selected.length}</strong><span>{selected.length === 1 ? 'документ выбран' : 'документов выбрано'}</span></div>
        <Button onClick={onBuild} disabled={selected.length === 0 || busy}><Route size={18} />Собрать маршрут<ArrowRight size={18} /></Button>
        <p className="small muted">Каждое направление сохраняет связь со своим документом. Выбор нескольких документов не означает общий диагноз.</p>
        <p className="small muted">Сначала можно открыть любой результат и прочитать его.</p>
      </aside>}
    </div>}
  </div>;
}
