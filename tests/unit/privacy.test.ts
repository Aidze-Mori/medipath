import { describe, expect, it } from 'vitest';
import { confirmDocument, getFixtureDocument, updateDocumentSections } from '../../src/domain';
import { deidentify } from '../../src/privacy/deidentify';
import { prepareDemoRequest, isCurrentDemoResponse, acceptDemoResponse, detectSyntheticFixture } from '../../src/privacy/policy';
import { readFile } from 'node:fs/promises';
import { analyzeLocal } from '../../src/engine';
import { stubExplanation } from './model-response-helper';

describe('fixture-only external boundary', () => {
  it('strips known synthetic identifiers without changing medical qualifiers', () => {
    const result = deidentify('ФИО: Тестов Пациент Примерович\nEmail: canary@example.invalid\nТелефон: +7 (999) 123-45-67\nАдрес: Тестовая улица, 14\nПолис: 1234567890123456\nСправа очаг 4 мм не выявлен.');
    expect(result.text).not.toContain('Тестов');
    expect(result.text).not.toContain('canary');
    expect(result.text).not.toContain('1234567890123456');
    expect(result.text).toContain('Справа очаг 4 мм не выявлен.');
  });
  it('only permits a confirmed canonical built-in variant and binds its current revision', async () => {
    const original = getFixtureDocument('chest-referral');
    expect(await prepareDemoRequest(original)).toBeNull();
    const doc = confirmDocument(original);
    const prepared = await prepareDemoRequest(doc, 'test-request-0001');
    expect(prepared?.request).toEqual({ fixtureId: 'chest-referral', fixtureRevision: 1, reviewVariantId: 'canonical', operation: 'explain', requestId: 'test-request-0001' });
    const changed = confirmDocument(updateDocumentSections(doc, { ...doc.sections, other: 'PRIVATE-CANARY' }));
    expect(await prepareDemoRequest(changed)).toBeNull();
    if (!prepared) throw new Error('missing binding');
    expect(isCurrentDemoResponse(changed, prepared.binding, { binding: { ...prepared.binding, requestId: prepared.request.requestId }, analysis: analyzeLocal(doc) })).toBe(false);
  });
  it('never recognizes pasted medical text as a trusted synthetic origin', async () => {
    const doc = confirmDocument({ ...getFixtureDocument('chest-referral'), origin: 'paste' });
    expect(await prepareDemoRequest(doc)).toBeNull();
  });
  it('supports an OCR correction back to canonical without hiding the new revision', async () => {
    const original = getFixtureDocument('chest-referral');
    const typo = updateDocumentSections(original, { ...original.sections, description: original.sections.description.replace('4 мм', '9 мм') });
    expect(await prepareDemoRequest(confirmDocument(typo))).toBeNull();
    const restored = confirmDocument(updateDocumentSections(typo, original.sections));
    expect((await prepareDemoRequest(restored))?.binding.documentRevision).toBe(3);
  });
  it('rejects stale request IDs, invented deadlines and unsupported model text', async () => {
    const doc = confirmDocument(getFixtureDocument('chest-referral'));
    const prepared = await prepareDemoRequest(doc, 'current-request-01');
    if (!prepared) throw new Error('missing binding');
    const safe = { binding: prepared.binding, analysis: { ...analyzeLocal(doc), llmExplanation: stubExplanation(doc.sections), mode: 'synthetic_live' as const } };
    expect(acceptDemoResponse(doc, prepared.binding, safe)?.mode).toBe('synthetic_live');
    expect(isCurrentDemoResponse(doc, prepared.binding, { ...safe, binding: { ...prepared.binding, requestId: 'stale-request-01' } })).toBe(false);
    expect(acceptDemoResponse(doc, prepared.binding, { ...safe, analysis: { ...safe.analysis, summary: 'Вымышленный диагноз' } })).toBeNull();
    expect(acceptDemoResponse(doc, prepared.binding, { ...safe, analysis: { ...safe.analysis, routeSteps: safe.analysis.routeSteps.map(step => ({ ...step, dueText: 'Сегодня' })) } })).toBeNull();
    expect(acceptDemoResponse(doc, prepared.binding, { ...safe, analysis: { ...safe.analysis, claims: [{ id: 'fake', text: 'Вымышленное объяснение', kind: 'explanation', sourceRefs: [], sourceIds: ['fake-source'], certainty: 'as_written' }] } })).toBeNull();
  });
  it('trusts only complete known synthetic file bytes, never a copied medical fragment', async () => {
    const known = await readFile('public/examples/synthetic-chest-referral.txt');
    expect(await detectSyntheticFixture(Uint8Array.from(known).buffer)).toBe('chest-referral');
    expect(await detectSyntheticFixture(new TextEncoder().encode('PERSONAL-CANARY ' + known.toString()).buffer)).toBeNull();
    expect(await detectSyntheticFixture(new TextEncoder().encode(getFixtureDocument('chest-referral').sections.conclusion).buffer)).toBeNull();
  });
  it('rebinds canonical server evidence to a known extracted file with different anchors and line wraps', async () => {
    const canonical = confirmDocument(getFixtureDocument('chest-referral'));
    const extracted = confirmDocument({ ...canonical, id: 'extracted-document', sections: { ...canonical.sections, recommendations: canonical.sections.recommendations.replaceAll(' ', '\n') }, blocks: [{ id: 'pdf-page-1', text: Object.values(canonical.sections).join('\n'), page: 1 }] });
    const prepared = await prepareDemoRequest(extracted, 'known-file-request-01');
    if (!prepared) throw new Error('binding missing');
    const response = { binding: prepared.binding, analysis: { ...analyzeLocal(canonical), llmExplanation: stubExplanation(canonical.sections), mode: 'synthetic_live' as const } };
    const accepted = acceptDemoResponse(extracted, prepared.binding, response);
    expect(accepted?.documentId).toBe('extracted-document');
    expect(accepted?.routeSteps).toHaveLength(1);
    expect(accepted?.claims.find(claim => claim.id === 'statement-conclusion')?.sourceRefs[0].blockId).toBe('pdf-page-1');
  });
});

describe('patient deidentification before model payload', () => {
  it('masks separate patient name fields and their repeated values while preserving attributed doctor fields', () => {
    const identity = 'Фамилия: Тестова\nИмя: Мария\nОтчество: Петровна\nФамилия врача: Сидоров\nИмя врача: Иван\nОтчество врача: Сергеевич';
    const result = deidentify(`${identity}\nМария Тестова: плевральный выпот не выявлен.`);
    expect(result.text).not.toMatch(/Тестова|Мария|Петровна/);
    expect(result.text).toContain('плевральный выпот не выявлен.');
    expect(result.text).toContain('Фамилия врача: Сидоров');
    expect(result.text).toContain('Имя врача: Иван');
    expect(result.text).toContain('Отчество врача: Сергеевич');
    expect(deidentify('Описание: плевральный выпот не выявлен.\nИмя клиники: Роза', 'Имя: Роза').text).toContain('Имя клиники: Роза');
    expect(deidentify('Признаки фиброза.', 'Имя: Роза').text).toBe('Признаки фиброза.');
  });
  it('preserves doctor names and clinic addresses instead of masking every address', () => {
    const input = 'Врач: Петров Алексей Сергеевич\nФИО врача: Петров Алексей Сергеевич\nАдрес клиники: Москва, ул. Учебная, 5\nТелефон клиники: +7 (495) 000-11-22\nФИО пациента: Иванова Мария Петровна\nДомашний адрес: Москва, ул. Личная, 99';
    const result = deidentify(input);
    expect(result.text).toContain('Врач: Петров Алексей Сергеевич');
    expect(result.text).toContain('ФИО врача: Петров Алексей Сергеевич');
    expect(result.text).toContain('Москва, ул. Учебная, 5');
    expect(result.text).toContain('+7 (495) 000-11-22');
    expect(result.text).not.toContain('Иванова');
    expect(result.text).not.toContain('Личная');
  });
  it('masks passport, SNILS, DOB and patient IDs while preserving study dates and dimensions', () => {
    const result = deidentify('Паспорт: 4510 123456\nСНИЛС: 123-456-789 01\n123-456-789 02\nДата рождения: 12.02.1980\nPatient ID: patient-secret\nИсследование от 04.10.2026: слева 8 × 4 мм; справа очаг не выявлен.');
    expect(result.text).not.toMatch(/4510|123-456|12.02.1980|patient-secret/);
    expect(result.text).toContain('Исследование от 04.10.2026: слева 8 × 4 мм; справа очаг не выявлен.');
  });
  it('uses identity context to mask repeated patient names in another section', async () => {
    const { minimize } = await import('../../src/privacy/minimize');
    const result = minimize({ description: 'Иванова Мария Петровна: справа очаг 4 мм не выявлен.', conclusion: 'Без изменений.', recommendations: '', other: 'ФИО: Иванова Мария Петровна\nАдрес: Личная, 4' });
    expect(JSON.stringify(result.sections)).not.toMatch(/Иванова|Личная/);
    expect(result.sections[0].text).toContain('справа очаг 4 мм не выявлен.');
    expect(result.privacy.replacements.some(change => change.kind === 'name')).toBe(true);
    expect(JSON.stringify(result.privacy)).not.toContain('Иванова');
  });
  it('does not treat a generic reference to a doctor as a clinic identity field', () => {
    const result = deidentify('Консультация врача. ФИО: Иванова Мария Петровна\nРезультат необходимо показать врачу. patient@example.invalid');
    expect(result.text).not.toMatch(/Иванова|patient@example/);
  });
  it('masks patient contacts but preserves numeric medical details', () => {
    const result = deidentify('Телефон: 8 999 123 45 67; Email: person@example.invalid\nПлотность -12 HU, справа 4 мм, давление 120/80, пульс 72.');
    expect(result.text).not.toMatch(/999|person@example/);
    expect(result.text).toContain('Плотность -12 HU, справа 4 мм, давление 120/80, пульс 72.');
  });
});

describe('clinic source binding', () => {
  it('allows a validated structured source without recording patient OCR confirmation', async () => {
    const { createClinicDocument } = await import('../../src/domain');
    const document = createClinicDocument('chest-referral');
    expect(document.confirmedRevision).toBeNull();
    const prepared = await prepareDemoRequest(document, 'clinic-source-request-01');
    expect(prepared?.request.fixtureId).toBe('chest-referral');
    if (!prepared) throw new Error('missing source binding');
    const response = { binding: prepared.binding, analysis: { ...analyzeLocal(document), llmExplanation: stubExplanation(document.sections), mode: 'synthetic_live' as const } };
    expect(acceptDemoResponse(document, prepared.binding, response)?.mode).toBe('synthetic_live');
    expect(await prepareDemoRequest({ ...document, sourceValidation: undefined })).toBeNull();
    expect(await prepareDemoRequest({ ...document, sourceValidation: { ...document.sourceValidation!, sourceRevision: 99 } })).toBeNull();
    expect(await prepareDemoRequest(updateDocumentSections(document, { ...document.sections, conclusion: 'Другой текст' }))).toBeNull();
  });
});

describe('medical context after patient identifiers', () => {
  it('does not swallow the medical sentence after a labelled identifier', () => {
    const input = 'Паспорт: 4510 123456. Справа очаг 4 мм не выявлен.\nДата рождения: 12.02.1980. Рост 170 см.\nПолис ОМС 1234567890123456; контроль по рекомендации врача.';
    const result = deidentify(input);
    expect(result.text).not.toMatch(/4510|123456|12.02.1980/);
    expect(result.text).toContain('Справа очаг 4 мм не выявлен.');
    expect(result.text).toContain('Рост 170 см.');
    expect(result.text).toContain('контроль по рекомендации врача.');
  });
});
