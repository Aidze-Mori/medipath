import corpus from '../../data/corpus-release/corpus.json';

export const CORPUS_VERSION = corpus.corpusVersion;
export const CORPUS_LIMITATIONS = corpus.limitations;
export type WorkflowChunk = typeof corpus.chunks[number];
export function retrieve(query: string, limit = 3): WorkflowChunk[] {
  const normalized = query.normalize('NFC').toLocaleLowerCase('ru');
  return corpus.chunks
    .filter(chunk => chunk.releaseStatus === 'released' && chunk.rights === 'project_authored')
    .map(chunk => ({ chunk, score: chunk.terms.reduce((score, term) => score + Number(normalized.includes(term)), 0) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
    .slice(0, Math.max(0, Math.min(5, limit)))
    .map(item => item.chunk);
}
