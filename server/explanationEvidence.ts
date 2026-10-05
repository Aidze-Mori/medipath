import { documentCitationOptions, documentExplanationSchema, type DocumentModelSection } from '../src/privacy/documentContract';

// Send short references in structured output: some compatible providers reject
// literal PDF line breaks inside schema enums. Resolve references before validation.
export function explanationEvidence(sections: DocumentModelSection[]) {
  const citations = documentCitationOptions(sections).map((quote, index) => ({ id: `source-${String(index + 1).padStart(5, '0')}`, quote }));
  const schema = documentExplanationSchema(sections);
  schema.properties.findings.items.properties.quote.enum = citations.map(citation => citation.id);
  return { schema, citations };
}
export function resolveExplanationEvidence(value: unknown, sections: DocumentModelSection[]): unknown {
  if (!value || typeof value !== 'object' || !('findings' in value) || !Array.isArray(value.findings)) return value;
  const { citations } = explanationEvidence(sections);
  return { ...value, findings: value.findings.map(finding => {
    if (!finding || typeof finding !== 'object' || typeof finding.quote !== 'string') return finding;
    const citation = citations.find(candidate => candidate.id === finding.quote);
    return citation ? { ...finding, quote: citation.quote } : finding;
  }) };
}
