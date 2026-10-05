import { createDocument } from '../../domain';
import type { DocumentOrigin, DocumentSections, SectionKind } from '../../domain';
import type { ExtractedDocument } from './types';
import { isMetadataHeading } from './sections';

export function toDocument(result: ExtractedDocument, origin: DocumentOrigin, fixtureId?: string) {
  const sections: DocumentSections = { description: '', conclusion: '', recommendations: '', other: '' };
  const sectionAnchors: Partial<Record<SectionKind, string[]>> = {};
  for (const part of result.sections) {
    const kind = part.kind === 'history' ? 'other' : part.kind;
    const value = isMetadataHeading(part.heading) ? `${part.heading}: ${part.text}` : part.text;
    sections[kind] += (sections[kind] ? '\n\n' : '') + value;
    sectionAnchors[kind] = [...new Set([...(sectionAnchors[kind] ?? []), ...part.anchors])];
  }
  if (result.unclassifiedText) {
    sections.other = result.unclassifiedText + (sections.other ? `\n\n${sections.other}` : '');
    sectionAnchors.other = [...new Set([...(sectionAnchors.other ?? []), ...(result.unclassifiedAnchors ?? [])])];
  }
  return createDocument({
    sections,
    sectionAnchors,
    origin,
    ...(fixtureId ? { fixtureId } : {}),
    blocks: result.blocks.map((block) => ({
      id: block.id,
      text: block.originalText,
      ...(block.pageNumber ? { page: block.pageNumber } : {}),
    })),
    unreadPages: result.unreadPages,
    extractionStatus: result.unreadAnchors.length ? 'failed' : 'ready',
  });
}
