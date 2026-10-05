import {
  INTAKE_LIMITS,
  IntakeError,
  type ExtractedBlock,
  type ExtractedDocument,
  type ExtractedSection,
  type IntakeFormat,
  type SectionKind,
} from './types';

const headingKinds: Record<string, SectionKind> = {
  описание: 'description',
  'описание исследования': 'description',
  'описание результатов исследования': 'description',
  'описание результата исследования': 'description',
  'описание результатов': 'description',
  'описание обследования': 'description',
  'данные исследования': 'description',
  'описательная часть': 'description',
  'описание рентгенограммы': 'description',
  'описание рентгенограмм': 'description',
  'протокол исследования': 'description',
  'протокол обследования': 'description',
  'протокол лучевого исследования': 'description',
  'результаты исследования': 'description',
  'результаты обследования': 'description',
  'результаты лучевого исследования': 'description',
  заключение: 'conclusion',
  'заключение врача': 'conclusion',
  'заключение исследования': 'conclusion',
  'заключение по результатам исследования': 'conclusion',
  'заключение врача-рентгенолога': 'conclusion',
  'заключение рентгенолога': 'conclusion',
  'диагностическое заключение': 'conclusion',
  'кт-заключение': 'conclusion',
  'мр-заключение': 'conclusion',
  'мрт-заключение': 'conclusion',
  'уз-заключение': 'conclusion',
  'узи-заключение': 'conclusion',
  вывод: 'conclusion',
  выводы: 'conclusion',
  рекомендации: 'recommendations',
  'рекомендации врача': 'recommendations',
  'рекомендации по дальнейшему обследованию': 'recommendations',
  'рекомендации по дообследованию': 'recommendations',
  'рекомендации по результатам исследования': 'recommendations',
  'дальнейшие рекомендации': 'recommendations',
  рекомендовано: 'recommendations',
  анамнез: 'history',
  жалобы: 'history',
  'клинические данные': 'history',
  диагноз: 'other',
  осмотр: 'other',
  источник: 'other',
  лицензия: 'other',
  другое: 'other',
};
// These are source fields, not clinical conclusions. Keep their labels when
// mapping to the domain's `other` field, including labels needed by PII cleanup.
const metadataHeadings = new Set([
  'место проведения', 'место проведения исследования', 'медицинская организация',
  'сведения об исследовании', 'информация об исследовании', 'данные об исследовании',
  'наименование исследования', 'название исследования', 'вид исследования', 'тип исследования',
  'область исследования', 'исследуемая область', 'дата исследования',
  'дата проведения', 'дата проведения исследования', 'дата и время исследования',
  'дата и время проведения исследования', 'дата выполнения исследования',
  'дата формирования документа', 'номер исследования', 'номер протокола',
  'аппарат', 'оборудование', 'эффективная доза', 'доза облучения',
  'врач', 'врач-рентгенолог', 'врач рентгенолог', 'выполнил',
  'пациент', 'фио пациента', 'ф.и.о. пациента', 'фио', 'ф.и.о.',
  'дата рождения', 'пол', 'возраст', 'снилс', 'полис омс',
]);
for (const heading of metadataHeadings) headingKinds[heading] = 'other';
function normalizedHeading(heading: string) {
  return heading.toLocaleLowerCase('ru').replace(/[ \t\u00a0]+/g, ' ').trim();
}
export function isMetadataHeading(heading: string): boolean {
  return metadataHeadings.has(normalizedHeading(heading));
}
function escapePattern(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const headingNames = Object.keys(headingKinds).sort((first, second) => second.length - first.length)
  .map(heading => escapePattern(heading).replaceAll(' ', '[ \\t]+')).join('|');
// A prose mention of a conclusion is not a heading. Inline headings need a
// sentence/table boundary and an explicit separator; standalone labels may end in a dot.
const headingPattern = new RegExp(`(^|(?<=[.!?;])[ \\t]+|[ \\t]{2,})(?:\\d{1,2}[.)][ \\t]*|[•▪][ \\t]*)?(${headingNames})(?:[ \\t]*[:：][ \\t]*|[ \\t]+[—–-][ \\t]*|[ \\t]*[.]?[ \\t]*$)`, 'giu');
const headingPrefix = new RegExp(`^(?:\\d{1,2}[.)][ \\t]*|[•▪][ \\t]*)?(${headingNames})([ \\t]+)(.+)$`, 'iu');

function sourceLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').replaceAll('\u00a0', ' ').split('\n');
  const combined: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    // A label may wrap because its table cell is narrow. Only combine exact
    // known multi-word labels; body sentences are never joined by this step.
    for (let count = 1; count <= 2 && index + count < lines.length; count++) {
      const candidate = lines.slice(index, index + count + 1).map(part => part.trim()).join(' ');
      const label = normalizedHeading(candidate.replace(/[:：.]\s*$/u, ''));
      if (headingKinds[label]) { line = candidate; index += count; break; }
    }
    const bare = normalizedHeading(line.replace(/[:：.]\s*$/u, ''));
    if (/^(?:[А-ЯЁA-Z]\s+){3,}[А-ЯЁA-Z][.:：]?$/u.test(line.trim())) {
      const compact = bare.replaceAll(' ', '');
      if (headingKinds[compact]) line = line.replaceAll(' ', '');
    }
    const explicitHeading = [...line.trim().matchAll(headingPattern)].some(match => match.index === 0);
    const prefix = !explicitHeading && line.trim().match(headingPrefix);
    if (prefix) {
      const [, heading, gap, value] = prefix;
      const explicitTableGap = gap.includes('\t') || gap.length >= 2;
      // A capitalized value after a known form label is common in PDF text
      // layers. Lower-case prose ('Заключение отсутствует') remains body text.
      if (explicitTableGap || /^[А-ЯЁA-Z0-9]/u.test(value)) line = `${heading}: ${value}`;
    }
    combined.push(line);
  }
  return combined;
}

export interface ReviewContextField { heading: string; text: string; start: number; end: number }
/** Offsets address the current editable `other` value, never the original source. */
export function reviewContextFields(text: string): ReviewContextField[] {
  const names = [...metadataHeadings].sort((a, b) => b.length - a.length).map(escapePattern).join('|');
  const pattern = new RegExp(`^(?:[ \\t]*)(${names})[ \\t]*:[ \\t]*`, 'gimu');
  const matches = [...text.matchAll(pattern)];
  if (!matches.length) return [];
  function makeField(heading: string, start: number, end: number): ReviewContextField {
    while (start < end && /\s/u.test(text[start])) start++;
    while (end > start && /\s/u.test(text[end - 1])) end--;
    return { heading, text: text.slice(start, end), start, end };
  }
  const fields: ReviewContextField[] = [];
  if (text.slice(0, matches[0].index).trim()) fields.push(makeField('Другой контекст', 0, matches[0].index));
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    fields.push(makeField(match[1], match.index + match[0].length, matches[index + 1]?.index ?? text.length));
  }
  return fields;
}

/** Unknown anatomy subheadings stay in their source section, never become model conclusions. */
export function splitSections(blocks: ExtractedBlock[]): {
  sections: ExtractedSection[];
  unclassifiedText: string;
  unclassifiedAnchors: string[];
} {
  const sections: ExtractedSection[] = [];
  const unclassified: string[] = [];
  const unclassifiedAnchors = new Set<string>();
  let current: ExtractedSection | undefined;
  function append(text: string, block: ExtractedBlock) {
    if (current) {
      current.text += `${current.text ? '\n' : ''}${text}`;
      if (text.trim() && !current.anchors.includes(block.anchor)) current.anchors.push(block.anchor);
    } else {
      unclassified.push(text);
      if (text.trim()) unclassifiedAnchors.add(block.anchor);
    }
  }
  for (const block of blocks) {
    for (const line of sourceLines(block.originalText)) {
      const matches = [...line.trim().matchAll(headingPattern)];
      if (!matches.length) { append(line, block); continue; }
      if (current && normalizedHeading(current.heading) === 'другое' && matches.every(match => isMetadataHeading(match[2]))) {
        append(line, block);
        continue;
      }
      const trimmed = line.trim();
      let cursor = 0;
      for (const match of matches) {
        const preceding = trimmed.slice(cursor, match.index).trim();
        if (preceding) append(preceding, block);
        const heading = match[2];
        const kind = headingKinds[normalizedHeading(heading)];
        current = { kind, heading, text: '', anchors: [block.anchor] };
        sections.push(current);
        cursor = match.index + match[0].length;
      }
      const remaining = trimmed.slice(cursor);
      if (remaining) append(remaining, block);
    }
  }
  for (const section of sections) section.text = section.text.trim();
  return { sections, unclassifiedText: unclassified.join('\n').trim(), unclassifiedAnchors: [...unclassifiedAnchors] };
}

export function assembleDocument(
  format: IntakeFormat,
  name: string,
  blocks: ExtractedBlock[],
  warnings: string[] = [],
): ExtractedDocument {
  const text = blocks
    .map((block) => block.originalText)
    .join('\n\n')
    .trim();
  if (text.length > INTAKE_LIMITS.textChars)
    throw new IntakeError(
      'too_large',
      'В документе больше 20 000 символов. Разделите его на отдельные исследования.',
    );
  const { sections, unclassifiedText, unclassifiedAnchors } = splitSections(blocks);
  const unread = blocks.filter((block) => !/[\p{L}\p{N}]/u.test(block.originalText));
  const missingSections = (['description', 'conclusion'] as const).filter(
    (kind) => !sections.some((section) => section.kind === kind && section.text),
  );
  return {
    format,
    name,
    blocks,
    sections,
    unclassifiedText,
    unclassifiedAnchors,
    text,
    warnings: [...new Set([...warnings, ...blocks.flatMap((block) => block.warnings)])],
    unreadPages: unread.flatMap((block) => (block.pageNumber ? [block.pageNumber] : [])),
    unreadAnchors: unread.map((block) => block.anchor),
    missingSections,
    needsCorrection:
      unread.length > 0 || blocks.some((block) => block.confidence !== undefined && block.confidence < 65),
  };
}
