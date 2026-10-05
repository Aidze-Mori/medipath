import type { DocumentSections } from '../domain';
import { deidentify, type DeidentificationResult } from './deidentify';

export interface ModelSection { id: 'description' | 'conclusion' | 'recommendations'; text: string }
export function minimize(sections: DocumentSections): { sections: ModelSection[]; removedFields: string[]; privacy: Omit<DeidentificationResult, 'text'> } {
  const context = Object.values(sections).join('\n');
  const review = deidentify(context);
  return {
    sections: (['description', 'conclusion', 'recommendations'] as const).filter(id => sections[id].trim()).map(id => ({ id, text: deidentify(sections[id], context).text })),
    removedFields: ['other', 'filename', 'rawBytes', 'metadata', 'identity', 'address', 'contact'],
    privacy: { replacements: review.replacements, limitation: review.limitation },
  };
}
