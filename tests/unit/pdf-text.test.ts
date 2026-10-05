import { describe, expect, it } from 'vitest';
import { readablePdfText, type PdfTextItem } from '../../src/features/intake/pdfText';
import { assembleDocument } from '../../src/features/intake/sections';
import { toDocument } from '../../src/features/intake/toDocument';

const item = (str: string, x: number, y: number, width = str.length * 6, hasEOL = false): PdfTextItem => ({
  str, transform: [12, 0, 0, 12, x, y], width, height: 12, hasEOL,
});

describe('PDF reading order and text boundaries', () => {
  it('joins fragments of a word while retaining actual word spaces and line breaks', () => {
    const text = readablePdfText([
      item('Описание', 0, 120, 48), item('исследования:', 52, 120, 78),
      item('Изменений', 0, 100, 54), item('не', 58, 100, 12), item('выявлено.', 74, 100, 54),
      item('Заклю', 0, 80, 30), item('чение', 30, 80, 30), item(':', 60, 80, 6),
      item('Без изменений.', 0, 60),
    ]);
    expect(text).toBe('Описание исследования:\nИзменений не выявлено.\nЗаключение:\nБез изменений.');
    const result = assembleDocument('pdf', 'synthetic.pdf', [{ id: 'page-1', anchor: 'page-1', pageNumber: 1, method: 'native', originalText: text, warnings: [] }]);
    expect(result.sections.map(section => section.kind)).toEqual(['description', 'conclusion']);
  });

  it('preserves explicit spaces, page reading order and numeric punctuation', () => {
    const text = readablePdfText([
      item('Заключение:', 0, 50), item('Без изменений.', 0, 30),
      item('Описание: ', 0, 100, 60), item('Размер ', 60, 100, 42),
      item('4', 102, 100, 6), item(',', 108, 100, 3), item('5', 111, 100, 6), item('мм.', 121, 100, 18),
    ]);
    expect(text).toBe('Описание: Размер 4,5 мм.\nЗаключение:\nБез изменений.');
  });

  it('keeps unclassified PDF text anchored without inventing clinical sections', () => {
    const result = assembleDocument('pdf', 'synthetic.pdf', [
      { id: 'page-1', anchor: 'page-1', pageNumber: 1, method: 'native', originalText: 'Учебный документ без разделов.', warnings: [] },
      { id: 'page-2', anchor: 'page-2', pageNumber: 2, method: 'native', originalText: 'Продолжение без медицинских предположений.', warnings: [] },
    ]);
    const document = toDocument(result, 'local_file');
    expect(document.sections.description).toBe('');
    expect(document.sections.conclusion).toBe('');
    expect(document.sections.other).toContain('Продолжение');
    expect(document.sectionAnchors.other).toEqual(['page-1', 'page-2']);
    expect(document.originalSections).toEqual(document.sections);
    expect(document.blocks.map(block => block.page)).toEqual([1, 2]);
  });
});
