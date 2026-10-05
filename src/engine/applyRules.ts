import { sourceAnchor, type DocumentRecord, type RouteStep, type SectionKind, type SpecialtyId } from '../domain';

const SPECIALTIES: { id: SpecialtyId; expression: RegExp; label: string }[] = [
  { id: 'pulmonology', expression: /пульмонолог[а-я]*/iu, label: 'Консультация пульмонолога' },
  { id: 'mammology', expression: /маммолог[а-я]*/iu, label: 'Консультация маммолога' },
  { id: 'oncology', expression: /онколог[а-я]*/iu, label: 'Консультация онколога' },
  { id: 'therapy', expression: /терапевт[а-я]*/iu, label: 'Консультация терапевта' },
];
const NEGATED = /не\s+(?:рекоменд|треб|нуж|показан|необходим|следует|провод|назнач|актуал|обязательн|целесообраз)|нет\s+(?:необходимости|показаний|нужды)|(?:необходимост[ьи]|показани[яй])\s+(?:нет|отсутств)|отсутству[а-я]*\s+(?:необходимост|показани)|противопоказан/iu;
const CONDITIONAL = /при\s+(?:необходимости|наличии|сохранении|появлении|ухудшении|условии)|в\s+случае|если\s|по\s+показаниям|(?<!\p{L})(?:возможно|возможна|или|либо)(?!\p{L})/iu;
const HISTORICAL_OR_QUOTED = /ранее|в\s+прошлом|(?<!\p{L})уже(?!\p{L})|выполнен|пройден|(?<!\p{L})провед[её]н(?:а|о|ы|н[а-яё]*)?(?!\p{L})|отмен[её]н|[«»"]/iu;
const SPECIALIST_NAMES = '(?:пульмонолог[ау]|маммолог[ау]|онколог[ау]|терапевт[ау])';
// Supported syntax is deliberately narrow. A specialist mentioned later in a sentence is not a referral.
const DIRECT_CONSULTATION = new RegExp(`^(?:пациенту\\s+)?(?:(?:рекомендована|показана|необходима|назначена)\\s+(?:очная\\s+)?консультация|(?:рекомендованы|показаны|необходимы|назначены)\\s+консультации)\\s+(${SPECIALIST_NAMES}(?:(?:\\s*,\\s*|\\s+и\\s+|\\s+а\\s+также\\s+)${SPECIALIST_NAMES})*)(?!\\p{L})`, 'iu');
const DIRECT_TRANSFER = new RegExp(`^(?:пациент\\s+|пациентка\\s+)?направлен(?:а)?\\s+к\\s+(${SPECIALIST_NAMES})(?!\\p{L})`, 'iu');
const SUPPORTED_DEADLINE = /^(?:(?:в\s+течение|через)\s+\d+(?:\s*[-–]\s*\d+)?\s+(?:день|дня|дней|неделю|недели|недель|месяц|месяца|месяцев|час|часа|часов|сутки|суток)|до\s+\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)$/iu;
const SUPPORTED_CONTEXT = new RegExp(`^по\\s+поводу\\s+заключения\\s+${SPECIALIST_NAMES}$`, 'iu');
const EMERGENCY_MENTION = /(?:немедленно|экстренно|срочно)\s+обратиться/iu;
const DIRECT_EMERGENCY = /^(?:немедленно|экстренно|срочно)\s+обратиться\s+(?:за\s+(?:экстренной|неотложной)\s+медицинской\s+помощью|к\s+врачу)[.!]?$/iu;
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/u).map(value => value.trim()).filter(Boolean);

function readReferral(sentence: string): { specialties: typeof SPECIALTIES; dueText: string | null } | null {
  if (NEGATED.test(sentence) || CONDITIONAL.test(sentence) || HISTORICAL_OR_QUOTED.test(sentence)) return null;
  const match = sentence.match(DIRECT_CONSULTATION) ?? sentence.match(DIRECT_TRANSFER);
  if (!match) return null;
  const tail = sentence.slice(match[0].length).trim().replace(/\.$/u, '').trim();
  if (tail && !SUPPORTED_DEADLINE.test(tail) && !SUPPORTED_CONTEXT.test(tail)) return null;
  return { specialties: SPECIALTIES.filter(specialty => specialty.expression.test(match[1])), dueText: SUPPORTED_DEADLINE.test(tail) ? tail : null };
}

export function hasUnresolvedReferral(document: DocumentRecord): boolean {
  const text = Object.values(document.sections).join('\n');
  const mentionsAction = /консультац|направлен/iu.test(text) || EMERGENCY_MENTION.test(text);
  // Pronouns and omitted specialties may carry a cancellation into the next sentence or section.
  // Without a language parser we cannot safely assign its scope, so withhold every new action.
  if (mentionsAction && (NEGATED.test(text) || CONDITIONAL.test(text) || HISTORICAL_OR_QUOTED.test(text))) return true;
  return [document.sections.conclusion, document.sections.recommendations].some(section => {
    const lines = sentences(section);
    return lines.some(line => EMERGENCY_MENTION.test(line) ? !DIRECT_EMERGENCY.test(line) : /консультац|направлен/iu.test(line) && SPECIALTIES.some(specialty => specialty.expression.test(line)) && !readReferral(line));
  });
}

export function hasSourceConflict(document: DocumentRecord): boolean {
  const { description, conclusion } = document.sections;
  if (/противоречи|несогласован/iu.test(`${description} ${conclusion}`)) return true;
  const directions = sentences(`${conclusion}\n${document.sections.recommendations}`);
  if (SPECIALTIES.some(specialty => directions.some(line => specialty.expression.test(line) && NEGATED.test(line)) && directions.some(line => readReferral(line)?.specialties.some(named => named.id === specialty.id)))) return true;
  const side = (text: string) => /справа|правого|правой/iu.test(text) ? 'right' : /слева|левого|левой/iu.test(text) ? 'left' : '';
  const first = side(description), second = side(conclusion);
  // Only the deliberately narrow same-finding pattern is detected; this is not a clinical conflict detector.
  return /очаг/iu.test(description) && /очаг/iu.test(conclusion) && Boolean(first && second && first !== second);
}

export function applyRules(document: DocumentRecord): RouteStep[] {
  if (hasUnresolvedReferral(document)) return [];
  // Carry through a source's explicit emergency instruction before considering routine booking.
  for (const kind of ['recommendations', 'conclusion'] as SectionKind[]) {
    for (const sentence of sentences(document.sections[kind])) {
      if (DIRECT_EMERGENCY.test(sentence)) {
        return [{ id: `${document.id}:r${document.revision}:urgent`, actionId: 'source-urgent-instruction', specialtyId: null, basis: 'explicit_document', title: 'Сохранено экстренное указание исходника', explanation: 'В исходном тексте есть прямое экстренное указание. Плановый слот не заменяет это указание; приложение не выполняет самостоятельную оценку срочности.', sourceRefs: [sourceAnchor(document, kind, sentence)], dueText: sentence, dueAt: null, bookingAllowed: false }];
      }
    }
  }
  if (hasSourceConflict(document)) return [];
  const steps: RouteStep[] = [];
  for (const kind of ['recommendations', 'conclusion'] as SectionKind[]) {
    for (const sentence of sentences(document.sections[kind])) {
      const referral = readReferral(sentence);
      if (!referral) continue;
      for (const specialty of referral.specialties) {
        if (steps.some(step => step.specialtyId === specialty.id)) continue;
        const dueText = referral.dueText;
        steps.push({ id: `${document.id}:r${document.revision}:${specialty.id}`, actionId: `consult-${specialty.id}`, specialtyId: specialty.id, basis: 'explicit_document', title: specialty.label, explanation: 'Специальность прямо указана в подтверждённом документе. MediPath переносит это направление в организационный выбор врача и не создаёт новое медицинское назначение.', sourceRefs: [sourceAnchor(document, kind, sentence)], dueText, dueAt: null, bookingAllowed: true });
      }
    }
  }
  return steps;
}
