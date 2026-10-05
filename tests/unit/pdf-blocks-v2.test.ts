import { describe, expect, it } from 'vitest';
import { assembleDocument, reviewContextFields } from '../../src/features/intake/sections';
import { readablePdfText, type PdfTextItem } from '../../src/features/intake/pdfText';
import { toDocument } from '../../src/features/intake/toDocument';

const parsed = (text: string) => assembleDocument('pdf', 'synthetic-radiology.pdf', [{
  id: 'page-1', anchor: 'page-1', pageNumber: 1, method: 'native', originalText: text, warnings: [],
}]);
const item = (str: string, x: number, y: number, width = str.length * 6): PdfTextItem => ({
  str, transform: [12, 0, 0, 12, x, y], width, height: 12, hasEOL: false,
});

describe('radiology PDF block extraction v2', () => {
  it('recognizes form labels, study metadata and unpunctuated clinical headings', () => {
    const result = parsed('Результат лучевой диагностики\nМесто проведения: Учебный диагностический центр\nДата проведения исследования: 05.10.2026\nНаименование исследования: КТ головного мозга\nОписание исследования Центральные структуры мозга не смещены.\nЗаключение КТ-признаков кровоизлияния не выявлено.\nРекомендации Дополнительное обследование не требуется.');
    expect(result.sections.map(section => section.kind)).toEqual(['other', 'other', 'other', 'description', 'conclusion', 'recommendations']);
    expect(result.sections.find(section => section.kind === 'recommendations')?.text).toBe('Дополнительное обследование не требуется.');
    const document = toDocument(result, 'local_file');
    expect(document.sections.other).toContain('Место проведения: Учебный диагностический центр');
    expect(document.sections.other).toContain('Дата проведения исследования: 05.10.2026');
    expect(document.sections.conclusion).toBe('КТ-признаков кровоизлияния не выявлено.');
    expect(document.sectionAnchors.recommendations).toEqual(['page-1']);
  });

  it('joins only explicit wrapped labels, preserving paragraphs, numbers and negative words', () => {
    const result = parsed('Описание результатов\nисследования:\nСрединные структуры не смещены.\n\nЖелудочки: ширина третьего — до 3 мм.\nЗаключение исследования\nИзменений не выявлено.\nРекомендации по дальнейшему\nобследованию:\nДообследование не требуется.');
    expect(result.sections.map(section => section.kind)).toEqual(['description', 'conclusion', 'recommendations']);
    expect(result.sections[0].text).toBe('Срединные структуры не смещены.\n\nЖелудочки: ширина третьего — до 3 мм.');
    expect(result.sections[2].text).toBe('Дообследование не требуется.');
  });

  it('preserves tabular geometry so unpunctuated labels and values can be separated', () => {
    const text = readablePdfText([
      item('Место проведения', 0, 160, 96), item('Учебный центр', 180, 160),
      item('Описание', 0, 120, 48), item('Структуры не смещены.', 180, 120),
      item('Заклю', 0, 80, 30), item('чение', 30, 80, 30), item('не выявлено изменений.', 180, 80),
      item('Рекомендации', 0, 40, 72), item('дообследование не требуется.', 180, 40),
    ]);
    const result = parsed(text);
    expect(result.sections.map(section => section.kind)).toEqual(['other', 'description', 'conclusion', 'recommendations']);
    expect(result.sections[2].text).toBe('не выявлено изменений.');
    expect(result.sections[3].text).toBe('дообследование не требуется.');
  });

  it('keeps quoted/prose heading mentions and unknown anatomy in their original section', () => {
    const text = 'Получено заключение врача. Описание исследования отсутствует.\nСведения об исследовании без известных заголовков.\nОписание:\nЛёгкие: без изменений.\nРекомендации врача не представлены.\nЗаключение:\nСравнить с предыдущими данными.';
    const result = parsed(text);
    expect(result.sections.map(section => section.kind)).toEqual(['description', 'conclusion']);
    expect(result.sections[0].text).toContain('Рекомендации врача не представлены.');
    expect(result.unclassifiedText).toContain('Сведения об исследовании без известных заголовков.');
  });

  it('does not merge small-font footnotes into neighboring baselines', () => {
    const text = readablePdfText([
      { ...item('Заключение:', 0, 50, 50), height: 7, transform: [7, 0, 0, 7, 0, 50] },
      { ...item('Без изменений.', 0, 47.5, 60), height: 7, transform: [7, 0, 0, 7, 0, 47.5] },
    ]);
    expect(text).toBe('Заключение:\nБез изменений.');
  });

  it('edits a metadata block without dropping its label, unknown context or adjacent fields', () => {
    const original = 'Неизвестная шапка.\n\nМесто проведения: Учебный центр\n\nДата исследования: 05.10.2026\n\nНомер протокола: 123';
    const fields = reviewContextFields(original);
    expect(fields.map(field => field.heading)).toEqual(['Другой контекст', 'Место проведения', 'Дата исследования', 'Номер протокола']);
    const date = fields[2];
    const edited = original.slice(0, date.start) + '06.10.2026' + original.slice(date.end);
    expect(edited).toBe(original.replace('05.10.2026', '06.10.2026'));
    expect(reviewContextFields(edited)[2].text).toBe('06.10.2026');
  });
});
