import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, RotateCw, Trash2 } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Status';
import { detectFormat } from './validation';
import { INTAKE_LIMITS, IntakeError, type PhotoPageInput } from './types';
import './PhotoBatch.css';

interface PreparedPhoto extends PhotoPageInput {
  id: string;
  previewUrl: string;
}

export function PhotoBatch({
  files,
  disabled,
  onRead,
  onCancel,
}: {
  files: File[];
  disabled: boolean;
  onRead: (pages: PhotoPageInput[]) => void;
  onCancel: () => void;
}) {
  const [pages, setPages] = useState<PreparedPhoto[]>([]);
  const [preparing, setPreparing] = useState(true);
  const [error, setError] = useState('');
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const controller = new AbortController();
    const ownedUrls = urls.current;
    async function prepare() {
      try {
        if (files.length > INTAKE_LIMITS.pages)
          throw new IntakeError('too_many_pages', 'Можно выбрать до 5 фотографий одного документа.');
        if (files.reduce((sum, file) => sum + file.size, 0) > INTAKE_LIMITS.fileBytes)
          throw new IntakeError('too_large', 'Общий размер фотографий должен быть не больше 5 МБ.');
        const { canvasPreview, renderImage } = await import('./image');
        const prepared: PreparedPhoto[] = [];
        for (const file of files) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (controller.signal.aborted) return;
          const format = detectFormat(file.name, file.type, bytes);
          if (format !== 'png' && format !== 'jpg')
            throw new IntakeError(
              'unsupported',
              'В одном наборе поддерживаются только фотографии JPEG и PNG. PDF, DOCX и TXT загружаются по одному.',
            );
          const source = await renderImage(bytes, { signal: controller.signal });
          const thumb = document.createElement('canvas');
          try {
            const ratio = Math.min(1, 420 / Math.max(source.width, source.height));
            thumb.width = Math.max(1, Math.round(source.width * ratio));
            thumb.height = Math.max(1, Math.round(source.height * ratio));
            const context = thumb.getContext('2d');
            if (!context) throw new IntakeError('unreadable', 'Не удалось подготовить превью фотографий.');
            context.drawImage(source, 0, 0, thumb.width, thumb.height);
            const previewUrl = await canvasPreview(thumb);
            if (controller.signal.aborted) {
              URL.revokeObjectURL(previewUrl);
              return;
            }
            ownedUrls.add(previewUrl);
            prepared.push({ file, rotation: 0, previewUrl, id: crypto.randomUUID() });
          } finally {
            source.width = 0;
            source.height = 0;
            thumb.width = 0;
            thumb.height = 0;
          }
        }
        if (!controller.signal.aborted) setPages(prepared);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Не удалось проверить фотографии.');
      } finally {
        if (!controller.signal.aborted) setPreparing(false);
      }
    }
    void prepare();
    return () => {
      controller.abort();
      for (const url of ownedUrls) URL.revokeObjectURL(url);
      ownedUrls.clear();
    };
  }, [files]);

  function move(index: number, direction: -1 | 1) {
    setPages((current) => {
      const next = [...current];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
  }
  function remove(index: number) {
    const url = pages[index].previewUrl;
    URL.revokeObjectURL(url);
    urls.current.delete(url);
    setPages((current) => current.filter((_, position) => index !== position));
  }
  const locked = disabled || preparing;
  return (
    <section className="photo-batch" aria-label="Страницы документа">
      <h3>Проверьте страницы перед чтением</h3>
      <p className="small muted">
        Один набор относится к одному исследованию. Расположите страницы по порядку, поверните текст
        вертикально и удалите лишнее.
      </p>
      {preparing && <p role="status">Проверяем фотографии и готовим небольшие превью…</p>}
      {error && <Notice tone="error">{error}</Notice>}
      <ol className="photo-page-list">
        {pages.map((page, index) => (
          <li className="photo-page" key={page.id}>
            <div className="photo-thumbnail">
              <img
                src={page.previewUrl}
                alt={`Превью страницы ${index + 1}`}
                width={120}
                height={120}
                style={{ transform: `rotate(${page.rotation}deg)` }}
              />
            </div>
            <div className="photo-page-details">
              <strong>Страница {index + 1}</strong>
              <p className="small muted photo-filename">{page.file.name}</p>
              <p className="small muted">Поворот: {page.rotation}°</p>
              <div className="button-row photo-controls">
                <button
                  className="icon-button"
                  aria-label={`Поднять страницу ${index + 1}`}
                  disabled={locked || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Опустить страницу ${index + 1}`}
                  disabled={locked || index === pages.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Повернуть страницу ${index + 1} на 90 градусов`}
                  disabled={locked}
                  onClick={() =>
                    setPages((current) =>
                      current.map((item) =>
                        item.id === page.id
                          ? { ...item, rotation: ((item.rotation + 90) % 360) as PhotoPageInput['rotation'] }
                          : item,
                      ),
                    )
                  }
                >
                  <RotateCw size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Удалить страницу ${index + 1}`}
                  disabled={locked}
                  onClick={() => remove(index)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {!preparing && !error && pages.length === 0 && (
        <Notice>Все страницы удалены. Выберите фотографии заново.</Notice>
      )}
      <div className="button-row">
        <Button
          disabled={locked || !!error || pages.length === 0}
          onClick={() => onRead(pages.map(({ file, rotation }) => ({ file, rotation })))}
        >
          Прочитать страницы · {pages.length}
        </Button>
        <Button variant="quiet" disabled={disabled} onClick={onCancel}>
          Выбрать другой набор
        </Button>
      </div>
    </section>
  );
}
