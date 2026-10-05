export type ProcessingMode = 'personal_local' | 'synthetic_live' | 'synthetic_replay' | 'anonymized_live';
export type DocumentOrigin = 'builtin_fixture' | 'local_file' | 'paste' | 'clinic_adapter';
export type SectionKind = 'description' | 'conclusion' | 'recommendations' | 'other';
export type DocumentSections = Record<SectionKind, string>;
export type SectionAnchors = Partial<Record<SectionKind, string[]>>;
export interface SourceBlock { id: string; text: string; page?: number; paragraph?: number }
export interface SourceLocation { blockId: string; page?: number; paragraph?: number }
export interface SourceAnchor extends SourceLocation {
  quote: string; corrected?: true; revision?: number;
  originalAnchors?: SourceLocation[]; userAuthored?: true;
}
export interface StudyMetadata {
  studyId: string; studyName: string; equipment: string | null; performedAt: string; publishedAt: string;
  source: 'synthetic_clinic_adapter'; sourceLabel: string; clinicName: string;
}
export interface DocumentRecord {
  id: string; revision: number; origin: DocumentOrigin; mode: ProcessingMode;
  blocks: SourceBlock[]; sections: DocumentSections; originalSections: DocumentSections; sectionAnchors: SectionAnchors;
  unclassifiedText: string; missingSections: SectionKind[]; unreadPages: number[];
  extractionStatus: 'ready' | 'reading' | 'failed'; confirmedRevision: number | null;
  confirmedAt: string | null; fixtureId?: string;
  sourceValidation?: { kind: 'clinic_source_validated'; fixtureId: string; sourceRevision: number; validatedAt: string; studyAdapter?: 'third_opinion_demo' };
  studyMetadata?: StudyMetadata;
}
export interface CreateDocumentInput {
  sections: DocumentSections; blocks?: SourceBlock[]; sectionAnchors?: SectionAnchors; origin?: DocumentOrigin;
  fixtureId?: string; unreadPages?: number[]; extractionStatus?: DocumentRecord['extractionStatus'];
}
export const SECTION_KINDS: SectionKind[] = ['description', 'conclusion', 'recommendations', 'other'];
export function createDocument(input: CreateDocumentInput): DocumentRecord {
  const blocks = input.blocks ?? SECTION_KINDS.filter(kind => input.sections[kind]).map(kind => ({ id: kind, text: input.sections[kind] }));
  const sectionAnchors: SectionAnchors = {};
  for (const kind of SECTION_KINDS) {
    const explicit = input.sectionAnchors?.[kind];
    const ids = explicit ?? (input.sections[kind].trim() ? blocks.filter(block => block.text.includes(input.sections[kind])).map(block => block.id) : []);
    const known = [...new Set(ids)].filter(id => blocks.some(block => block.id === id));
    if (known.length) sectionAnchors[kind] = known;
  }
  return {
    id: crypto.randomUUID(), revision: 1, origin: input.origin ?? 'paste', mode: 'personal_local',
    sections: { ...input.sections }, originalSections: { ...input.sections },
    blocks, sectionAnchors,
    unclassifiedText: input.sections.other,
    missingSections: (['description', 'conclusion'] as SectionKind[]).filter(kind => !input.sections[kind].trim()),
    unreadPages: input.unreadPages ?? [], extractionStatus: input.extractionStatus ?? 'ready',
    confirmedRevision: null, confirmedAt: null, ...(input.fixtureId ? { fixtureId: input.fixtureId } : {}),
  };
}
export function updateDocumentSections(document: DocumentRecord, sections: DocumentSections): DocumentRecord {
  if (SECTION_KINDS.every(kind => document.sections[kind] === sections[kind])) return document;
  return {
    ...document, revision: document.revision + 1, sections: { ...sections },
    origin: document.origin === 'clinic_adapter' ? 'local_file' : document.origin,
    unclassifiedText: sections.other, mode: 'personal_local',
    missingSections: (['description', 'conclusion'] as SectionKind[]).filter(kind => !sections[kind].trim()),
    confirmedRevision: null, confirmedAt: null,
    sourceValidation: undefined,
  };
}
export function confirmDocument(document: DocumentRecord): DocumentRecord {
  if (document.extractionStatus !== 'ready' || document.unreadPages.length) {
    throw new Error('Завершите чтение всех страниц перед подтверждением.');
  }
  if (!SECTION_KINDS.some(kind => document.sections[kind].trim())) throw new Error('В документе нет текста для подтверждения.');
  return { ...document, confirmedRevision: document.revision, confirmedAt: new Date().toISOString() };
}
export function isConfirmed(document: DocumentRecord): boolean {
  return document.confirmedRevision === document.revision && document.confirmedAt !== null && document.extractionStatus === 'ready' && document.unreadPages.length === 0;
}
export function sourceAnchor(document: DocumentRecord, kind: SectionKind, quote: string): SourceAnchor {
  const location = (block: SourceBlock): SourceLocation => ({ blockId: block.id, ...(block.page ? { page: block.page } : {}), ...(block.paragraph ? { paragraph: block.paragraph } : {}) });
  const originalBlocks = (document.sectionAnchors[kind] ?? []).flatMap(id => document.blocks.filter(block => block.id === id));
  const corrected = document.sections[kind] !== document.originalSections[kind];
  // A corrected quote is never located by matching its new text against unrelated original pages.
  if (corrected) {
    const originalAnchors = originalBlocks.map(location);
    return {
      ...(originalAnchors.length === 1 ? originalAnchors[0] : { blockId: kind }),
      quote, corrected: true, revision: document.revision,
      ...(originalAnchors.length ? { originalAnchors } : { userAuthored: true }),
    };
  }
  const exactBlocks = (originalBlocks.length ? originalBlocks : document.blocks).filter(block => quote && block.text.includes(quote));
  if (exactBlocks.length === 1) return { ...location(exactBlocks[0]), quote };
  const originalAnchors = (exactBlocks.length ? exactBlocks : originalBlocks).map(location);
  return { blockId: kind, quote, ...(originalAnchors.length ? { originalAnchors } : {}) };
}
