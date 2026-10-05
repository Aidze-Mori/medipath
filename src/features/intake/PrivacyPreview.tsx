import type { DocumentSections } from '../../domain';
import { deidentify } from '../../privacy/deidentify';
import { minimize } from '../../privacy/minimize';
import { prepareAnonymizedSections } from '../../privacy/documentAnalysis';
export function PrivacyPreview({ sections, kind = 'synthetic' }: { sections: DocumentSections; kind?: 'synthetic' | 'document' }) {
  const review = deidentify(Object.values(sections).join('\n'));
  const payload = minimize(sections);
  const outgoing = kind === 'document' ? prepareAnonymizedSections(sections) : payload.sections;
  return (
    <details className="privacy-preview">
      <summary>{kind === 'document' ? 'Проверить очищенный текст перед отправкой AI' : 'Что получит внешняя модель в этом примере?'}</summary>
      <div className="stack spaced-top">
        <p className="small">
          {kind === 'document' ? 'Ниже — точная текстовая копия для отправки на локальный AI-сервер. Сервер повторно очищает её перед вызовом провайдера. Исходный PDF, имя файла и метаданные не передаются.' : 'Браузер отправляет только разрешённый ID. Сервер загружает учебный исходник, удаляет прямые идентификаторы и оставляет нужные разделы.'}
        </p>
        <div className="review-grid">
          <div>
            <h4>{kind === 'document' ? 'Распознанный исходник' : 'Учебный исходник'}</h4>
            <pre className="source-text small">{Object.values(sections).join('\n\n')}</pre>
          </div>
          <div>
            <h4>Минимизированная копия</h4>
            <pre className="source-text small">{outgoing.map((s) => s.text).join('\n\n')}</pre>
          </div>
        </div>
        <p className="small">
          Обнаружены замены: {review.replacements.map((r) => `${r.kind}: ${r.count}`).join(', ') || 'нет'}.
          Имя файла, metadata и исходные bytes не включаются. Если разделы не распознаны, передаётся только очищенный текст без выявленных персональных строк.
        </p>
        <p className="small muted">
          Автоматическая очистка может пропустить нестандартные имена и косвенные идентификаторы. Проверьте копию; при сомнении выберите локальный разбор без внешней модели.
        </p>
      </div>
    </details>
  );
}
