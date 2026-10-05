import type { DocumentSections } from '../../src/domain';

/** Provider stub data, never used by the application as a live response. */
export function stubExplanation(sections: DocumentSections) {
  const findings = (['description', 'conclusion', 'recommendations'] as const).filter(id => sections[id].length >= 8).map(sectionId => ({ sectionId, quote: sections[sectionId], explanation: sections[sectionId] }));
  return { summary: sections.conclusion || findings[0].quote, findings };
}
