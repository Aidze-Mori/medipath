import { useRef, useState } from 'react';
import { ArrowRight, Camera, FileText, Image, LoaderCircle, LockKeyhole, ScanText, UploadCloud } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Status';
import type { ExtractionProgress, PhotoPageInput } from './types';
import { PhotoBatch } from './PhotoBatch';
import './Intake.css';

export function IntakeView({ onFile, onPhotos, onText, progress, error, onCancel, hasDocument, onResume }: {
  onFile: (file: File) => void;
  onPhotos: (pages: PhotoPageInput[]) => void;
  onText: (text: string) => void;
  progress: ExtractionProgress | null;
  error: string;
  onCancel: () => void;
  hasDocument: boolean;
  onResume: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null), photoRef = useRef<HTMLInputElement>(null), cameraRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [drag, setDrag] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [selectionError, setSelectionError] = useState('');
  const [photoBatchId, setPhotoBatchId] = useState(0);
  function selectFiles(files: File[]) {
    if (!files.length) return;
    setSelectionError('');
    const allPhotos = files.every(file => /\.(?:png|jpe?g)$/i.test(file.name));
    if (files.length > 1 && !allPhotos) {
      setSelectionError('Несколько файлов принимаются только как фотографии JPEG/PNG одного документа. PDF, DOCX и TXT загрузите по одному. Ни один файл не прочитан.');
      return;
    }
    if (allPhotos) { setPendingPhotos(files); setPhotoBatchId(id => id + 1); }
    else { setPendingPhotos([]); onFile(files[0]); }
  }
  const fileChange = (input: HTMLInputElement) => { selectFiles(Array.from(input.files ?? [])); input.value = ''; };
  return <section className="intake-workspace" aria-label="Добавление медицинского документа">
    <header className="intake-heading">
      <h2>Загрузите медицинское заключение</h2>
      <p>Добавьте документ в медкарту, сверьте текст и подготовьте следующие шаги.</p>
    </header>
    {error && <Notice tone="error">{error}</Notice>}
    {selectionError && <Notice tone="error">{selectionError}</Notice>}
    {hasDocument && <div className="intake-resume"><FileText size={19} /><p>Предыдущий документ сохранён в этой вкладке.</p><Button variant="quiet" onClick={onResume}>Продолжить проверку</Button></div>}
    <div className="intake-columns">
      <div className="intake-main-column">
        <section className="panel intake-upload-panel" aria-labelledby="intake-upload-title">
          <div className="intake-card-heading"><span className="intake-heading-icon"><FileText size={23} /></span><div><h3 id="intake-upload-title">Добавить документ</h3><p>Заключение, исследование или выписка из другой клиники.</p></div></div>
          {progress ? <div className="intake-drop-area intake-progress-area" role="status">
            <LoaderCircle className="busy-icon" size={34} />
            <h3>{progress.label}</h3>
            <p className="small muted">{progress.total > 0 ? `${progress.current} из ${progress.total}` : 'Подготовка документа'}</p>
            <progress className="intake-progress" max={100} value={progress.total > 0 ? progress.percent : undefined} aria-label="Чтение документа" />
            <Button variant="secondary" onClick={onCancel}>Отменить чтение</Button>
          </div> : <>
            <div className={`intake-drop-area${drag ? ' is-dragging' : ''}`}
              onDragOver={event => { event.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={event => { event.preventDefault(); setDrag(false); selectFiles(Array.from(event.dataTransfer.files)); }}>
              <span className="intake-upload-symbol"><UploadCloud size={34} strokeWidth={1.6} /></span>
              <h3>Перетащите файл сюда</h3>
              <p>PDF, DOCX, TXT, JPG или PNG</p>
              <span className="small muted">До 5 МБ и 5 страниц</span>
              <Button onClick={() => fileRef.current?.click()}><UploadCloud size={18} />Выбрать файл</Button>
            </div>
            <div className="intake-photo-actions"><Button variant="secondary" onClick={() => photoRef.current?.click()}><Image size={18} />Выбрать фото</Button><Button variant="quiet" onClick={() => cameraRef.current?.click()}><Camera size={18} />Сделать фото</Button></div>
            <p className="intake-camera-hint">Можно добавить несколько фотографий одного документа, изменить их порядок и поворот.</p>
          </>}
          <input ref={fileRef} className="sr-only" aria-label="Файл документа" tabIndex={-1} type="file" multiple accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" onChange={event => fileChange(event.target)} />
          <input ref={photoRef} className="sr-only" aria-label="Фото документа" tabIndex={-1} type="file" multiple accept="image/png,image/jpeg" onChange={event => fileChange(event.target)} />
          <input ref={cameraRef} className="sr-only" aria-label="Сфотографировать документ" tabIndex={-1} type="file" accept="image/*" capture="environment" onChange={event => fileChange(event.target)} />
          {pendingPhotos.length > 0 && <div hidden={!!progress}><PhotoBatch key={photoBatchId} files={pendingPhotos} disabled={!!progress} onRead={onPhotos} onCancel={() => setPendingPhotos([])} /></div>}
          <p className="intake-format-note">DOC и HEIC пока не поддерживаются — сохраните копию в PDF или JPG. Доступность камеры и формат снимка зависят от телефона.</p>
        </section>
        <details className="panel intake-paste-panel">
          <summary><FileText size={19} /><span>Вставить текст документа</span></summary>
          <div className="intake-paste-body"><p className="small muted">Если у вас уже есть текст заключения, его можно добавить без файла.</p><label><span className="sr-only">Текст документа</span><textarea value={text} onChange={event => setText(event.target.value)} placeholder={'Описание: …\nЗаключение: …\nРекомендации: …'} maxLength={20000} rows={6} /></label><Button disabled={!text.trim() || !!progress} onClick={() => onText(text)}>Перейти к проверке<ArrowRight size={17} /></Button></div>
        </details>
      </div>
      <aside className="intake-aside" aria-label="Как добавляется документ">
        <section className="panel intake-help-panel"><span className="intake-heading-icon"><ScanText size={23} /></span><h3>Как это работает</h3><ol className="intake-steps"><li><span>1</span><div><strong>Добавьте документ</strong><p>Загрузите файл или снимки всех страниц.</p></div></li><li><span>2</span><div><strong>Сверьте текст</strong><p>Сравните распознанные разделы с оригиналом и исправьте неточности.</p></div></li><li><span>3</span><div><strong>Подготовьте маршрут</strong><p>После подтверждения появятся пояснение и шаги, для которых есть основание.</p></div></li></ol></section>
        <section className="intake-privacy-note"><LockKeyhole size={20} /><div><h3>Конфиденциальность</h3><p>Исходный файл читается в браузере. В режиме AI только после вашей сверки очищенный текст может быть передан модели через настроенный сервер. До подтверждения AI-анализ не запускается.</p><p>Документы хранятся в памяти этой вкладки. Обновление страницы завершит сессию.</p></div></section>
      </aside>
    </div>
  </section>;
}
