import { describe, expect, it } from 'vitest';
import { confirmDocument, getFixtureDocument } from '../../src/domain';
import { analyzeLocal } from '../../src/engine';
import { createDemoNotification, createStaffFeedback, NOTIFICATION_REASONS, updateFeedbackStatus } from '../../src/features/clinic/demoState';

describe('clinic demo notification and feedback state', () => {
  it('creates an explicit, idempotent notification and does not mark it opened', () => {
    const input = { fixtureId: 'chest-referral', revision: 1, channel: 'sms', reason: 'result_ready' } as const;
    const created = createDemoNotification([], input);
    const duplicate = createDemoNotification(created, input);
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0].id).toBe(created[0].id);
    expect(duplicate[0].openedAt).toBeNull();
    expect(createDemoNotification(created, { ...input, revision: 2 })).toHaveLength(2);
    expect(Object.values(NOTIFICATION_REASONS).every((item) => !/пульмонолог|диагноз|паспорт|ФИО/i.test(item.body))).toBe(true);
  });
  it('binds a staff comment to the exact document and source without claiming clinical review', () => {
    const document = confirmDocument(getFixtureDocument('chest-referral'));
    const analysis = analyzeLocal(document);
    const feedback = createStaffFeedback({ document, analysis, role: 'doctor', category: 'source', comment: 'Проверить формулировку источника', fragment: analysis.claims[0].id });
    expect(feedback).toMatchObject({ documentId: document.id, documentRevision: 1, status: 'new', resolution: '', sourceIds: analysis.claims[0].sourceIds, fragment: analysis.claims[0].text });
    expect(feedback.model).toContain('LLM не вызывалась');
    expect(analysis.clinicalReviewed).toBe(false);
    const reviewing = updateFeedbackStatus(feedback, 'reviewing');
    expect(reviewing.status).toBe('reviewing');
    expect(feedback.status).toBe('new');
    expect(() => updateFeedbackStatus(reviewing, 'closed')).toThrow('результат разбора');
    expect(updateFeedbackStatus(reviewing, 'closed', 'Проверено в учебном примере').status).toBe('closed');
  });
  it('rejects stale or mismatched feedback binding', () => {
    const document = confirmDocument(getFixtureDocument('chest-referral'));
    const analysis = analyzeLocal(document);
    const input = { document, analysis, role: 'administrator', category: 'text', comment: 'Уточнить текст', fragment: '' } as const;
    expect(() => createStaffFeedback({ ...input, analysis: { ...analysis, documentRevision: 2 } })).toThrow('актуальное');
    expect(() => createStaffFeedback({ ...input, comment: '  ' })).toThrow('комментарий');
    expect(() => createStaffFeedback({ ...input, fragment: 'missing' })).toThrow('фрагмент');
  });
});
