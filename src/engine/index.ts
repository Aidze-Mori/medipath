import { isReadyForAnalysis, sourceAnchor, type Analysis, type DocumentRecord, type SectionKind } from '../domain';
import { applyRules, hasSourceConflict, hasUnresolvedReferral } from './applyRules';
import { CORPUS_LIMITATIONS, CORPUS_VERSION } from './retrieve';
import { clinicalDemoRoutes, getClinicalDemo } from './clinicalDemo';
export * from './retrieve';
export * from './applyRules';
export * from './replay';
export * from './clinicalDemo';
export * from './documentNextStep';

export function analyzeLocal(document: DocumentRecord): Analysis {
  if (!isReadyForAnalysis(document)) throw new Error('Сначала подтвердите текущую редакцию текста.');
  const clinicalDemo = getClinicalDemo(document);
  const explicitRoutes = applyRules(document);
  const routeSteps = explicitRoutes.length || !clinicalDemo ? explicitRoutes : clinicalDemoRoutes(document, clinicalDemo);
  const conflict = hasSourceConflict(document);
  const unresolved = hasUnresolvedReferral(document);
  const claims = (['conclusion', 'recommendations', 'description'] as SectionKind[])
    .filter(kind => document.sections[kind].trim())
    .map(kind => ({ id: `statement-${kind}`, text: document.sections[kind], kind: 'document_statement' as const, sourceRefs: [sourceAnchor(document, kind, document.sections[kind])], sourceIds: ['confirmed-document'], certainty: 'as_written' as const }));
  return {
    documentId: document.id, documentRevision: document.revision, corpusVersion: CORPUS_VERSION,
    mode: 'personal_local',
    processingStatus: conflict || unresolved ? 'needs_review' : routeSteps.length ? (document.missingSections.length ? 'partial' : 'complete') : 'insufficient',
    summary: document.sections.conclusion.trim() ? `В заключении указано: «${document.sections.conclusion.trim()}»` : 'Заключение отсутствует. Недостающие сведения не восстановлены по догадке.',
    claims, routeSteps,
    warnings: [...CORPUS_LIMITATIONS, ...(conflict ? ['В описании и заключении обнаружено возможное противоречие. Сверьте исходник; новый маршрут не построен.'] : []), ...(unresolved ? ['Формулировка о консультации содержит отрицание, условие, историю или не входит в поддержанный явный формат. Новый маршрут не построен; уточните актуальное направление.'] : []), ...(!routeSteps.length ? ['Явного допустимого направления нет. Специальность и срок не выбраны по предположению.'] : []), ...document.missingSections.map(kind => `Раздел «${kind === 'description' ? 'Описание' : 'Заключение'}» отсутствует.`)],
    clinicalReviewed: false,
    ...(clinicalDemo ? { clinicalDemo, warnings: ['Подготовленный учебный клинический сценарий. Источник проверен технически; врачебная валидация не выполнена. Предложения требуют проверки врачом и не применяются автоматически к другим документам.'] } : {}),
  };
}
