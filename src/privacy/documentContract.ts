import type { Analysis, DocumentSections } from '../domain';
import { deidentify } from './deidentify';

export const DOCUMENT_SECTION_IDS = ['description', 'conclusion', 'recommendations', 'unclassified'] as const;
export type DocumentSectionId = typeof DOCUMENT_SECTION_IDS[number];
export interface DocumentModelSection { id: DocumentSectionId; text: string }
export interface DocumentAnalysisRequest { requestId: string; documentRevision: number; contentDigest: string; sections: DocumentModelSection[] }
export type DocumentExplanation = NonNullable<Analysis['llmExplanation']>;
export function documentCitationOptions(sections: DocumentModelSection[]): string[] {
  const quotes: string[] = [];
  for (const section of sections) {
    const complete = section.text.trim();
    if (complete.length >= 8 && complete.length <= 1200) quotes.push(complete);
    for (const paragraph of section.text.split(/\n\s*\n/u)) {
      const text = paragraph.trim();
      if (text.length >= 8 && text.length <= 1200) quotes.push(text);
    }
    for (const sentence of section.text.split(/(?<=[.!?])\s+/u)) {
      let remaining = sentence.trim();
      while (remaining.length > 1200) {
        const space = remaining.lastIndexOf(' ', 1200);
        const end = space >= 8 ? space : 1200;
        quotes.push(remaining.slice(0, end));
        remaining = remaining.slice(end).trim();
      }
      if (remaining.length >= 8) quotes.push(remaining);
    }
  }
  return [...new Set(quotes)];
}
export function documentExplanationSchema(sections: DocumentModelSection[]) {
  const quotes = documentCitationOptions(sections);
  return {
    type: 'object', properties: {
      summary: { type: 'string', minLength: 1, maxLength: 1000 },
      findings: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', properties: {
        sectionId: { type: 'string', enum: sections.map(section => section.id) },
        quote: { type: 'string', minLength: 8, maxLength: 1500, ...(quotes.length ? { enum: quotes } : {}) }, explanation: { type: 'string', minLength: 1, maxLength: 1000 },
      }, required: ['sectionId', 'quote', 'explanation'], additionalProperties: false } },
    }, required: ['summary', 'findings'], additionalProperties: false,
  };
}
export interface DocumentAnalysisResponse { binding: Pick<DocumentAnalysisRequest, 'requestId' | 'documentRevision' | 'contentDigest'>; explanation: DocumentExplanation }
export interface RuntimeCapabilities {
  provider: 'codex_cli' | 'openai' | 'disabled'; configured: boolean; documentAnalysisAllowed: boolean;
  reason: 'ready' | 'disabled' | 'missing_config' | 'local_only' | 'document_opt_in_required' | 'durable_limit_required' | 'invalid_provider';
}
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const metadataLine = /^\s*(?:Ф\.?\s*И\.?\s*О\.?|(?:фамилия|имя|отчество)(?: пациент(?:а|ки))?|пациент(?:ка)?|patient(?: name| id)?|телефон(?: пациента)?|email|e-mail|почта|(?:домашний )?адрес(?: пациента| проживания| регистрации)?|место жительства|паспорт(?:ные данные)?|СНИЛС|полис(?: ОМС| ДМС)?|дата рождения|д[./]р|номер (?:медицинской карты|медкарты|карты пациента))\s*[:：№]/iu;

export function cleanDocumentSections(sections: DocumentModelSection[]): DocumentModelSection[] {
  const context = sections.map(section => section.text).join('\n');
  return sections.map(section => ({ id: section.id, text: deidentify(section.text, context).text.split('\n').filter(line => !metadataLine.test(line)).join('\n').trim() })).filter(section => section.text);
}
export function minimizeDocument(sections: DocumentSections): DocumentModelSection[] {
  // All local context helps detect repeated patient names; raw `other` is never
  // sent as metadata. Only an otherwise unsectioned source uses the fallback.
  const context = Object.values(sections).join('\n');
  const found: DocumentModelSection[] = (['description', 'conclusion', 'recommendations'] as const).filter(id => sections[id].trim()).map(id => ({ id, text: deidentify(sections[id], context).text }));
  return cleanDocumentSections(found.length ? found : sections.other.trim() ? [{ id: 'unclassified', text: deidentify(sections.other, context).text }] : []);
}
export async function documentContentDigest(sections: DocumentModelSection[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(sections.map(({ id, text }) => [id, text])));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function validDocumentRequest(value: unknown): value is DocumentAnalysisRequest {
  if (!isRecord(value) || !exactKeys(value, ['requestId', 'documentRevision', 'contentDigest', 'sections']) || typeof value.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/u.test(value.requestId) || !Number.isSafeInteger(value.documentRevision) || Number(value.documentRevision) < 1 || Number(value.documentRevision) > 1000000 || typeof value.contentDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(value.contentDigest) || !Array.isArray(value.sections) || value.sections.length < 1 || value.sections.length > 3) return false;
  let length = 0;
  const ids = new Set<string>();
  for (const section of value.sections) {
    if (!isRecord(section) || !exactKeys(section, ['id', 'text']) || typeof section.id !== 'string' || !DOCUMENT_SECTION_IDS.includes(section.id as DocumentSectionId) || ids.has(section.id) || typeof section.text !== 'string' || !section.text.trim() || section.text.length > 20000) return false;
    ids.add(section.id); length += section.text.length;
  }
  return length <= 20000 && (!ids.has('unclassified') || ids.size === 1);
}
const numbers = (text: string) => text.match(/\d+(?:[.,]\d+)?/gu) ?? [];
const guardedTerms = ['пульмонолог', 'маммолог', 'онколог', 'терапевт', 'невролог', 'кардиолог', 'пневмон', 'инфаркт', 'инсульт', 'злокачествен', 'доброкачествен', 'антибиотик', 'госпитализац', 'немедленно', 'срочно', 'дозировк'];
export function validDocumentExplanation(value: unknown, sections: DocumentModelSection[]): value is DocumentExplanation {
  if (!isRecord(value) || !exactKeys(value, ['summary', 'findings']) || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 1000 || !Array.isArray(value.findings) || value.findings.length < 1 || value.findings.length > 6) return false;
  const source = sections.map(section => section.text).join('\n');
  const sourceNumbers = new Set(numbers(source));
  const seen = new Set<string>();
  for (const finding of value.findings) {
    if (!isRecord(finding) || !exactKeys(finding, ['sectionId', 'quote', 'explanation']) || typeof finding.sectionId !== 'string' || typeof finding.quote !== 'string' || finding.quote.trim().length < 8 || finding.quote.length > 1500 || typeof finding.explanation !== 'string' || !finding.explanation.trim() || finding.explanation.length > 1000) return false;
    const section = sections.find(item => item.id === finding.sectionId);
    const key = `${finding.sectionId}:${finding.quote}`;
    if (!section?.text.includes(finding.quote) || seen.has(key)) return false;
    seen.add(key);
    const quoteNumbers = new Set(numbers(finding.quote));
    if (numbers(finding.explanation).some(number => !quoteNumbers.has(number))) return false;
  }
  const output = [value.summary, ...value.findings.map(item => (item as Record<string, string>).explanation)].join('\n');
  if (numbers(value.summary).some(number => !sourceNumbers.has(number))) return false;
  if (guardedTerms.some(term => output.toLowerCase().includes(term) && !source.toLowerCase().includes(term))) return false;
  if (deidentify(output).replacements.length) return false;
  // Exact quotes, number preservation and a conservative term guard reduce
  // hallucination risk; they cannot prove semantic equivalence of a paraphrase.
  return true;
}
export function validCapabilities(value: unknown): value is RuntimeCapabilities {
  return isRecord(value) && exactKeys(value, ['provider', 'configured', 'documentAnalysisAllowed', 'reason']) && ['codex_cli', 'openai', 'disabled'].includes(String(value.provider)) && typeof value.configured === 'boolean' && typeof value.documentAnalysisAllowed === 'boolean' && ['ready', 'disabled', 'missing_config', 'local_only', 'document_opt_in_required', 'durable_limit_required', 'invalid_provider'].includes(String(value.reason)) && (!value.documentAnalysisAllowed || value.configured && value.provider !== 'disabled');
}
