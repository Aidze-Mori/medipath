import { createClinicDocument, SYNTHETIC_FIXTURES, type DemoRequest, type DemoResponse } from '../src/domain';
import { analyzeLocal, retrieve, selectClinicalDemoProposals } from '../src/engine';
import { validateAnalysisEvidence } from '../src/engine/validateEvidence';
import { contentDigest } from '../src/privacy/policy';
import { minimize } from '../src/privacy/minimize';
import { readLimited, ServiceError } from './errors';
import { admitModelCall } from './limits';
import { runModel } from './model';
import type { CodexRunner } from './codex';
import manifest from '../data/corpus-release/manifest.json';

export interface AnalyzeOptions { env: Record<string, string | undefined>; fetcher?: typeof fetch; localDevelopment?: boolean; codexRunner?: CodexRunner }
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function parseRequest(value: unknown): DemoRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ServiceError('invalid_request', 400);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'fixtureId,fixtureRevision,operation,requestId,reviewVariantId' || typeof input.fixtureId !== 'string' || !/^[a-z0-9-]{1,50}$/u.test(input.fixtureId) || !Number.isSafeInteger(input.fixtureRevision) || Number(input.fixtureRevision) < 1 || Number(input.fixtureRevision) > 1000000 || input.reviewVariantId !== 'canonical' || input.operation !== 'explain' || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/u.test(input.requestId)) throw new ServiceError('invalid_request', 400);
  return input as unknown as DemoRequest;
}
export async function handleAnalyzeRequest(request: Request, options: AnalyzeOptions): Promise<Response> {
  try {
    if (request.method !== 'POST') return Response.json({ error: { code: 'method_not_allowed' } }, { status: 405, headers: { ...headers, Allow: 'POST' } });
    if (!/^application\/json(?:;|$)/iu.test(request.headers.get('content-type') ?? '')) throw new ServiceError('invalid_request', 400);
    const raw = await readLimited(request, 8192);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new ServiceError('invalid_request', 400); }
    const input = parseRequest(parsed);
    const fixture = SYNTHETIC_FIXTURES.find(candidate => candidate.id === input.fixtureId && candidate.revision === input.fixtureRevision);
    if (!fixture) throw new ServiceError('unknown_fixture', 404);
    const released = manifest.variants.find(variant => variant.fixtureId === fixture.id && variant.fixtureRevision === fixture.revision && variant.reviewVariantId === input.reviewVariantId);
    const digest = await contentDigest(fixture.sections);
    if (!released || released.contentDigest !== digest) throw new ServiceError('source_not_ready', 409);
    await admitModelCall(options.env, { ...options, signal: request.signal });
    const document = createClinicDocument(fixture.id);
    const baseline = analyzeLocal(document);
    const minimized = minimize(fixture.sections);
    const chunks = retrieve(minimized.sections.map(section => section.text).join('\n'));
    const selected = await runModel(minimized.sections, chunks, { ...options, signal: request.signal }, baseline.clinicalDemo, true);
    const selectedBaseline = baseline.clinicalDemo ? selectClinicalDemoProposals(baseline, selected.clinicalProposalIds ?? []) : baseline;
    const analysis = { ...selectedBaseline, mode: 'synthetic_live' as const, llmExplanation: selected.llmExplanation, claims: [
      ...selected.statementIds.flatMap(id => baseline.claims.filter(claim => claim.id === `statement-${id}`)),
      ...selected.explanationIds.flatMap(id => chunks.filter(chunk => chunk.id === id).map(chunk => ({ id: `explanation-${id}`, text: chunk.text, kind: 'explanation' as const, sourceRefs: [], sourceIds: [chunk.id], certainty: 'as_written' as const }))),
    ] };
    if (!validateAnalysisEvidence(analysis, document)) throw new ServiceError('invalid_model_response', 503);
    const result: DemoResponse = { binding: { fixtureId: fixture.id, fixtureRevision: fixture.revision, reviewVariantId: input.reviewVariantId, contentDigest: digest, requestId: input.requestId }, analysis };
    return Response.json(result, { headers });
  } catch (error) {
    const safe = error instanceof ServiceError ? error : new ServiceError('model_unavailable', 503);
    return Response.json({ error: { code: safe.code } }, { status: safe.status, headers: { ...headers, ...(safe.status === 429 ? { 'Retry-After': '60' } : {}) } });
  }
}
