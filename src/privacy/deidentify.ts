export interface DeidentificationResult { text: string; replacements: { kind: string; count: number }[]; limitation: string }

export const DEIDENTIFICATION_LIMITATION = 'Правила и эвристики могут пропустить неизвестное имя, свободный адрес или ошибку OCR и не гарантируют полную анонимность. Проверьте очищенную копию перед отправкой. Анализ загруженного документа доступен только при отдельном разрешении на локальном сервере.';
const NAME_LABEL = String.raw`(?:Ф\.?[ \t]*И\.?[ \t]*О\.?|Фамилия[ \t]+Имя[ \t]+Отчество|Пациент(?:ка)?|Patient(?:[ \t]+name)?)(?:[ \t]+пациента)?`;
const NAME_VALUE = String.raw`[А-ЯЁA-Z][а-яёa-z-]+(?:[ \t]+(?:[А-ЯЁA-Z][а-яёa-z-]+|[А-ЯЁA-Z]\.)){1,2}`;
const NAME_COMPONENT_LABEL = String.raw`(?:Фамилия|Имя|Отчество)(?:[ \t]+пациент(?:а|ки))?`;
const NAME_COMPONENT_VALUE = String.raw`\p{L}[\p{L}'’-]{0,79}`;
const MEDICAL_CONTACT = /^(?:[ \t]*(?:лечащий\s+)?(?:врач|доктор|подписал|клиника|медицинский центр|медцентр|больница|поликлиника|лаборатория)(?=[\s:：])|[ \t]*(?:ФИО|Ф\.?\s*И\.?\s*О\.?|фамилия|имя|отчество|адрес|телефон|email|почта)\s+(?:(?:лечащего\s+)?врача|доктора|клиники|медцентра|лаборатории))/iu;
const PATIENT_FIELD = /(?:пациент|patient|домашн|место жительства|адрес проживания|адрес регистрации)/iu;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

// Context lets a labelled patient name be removed from other sections. The
// mapping stays in this operation and is never sent to the provider or logged.
export function deidentify(input: string, context: string = input): DeidentificationResult {
  const counts = new Map<string, number>();
  const mask = (kind: string) => { counts.set(kind, (counts.get(kind) ?? 0) + 1); return `[удалено: ${kind}]`; };
  const names = new Set<string>();
  for (const line of context.split(/\r?\n/u)) {
    if (MEDICAL_CONTACT.test(line) && !PATIENT_FIELD.test(line)) continue;
    for (const match of line.matchAll(new RegExp(`${NAME_LABEL}[ \\t]*[:：][ \\t]*(${NAME_VALUE})`, 'giu'))) names.add(match[1]);
    for (const match of line.matchAll(new RegExp(`${NAME_COMPONENT_LABEL}[ \\t]*[:：][ \\t]*(${NAME_COMPONENT_VALUE})`, 'giu'))) if (match[1].length > 1) names.add(match[1]);
  }
  const text = input.replace(/\r\n?/gu, '\n').split('\n').map(line => {
    // Explicitly attributed clinic/doctor contact is medical context.
    const medicalContact = MEDICAL_CONTACT.test(line) && !PATIENT_FIELD.test(line);
    let cleaned = line;
    if (!medicalContact) {
      for (const name of names) cleaned = cleaned.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(name)}(?![\\p{L}\\p{N}_])`, 'giu'), () => mask('name'));
      cleaned = cleaned.replace(new RegExp(`(${NAME_LABEL}[ \\t]*[:：][ \\t]*)(${NAME_VALUE})`, 'giu'), (_match, label: string) => label + mask('name'));
      cleaned = cleaned.replace(new RegExp(`(${NAME_COMPONENT_LABEL}[ \\t]*[:：][ \\t]*)(${NAME_COMPONENT_VALUE})`, 'giu'), (_match, label: string) => label + mask('name'));
      cleaned = cleaned.replace(/([А-ЯЁ][а-яё-]+)[ \t]+([А-ЯЁ][а-яё-]+)[ \t]+([А-ЯЁ][а-яё-]+(?:вич|вна|тич|ична))(?=$|[\s,.;])/gu, () => mask('name'));
      cleaned = cleaned.replace(/((?:(?:домашний\s+)?адрес(?:\s+(?:пациента|проживания|регистрации))?|место жительства)[ \t]*[:：][ \t]*)[^;\n]+/giu, (_match, label: string) => label + mask('address'));
      cleaned = cleaned.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, () => mask('email'));
      cleaned = cleaned.replace(/(?<!\d)(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/gu, () => mask('phone'));
    }
    cleaned = cleaned.replace(/((?:паспорт(?:ные данные)?|СНИЛС|полис(?:\s+ОМС|\s+ДМС)?)[ \t]*(?:№|[:：])?[ \t]*)(?:\d[\d -]{5,}\d)/giu, (_match, label: string) => label + mask('identifier'));
    cleaned = cleaned.replace(/((?:ID пациента|Patient ID|номер (?:мед(?:ицинской)?[ \t]*карты|карты пациента))[ \t]*(?:№|[:：])[ \t]*)[\p{L}\p{N}_/-]+/giu, (_match, label: string) => label + mask('identifier'));
    cleaned = cleaned.replace(/((?:дата рождения|д[./]р)[ \t]*[:：]?[ \t]*)\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/giu, (_match, label: string) => label + mask('identifier'));
    cleaned = cleaned.replace(/(?<!\d)\d{3}[- ]\d{3}[- ]\d{3}[ -]\d{2}(?!\d)/gu, () => mask('identifier'));
    return cleaned;
  }).join('\n');
  return { text, replacements: [...counts].map(([kind, count]) => ({ kind, count })), limitation: DEIDENTIFICATION_LIMITATION };
}
