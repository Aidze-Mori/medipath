import { cleanDocumentSections, documentContentDigest, validDocumentExplanation, validDocumentRequest, type DocumentExplanation, type DocumentModelSection } from '../src/privacy/documentContract';
import { readLimited, ServiceError } from './errors';
import { admitModelCall } from './limits';
import { runStructuredModel, type ModelOptions } from './model';
import { explanationEvidence, resolveExplanationEvidence } from './explanationEvidence';
import { DOCUMENT_EXPLANATION_INSTRUCTIONS } from './explanationPrompt';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

export async function explainDocument(sections: DocumentModelSection[], options: ModelOptions): Promise<DocumentExplanation> {
  const cleaned = cleanDocumentSections(sections);
  if (!cleaned.length) throw new ServiceError('no_medical_text', 422);
  const { schema, citations } = explanationEvidence(cleaned);
  // Repeat cleanup immediately before either external provider. Raw document
  // bytes, filename, original metadata and client flags are never accepted.
  const raw = await runStructuredModel({ instructions: DOCUMENT_EXPLANATION_INSTRUCTIONS, input: JSON.stringify({ sections: cleaned, citations }), schema, schemaName: 'medipath_document_explanation', maxOutputTokens: 2200 }, options);
  const value = resolveExplanationEvidence(raw, cleaned);
  if (!validDocumentExplanation(value, cleaned)) throw new ServiceError('invalid_model_response', 503);
  return value;
}
export async function handleDocumentAnalyzeRequest(request: Request, options: ModelOptions): Promise<Response> {
  try {
    const cloud = !options.localDevelopment || options.env.NETLIFY === 'true' || !!options.env.AWS_LAMBDA_FUNCTION_NAME;
    if (cloud && options.env.ALLOW_CLOUD_DOCUMENTS !== '1') throw new ServiceError('document_analysis_local_only', 403);
    if (options.env.ALLOW_ANONYMIZED_DOCUMENTS !== '1' || !cloud && options.env.ALLOW_LOCAL_LIVE !== '1') throw new ServiceError('document_analysis_disabled', 403);
    if (request.method !== 'POST') return Response.json({ error: { code: 'method_not_allowed' } }, { status: 405, headers: { ...headers, Allow: 'POST' } });
    if (!/^application\/json(?:;|$)/iu.test(request.headers.get('content-type') ?? '')) throw new ServiceError('invalid_request', 400);
    let input: unknown;
    try { input = JSON.parse(await readLimited(request, 131072)); } catch (error) { if (error instanceof ServiceError) throw error; throw new ServiceError('invalid_request', 400); }
    if (!validDocumentRequest(input)) throw new ServiceError('invalid_request', 400);
    if (await documentContentDigest(input.sections) !== input.contentDigest) throw new ServiceError('source_changed', 409);
    const cleaned = cleanDocumentSections(input.sections);
    if (!cleaned.length) throw new ServiceError('no_medical_text', 422);
    await admitModelCall(options.env, { ...options, signal: request.signal });
    const explanation = await explainDocument(cleaned, { ...options, signal: request.signal });
    return Response.json({ binding: { requestId: input.requestId, documentRevision: input.documentRevision, contentDigest: input.contentDigest }, explanation }, { headers });
  } catch (error) {
    const safe = error instanceof ServiceError ? error : new ServiceError('model_unavailable', 503);
    return Response.json({ error: { code: safe.code } }, { status: safe.status, headers: { ...headers, ...(safe.status === 429 ? { 'Retry-After': '60' } : {}) } });
  }
}
