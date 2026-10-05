import { describe, expect, it } from 'vitest';
import { confirmDocument, createDocument, sourceAnchor, updateDocumentSections } from '../../src/domain';
import { analyzeLocal } from '../../src/engine';
import { validateAnalysisEvidence } from '../../src/engine/validateEvidence';

const sections = (recommendations: string) => ({ description: '', conclusion: '', recommendations, other: '' });

describe('conservative referral revisions', () => {
  it('does not interpret clinic metadata about the study location as a completed referral', () => {
    const document = createDocument({ sections: {
      ...sections('Рекомендована консультация пульмонолога в течение 2 недель.'),
      other: 'Место проведения: Учебная клиника. Дата проведения исследования: 05.10.2026.',
    } });
    const result = analyzeLocal(confirmDocument(document));
    expect(result.routeSteps).toHaveLength(1);
    expect(result.routeSteps[0]).toMatchObject({ specialtyId: 'pulmonology', dueText: 'в течение 2 недель' });
  });

  it.each(['Проведена консультация.', 'Осмотр проведён.', 'Обследование проведено.', 'Консультации проведены.',
    'По результатам проведённой консультации дополнительных назначений нет.', 'Проведённая консультация завершена.'])(
    'keeps actual completed-event inflections conservative: %s', completion => {
      const result = analyzeLocal(confirmDocument(createDocument({ sections: sections(`Рекомендована консультация пульмонолога. ${completion}`) })));
      expect(result.routeSteps).toEqual([]);
      expect(result.processingStatus).toBe('needs_review');
    },
  );

  it.each([
    'Рекомендована консультация пульмонолога. В настоящее время не требуется.',
    'Рекомендована консультация пульмонолога. Консультация уже выполнена.',
    'Рекомендована консультация пульмонолога. Она отменена.',
    'Рекомендована консультация пульмонолога. Она не обязательна.',
  ])('requires review for a following cancellation without a repeated specialty: %s', recommendations => {
    const result = analyzeLocal(confirmDocument(createDocument({ sections: sections(recommendations) })));
    expect(result.routeSteps).toEqual([]);
    expect(result.processingStatus).toBe('needs_review');
  });

  it('does not lose a cancellation when the recommendation and its qualifier span sections', () => {
    const document = createDocument({ sections: { ...sections('Рекомендована консультация пульмонолога.'), conclusion: 'Консультация уже выполнена.' } });
    const result = analyzeLocal(confirmDocument(document));
    expect(result.routeSteps).toEqual([]);
    expect(result.processingStatus).toBe('needs_review');
  });

  it.each(['description', 'other'] as const)('also respects a cancellation retained in the %s section', kind => {
    const document = createDocument({ sections: { ...sections('Рекомендована консультация пульмонолога.'), [kind]: 'Консультация уже выполнена.' } });
    const result = analyzeLocal(confirmDocument(document));
    expect(result.routeSteps).toEqual([]);
    expect(result.processingStatus).toBe('needs_review');
  });

  it.each(['через 3–6 месяцев', 'через 3 - 6 месяцев', 'через 2–3 недели'])('preserves the supported deadline exactly: %s', dueText => {
    const document = createDocument({ sections: sections(`Рекомендована консультация пульмонолога ${dueText}.`) });
    expect(analyzeLocal(confirmDocument(document)).routeSteps[0]?.dueText).toBe(dueText);
  });

  it.each([
    'Срочно обратиться к врачу не обязательно.',
    'Немедленно обратиться за экстренной медицинской помощью только после консультации.',
    'Немедленно обратиться за экстренной медицинской помощью. Это указание отменено.',
    'Срочно обратиться к врачу. Уже выполнено.',
  ])('does not escalate negated, completed or unsupported emergency wording: %s', recommendations => {
    const result = analyzeLocal(confirmDocument(createDocument({ sections: sections(recommendations) })));
    expect(result.routeSteps).toEqual([]);
    expect(result.processingStatus).toBe('needs_review');
  });
});

describe('source attribution after corrections', () => {
  it('rejects a live result that changes the source location while keeping the quote', () => {
    const document = confirmDocument(createDocument({ sections: sections('Рекомендована консультация пульмонолога.') }));
    const analysis = { ...analyzeLocal(document), mode: 'synthetic_live' as const };
    const forged = { ...analysis, routeSteps: analysis.routeSteps.map(step => ({ ...step, sourceRefs: step.sourceRefs.map(anchor => ({ ...anchor, page: 99, corrected: true as const, revision: 999 })) })) };
    expect(validateAnalysisEvidence(forged, document)).toBe(false);
  });

  it('keeps the known source page while distinguishing the corrected quotation', () => {
    const original = 'Рекомендована консультация пульмонолога через 2 недели.';
    const document = createDocument({ sections: sections(original), blocks: [{ id: 'page-1', text: 'Описание.', page: 1 }, { id: 'page-2', text: original, page: 2 }] });
    const corrected = original.replace('2 недели', '3 недели');
    const edited = confirmDocument(updateDocumentSections(document, sections(corrected)));
    expect(analyzeLocal(edited).routeSteps[0].sourceRefs[0]).toEqual({
      blockId: 'page-2', page: 2, quote: corrected, corrected: true, revision: 2,
      originalAnchors: [{ blockId: 'page-2', page: 2 }],
    });
  });

  it('preserves every known section anchor without guessing which page contains the new sentence', () => {
    const document = createDocument({
      sections: sections('Рекомендована консультация\nпульмонолога через 2 недели.'),
      blocks: [{ id: 'page-2', text: 'Рекомендации: Рекомендована консультация', page: 2 }, { id: 'page-3', text: 'пульмонолога через 2 недели.', page: 3 }],
      sectionAnchors: { recommendations: ['page-2', 'page-3'] },
    });
    const corrected = 'Рекомендована консультация пульмонолога через 3 недели.';
    const edited = updateDocumentSections(document, sections(corrected));
    const anchor = sourceAnchor(edited, 'recommendations', corrected);
    expect(edited.sectionAnchors).toEqual({ recommendations: ['page-2', 'page-3'] });
    expect(anchor).toEqual({ blockId: 'recommendations', quote: corrected, corrected: true, revision: 2, originalAnchors: [{ blockId: 'page-2', page: 2 }, { blockId: 'page-3', page: 3 }] });
    expect(anchor.page).toBeUndefined();
  });

  it('marks newly authored text without inventing an original location', () => {
    const document = createDocument({ sections: sections(''), blocks: [{ id: 'page-1', text: 'Описание.', page: 1 }] });
    const corrected = 'Рекомендована консультация пульмонолога.';
    const edited = updateDocumentSections(document, sections(corrected));
    expect(sourceAnchor(edited, 'recommendations', corrected)).toEqual({ blockId: 'recommendations', quote: corrected, corrected: true, revision: 2, userAuthored: true });
  });

  it('does not associate corrected text with an identical sentence in an unrelated section', () => {
    const other = 'Рекомендована консультация пульмонолога через 3 недели.';
    const original = 'Рекомендована консультация пульмонолога через 2 недели.';
    const document = createDocument({ sections: { ...sections(original), other }, blocks: [{ id: 'page-1', text: other, page: 1 }, { id: 'page-2', text: original, page: 2 }], sectionAnchors: { recommendations: ['page-2'], other: ['page-1'] } });
    const edited = updateDocumentSections(document, { ...document.sections, recommendations: other });
    expect(sourceAnchor(edited, 'recommendations', other).originalAnchors).toEqual([{ blockId: 'page-2', page: 2 }]);
  });
});
