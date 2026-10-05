import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, FileText, Maximize2, Minus, Plus, ShieldCheck } from 'lucide-react';
import type { DocumentRecord, DocumentSections, SectionKind } from '../../domain';
import type { ExtractedDocument } from '../intake/types';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import './StudySource.css';

const labels: Record<SectionKind, string> = { description: 'Описание', conclusion: 'Заключение', recommendations: 'Рекомендации', other: 'Сведения из источника' };

export function StudySource({ document, original = false, showSummary = true }: { document: DocumentRecord; original?: boolean; showSummary?: boolean }) {
  const sections: DocumentSections = original ? document.originalSections : document.sections;
  const metadata = document.studyMetadata;
  const kinds = (Object.keys(labels) as SectionKind[]).filter(kind => sections[kind].trim());
  return <section className="study-source" aria-label="Поля исследования">
    {metadata && <div className="study-metadata"><div className="study-metadata-heading"><FileText size={20} /><div><h3>{metadata.studyName}</h3><p>{metadata.clinicName} · {metadata.sourceLabel}</p></div></div><dl>
      <div><dt>Номер исследования</dt><dd>{metadata.studyId}</dd></div>
      <div><dt><CalendarDays size={14} />Исследование выполнено</dt><dd>{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }).format(new Date(metadata.performedAt))}</dd></div>
      <div><dt>Аппарат</dt><dd>{metadata.equipment || 'Не указан в источнике'}</dd></div>
    </dl></div>}
    {showSummary && sections.conclusion.trim() && <div className="study-source-summary"><p className="eyebrow">В заключении исследования</p><p>{sections.conclusion}</p></div>}
    <div className="study-source-fields">{kinds.map(kind => <details className={`study-source-field${kind === 'recommendations' ? ' is-recommendation' : ''}`} key={kind}><summary><strong>{labels[kind]}</strong><ChevronDown size={18} aria-hidden="true" /></summary><div><p>{sections[kind]}</p></div></details>)}</div>
    {!kinds.length && <p className="muted">В источнике нет доступного текста.</p>}
  </section>;
}

export function StudyPrivacyNote() {
  return <p className="study-privacy-note"><ShieldCheck size={16} /><span>При использовании AI передаются очищенные медицинские разделы или очищенный текст, если разделы не выделены. Файл и название не передаются. Очистка скрывает обнаруженные идентификаторы, но может пропустить данные.</span></p>;
}

/** Continuous original pages. A structured clinic result never uses this viewer. */
export function OriginalDocument({ extraction, document, title, initialPage }: { extraction?: ExtractedDocument | null; document: DocumentRecord; title: string; initialPage?: number }) {
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const expandedViewport = useRef<HTMLDivElement>(null);
  const blocks = extraction?.blocks ?? document.blocks.map(block => ({ id: block.id, originalText: block.text, previewUrl: undefined, pageNumber: block.page }));
  const hasImages = blocks.some(block => block.previewUrl);
  useEffect(() => {
    if (!initialPage || initialPage <= 1) return;
    let cancelled = false;
    async function revealPage(container: HTMLDivElement | null) {
      if (!container) return;
      const target = container.querySelector<HTMLElement>(`[data-source-page="${initialPage}"]`);
      if (!target) return;
      // Earlier images must have their real height before positioning the page.
      // Scroll only this viewer: scrollIntoView would also move the whole app.
      await Promise.allSettled([...container.querySelectorAll('img')].map(image => image.decode()));
      if (cancelled) return;
      const padding = Number.parseFloat(getComputedStyle(container).paddingTop) || 0;
      container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientTop - padding;
    }
    void revealPage(viewport.current);
    void revealPage(expandedViewport.current);
    return () => { cancelled = true; };
  }, [initialPage, document.id, extraction, expanded]);
  function controls() {
    return <div className="study-original-tools"><span>{hasImages ? `Страниц: ${blocks.length}` : 'Полный исходный текст'}</span><div><button type="button" className="icon-button" aria-label="Уменьшить исходник" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .25))}><Minus size={17} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" className="icon-button" aria-label="Увеличить исходник" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + .25))}><Plus size={17} /></button><Button variant="quiet" onClick={() => setZoom(1)}>По ширине</Button></div></div>;
  }
  function pages() {
    return <div className="study-original-pages">{hasImages ? blocks.map((block, index) => <figure key={block.id} data-source-page={block.pageNumber ?? index + 1}><figcaption>Страница {block.pageNumber ?? index + 1}</figcaption>{block.previewUrl ? <img src={block.previewUrl} alt={`Исходный документ, страница ${block.pageNumber ?? index + 1}`} style={{ width: `${zoom * 100}%` }} /> : <pre style={{ fontSize: `${zoom * 15}px` }}>{block.originalText || 'Эта страница не прочитана. Вернитесь к сверке и замените её доступной копией.'}</pre>}</figure>) : <pre style={{ fontSize: `${zoom * 15}px` }}>{blocks.map(block => block.originalText).join('\n\n')}</pre>}</div>;
  }
  return <section className="panel study-original" aria-label="Полный исходный документ"><header><div><h3>Исходный документ</h3><p>{title}</p></div><Button variant="quiet" onClick={() => setExpanded(true)}><Maximize2 size={16} />Развернуть</Button></header>{controls()}<div className="study-original-viewport" ref={viewport}>{pages()}</div>{expanded && <Dialog title="Исходный документ" eyebrow="Все страницы файла" className="study-original-dialog" onClose={() => setExpanded(false)}>{controls()}<div className="study-original-viewport" ref={expandedViewport}>{pages()}</div></Dialog>}</section>;
}
