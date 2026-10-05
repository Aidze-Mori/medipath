import type { SourceAnchor } from '../../domain';

export function SourceQuote({
  source,
  onSource,
}: {
  source: SourceAnchor;
  onSource?: (anchor: SourceAnchor) => void;
}) {
  const origins = source.corrected ? (source.originalAnchors ?? []) : [source];
  return (
    <blockquote className="source-quote">
      {source.corrected && <p className="small muted">Исправленный текст · редакция {source.revision}</p>}«
      {source.quote}»
      <footer className="small muted">
        {source.userAuthored
          ? 'Текст добавлен при проверке. Точное место в исходнике не установлено.'
          : source.corrected
            ? 'Исходный фрагмент сохранён отдельно от исправленной цитаты.'
            : source.page
              ? `Страница ${source.page}`
              : source.paragraph
                ? `Абзац ${source.paragraph}`
                : 'Подтверждённый раздел документа'}
        {onSource &&
          origins.map((origin, i) => (
            <button
              key={origin.blockId}
              className="text-link"
              style={{ display: 'block' }}
              onClick={() => onSource({ ...source, ...origin })}
            >
              {source.corrected
                ? `Открыть исходный фрагмент${origin.page ? ` · страница ${origin.page}` : origins.length > 1 ? ` ${i + 1}` : ''}`
                : 'Показать в оригинале'}
            </button>
          ))}
      </footer>
    </blockquote>
  );
}
