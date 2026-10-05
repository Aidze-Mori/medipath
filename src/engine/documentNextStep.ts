import { isReadyForAnalysis, sourceAnchor, type DocumentRecord, type SectionKind, type SourceAnchor } from '../domain';
import { hasSourceConflict } from './applyRules';

export interface DocumentNextStep {
  kind: 'additional_exam' | 'no_additional_exam' | 'clarification'; title: string; description: string; sourceRefs: SourceAnchor[];
}
const EXAM = /дообследован|обследован|исследован|(?<!\p{L})(?:УЗИ|КТ|МРТ|ЭКГ)(?!\p{L})|маммограф|рентгенограф|анализ|дополнительн[а-я]*\s+изображени/iu;
const ACTION = /(?<!\p{L})(?:рекомендован(?:о|а|ы)?|рекомендуется|необходим(?:о|а|ы)?|требу(?:ется|ются)|показан(?:о|а|ы)?|назначен(?:о|а|ы)?)(?!\p{L})/iu;
const NEGATED = /не\s+(?:требуется|требуются|рекомендован|рекомендуется|показан|необходим|нуж|назначен|выполнять|проводить|повторять)|нет\s+(?:показаний|необходимости)|(?:показани[яй]|необходимост[ьи])[^.!?\n]{0,120}(?:нет|отсутству)|отсутству[а-я]*\s+(?:показани|необходимост)|противопоказан/iu;
const UNCERTAIN = /если|(?<!\p{L})при\s|в\s+случае|по\s+показаниям|возможно|не\s+исключ|ранее|в\s+прошлом|уже\s|выполнен|провед[её]н|отмен[а-яё]*|отказ[а-я]*|отказыва[а-я]*|[«»"]/iu;

/** Transfers explicit examination wording only; never infers a procedure or specialty. */
export function getDocumentNextStep(document: DocumentRecord): DocumentNextStep | null {
  if (!isReadyForAnalysis(document)) return null;
  const evidence = (['recommendations', 'conclusion', 'description', 'other'] as SectionKind[]).flatMap(kind =>
    document.sections[kind].split(/(?:\n+|(?<=[.!?])\s+)/u).map(quote => ({ kind, quote: quote.trim() }))
      .filter(item => EXAM.test(item.quote) && (ACTION.test(item.quote) || NEGATED.test(item.quote))));
  if (!evidence.length) return null;
  const sourceRefs = evidence.map(item => sourceAnchor(document, item.kind, item.quote));
  const positive = evidence.some(item => !NEGATED.test(item.quote));
  const negative = evidence.some(item => NEGATED.test(item.quote));
  // Cross-sentence cancellation/conditions in recommendations may refer to the same examination.
  const remainder = document.sections.recommendations.split(/(?:\n+|(?<=[.!?])\s+)/u).filter(sentence => !evidence.some(item => item.quote === sentence.trim())).join(' ');
  const mixedClause = evidence.some(item => NEGATED.test(item.quote) && /[,;]\s*(?:но\s+|однако\s+)?(?:рекомендован|рекомендуется|показан|необходим|требуется|назначен)/iu.test(item.quote));
  if (hasSourceConflict(document) || (positive && negative) || mixedClause || evidence.some(item => UNCERTAIN.test(item.quote)) || UNCERTAIN.test(remainder) || (positive && NEGATED.test(remainder))) return {
    kind: 'clarification', title: 'Уточнить рекомендации по обследованию',
    description: 'В тексте есть условие, история, отрицание или несогласованность. Обсудите актуальность обследования с врачом; автоматическое назначение не создано.', sourceRefs,
  };
  return negative ? {
    kind: 'no_additional_exam', title: 'Дополнительное обследование в исходнике не требуется',
    description: 'Сохранено отрицательное указание исходника. Оно не заменяет оценку новых симптомов или последующих рекомендаций врачом.', sourceRefs,
  } : {
    kind: 'additional_exam', title: 'Обсудить рекомендованное обследование',
    description: 'В документе прямо указано обследование. Уточните у врача его выполнение и срок; специальность и новое назначение приложение не придумывает.', sourceRefs,
  };
}
