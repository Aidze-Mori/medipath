import { describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { createDocument, confirmDocument, updateDocumentSections } from '../../src/domain';
import { analyzeDocument, fetchCapabilities, prepareAnonymizedSections, prepareDocumentRequest } from '../../src/privacy/documentAnalysis';
import { documentContentDigest, documentExplanationSchema, validDocumentExplanation, validDocumentRequest, type DocumentAnalysisRequest, type DocumentModelSection } from '../../src/privacy/documentContract';
import { handleDocumentAnalyzeRequest, explainDocument } from '../../server/analyzeDocument';
import { runtimeCapabilities, handleCapabilitiesRequest } from '../../server/capabilities';
import { createAppServer } from '../../server/http';
import { explanationEvidence, resolveExplanationEvidence } from '../../server/explanationEvidence';

const env = { LLM_PROVIDER: 'codex_cli', CODEX_MODEL: 'configured-model', ALLOW_LOCAL_LIVE: '1', ALLOW_ANONYMIZED_DOCUMENTS: '1' };
const sections = { description: 'Лёгкие расправлены. Плевральный выпот не выявлен.', conclusion: 'Свежие очаговые изменения не выявлены.', recommendations: '', other: 'ФИО: Иванова Мария Петровна\nEmail: patient@example.invalid\nТелефон: +7 (999) 123-45-67' };
const document = () => confirmDocument(createDocument({ sections }));
const explanation = { summary: 'В документе не описаны свежие очаговые изменения.', findings: [{ sectionId: 'conclusion', quote: sections.conclusion, explanation: 'В этом исследовании свежие очаговые изменения не обнаружены.' }] };
const request = (value: unknown) => new Request('http://localhost/api/analyze-document', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });

describe('anonymized uploaded document boundary', () => {
  it('sends short citation IDs and resolves them before unchanged evidence validation', () => {
    const source: DocumentModelSection[] = [{ id: 'conclusion', text: sections.conclusion }];
    const { schema, citations } = explanationEvidence(source);
    expect(schema.properties.findings.items.properties.quote.enum).toEqual(['source-00001']);
    const reference = { ...explanation, findings: [{ ...explanation.findings[0], quote: citations[0].id }] };
    expect(resolveExplanationEvidence(reference, source)).toEqual(explanation);
    expect(validDocumentExplanation(resolveExplanationEvidence(reference, source), source)).toBe(true);
    reference.findings[0].quote = 'source-99999';
    expect(validDocumentExplanation(resolveExplanationEvidence(reference, source), source)).toBe(false);
  });
  it('constrains model citations to contiguous original excerpts, including PDF line breaks', () => {
    const text = `Лёгкие расправлены. Плевральный\nвыпот не выявлен. ${'Медицинское описание '.repeat(100)}`;
    const schema = documentExplanationSchema([{ id: 'description', text }]);
    const quotes = schema.properties.findings.items.properties.quote.enum!;
    expect(quotes).toContain('Плевральный\nвыпот не выявлен.');
    expect(quotes.every(quote => text.includes(quote) && quote.length >= 8 && quote.length <= 1200)).toBe(true);
    expect(quotes).not.toContain('Лёгкие расправлены. ... Плевральный выпот не выявлен.');
  });
  it('allows a short complete section as evidence for a multi-sentence finding', () => {
    const text = 'В левой молочной железе описано образование. Справа категория BI-RADS 2.';
    const quotes = documentExplanationSchema([{ id: 'description', text }]).properties.findings.items.properties.quote.enum!;
    expect(quotes).toContain(text);
    expect(quotes).toContain('Справа категория BI-RADS 2.');
  });
  it('requires the actual current review revision before any client request', async () => {
    const draft = createDocument({ sections });
    await expect(prepareDocumentRequest(draft)).rejects.toMatchObject({ code: 'review_required' });
    await expect(prepareDocumentRequest(updateDocumentSections(document(), { ...sections, conclusion: 'Исправленный текст.' }))).rejects.toMatchObject({ code: 'review_required' });
  });
  it('minimizes locally before fetch and keeps user PII/other/raw fields out of request', async () => {
    const reviewed = confirmDocument(createDocument({ sections: { ...sections, description: `${sections.description}\nПациент: Иванова Мария Петровна\nТелефон: +7 (999) 123-45-67\nEmail: patient@example.invalid\nАдрес: Личная улица, 7`, other: `${sections.other}\nПаспорт: 4510 123456` } }));
    const prepared = await prepareDocumentRequest(reviewed, 'request-document-0001');
    expect(Object.keys(prepared).sort()).toEqual(['contentDigest', 'documentRevision', 'requestId', 'sections']);
    expect(JSON.stringify(prepared)).not.toMatch(/Иванова|patient@example|999|Личная|4510|filename|other|rawBytes|isSynthetic/);
    expect(prepared.sections[0].text).toContain('Плевральный выпот не выявлен');
    expect(prepared.sections).toEqual(prepareAnonymizedSections(reviewed.sections));
    expect(prepared.contentDigest).toBe(await documentContentDigest(prepared.sections));
    expect(reviewed.sections.description).toContain('Иванова');
  });
  it('keeps unknown medical text as unclassified after cleanup without inventing a heading', () => {
    const fallback = prepareAnonymizedSections({ description: '', conclusion: '', recommendations: '', other: 'Пациент: Иванова Мария Петровна\nДата рождения: 01.01.1980\nEmail: patient@example.invalid\nЖалобы на кашель. Температура 37,2 °C.\nВрач: Петров Иван Сергеевич\nАдрес клиники: Медицинская улица, 10' });
    expect(fallback).toHaveLength(1);
    expect(fallback[0].id).toBe('unclassified');
    expect(fallback[0].text).not.toMatch(/Иванова|1980|patient@example/);
    expect(fallback[0].text).toContain('Температура 37,2 °C');
    expect(fallback[0].text).toContain('Врач: Петров Иван Сергеевич');
    expect(fallback[0].text).toContain('Адрес клиники:');
    expect(prepareAnonymizedSections({ ...sections, other: 'Жалобы вне медицинских разделов' }).map(item => item.id)).not.toContain('unclassified');
  });
  it('rejects extra fields, duplicate sections, raw other, mixed fallback and overlarge text', async () => {
    const prepared = await prepareDocumentRequest(document());
    for (const value of [
      { ...prepared, isSynthetic: true }, { ...prepared, filename: 'PRIVATE.pdf' }, { ...prepared, other: 'PRIVATE' },
      { ...prepared, sections: [{ id: 'other', text: 'PRIVATE' }] },
      { ...prepared, sections: [prepared.sections[0], prepared.sections[0]] },
      { ...prepared, sections: [{ id: 'unclassified', text: 'Неизвестный текст' }, prepared.sections[0]] },
      { ...prepared, sections: [{ id: 'conclusion', text: 'x'.repeat(20001) }] },
      { ...prepared, documentRevision: -1 }, { ...prepared, requestId: 'PII@example.invalid' },
    ]) expect(validDocumentRequest(value)).toBe(false);
    const response = await handleDocumentAnalyzeRequest(request({ ...prepared, filename: 'PRIVATE.pdf' }), { env, localDevelopment: true });
    expect(response.status).toBe(400); expect(await response.text()).not.toContain('PRIVATE');
  });
  it('is forbidden on public adapters/Netlify and without the local server opt-in', async () => {
    const body = await prepareDocumentRequest(document());
    const never = async () => { throw new Error('must never run'); };
    for (const options of [{ env }, { env: { ...env, NETLIFY: 'true' }, localDevelopment: true }, { env: { ...env, AWS_LAMBDA_FUNCTION_NAME: 'analyze' }, localDevelopment: true }, { env: { ...env, ALLOW_ANONYMIZED_DOCUMENTS: '0' }, localDevelopment: true }, { env: { ...env, ALLOW_LOCAL_LIVE: '0' }, localDevelopment: true }]) {
      expect((await handleDocumentAnalyzeRequest(request(body), { ...options, codexRunner: never })).status).toBe(403);
    }
  });
  it('allows explicitly configured cloud PDF analysis and cleans identifiers before VseLLM', async () => {
    const cloudEnv = { NETLIFY: 'true', LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'test-secret', OPENAI_MODEL: 'test', OPENAI_BASE_URL: 'https://api.vsellm.ru/v1', DEMO_WITHOUT_REDIS: '1', ALLOW_CLOUD_DOCUMENTS: '1', ALLOW_ANONYMIZED_DOCUMENTS: '1' };
    const source = [{ id: 'conclusion' as const, text: `Пациент: Иванова Мария Петровна\nТелефон: +7 (999) 123-45-67\n${sections.conclusion}` }];
    const body = { requestId: 'cloud-upload-request-0001', documentRevision: 1, sections: source, contentDigest: await documentContentDigest(source) };
    const calls: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push(String(url));
      expect(String(init?.body)).not.toMatch(/Иванова|999|test-secret/);
      expect(JSON.parse(String(init?.body)).store).toBe(false);
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(explanation) }] }] });
    };
    expect(runtimeCapabilities(cloudEnv)).toEqual({ provider: 'openai', configured: true, documentAnalysisAllowed: true, reason: 'ready' });
    for (const flag of ['ALLOW_CLOUD_DOCUMENTS', 'ALLOW_ANONYMIZED_DOCUMENTS']) {
      expect((await handleDocumentAnalyzeRequest(request(body), { env: { ...cloudEnv, [flag]: '0' }, fetcher })).status).toBe(403);
    }
    expect(calls).toEqual([]);
    const response = await handleDocumentAnalyzeRequest(request(body), { env: cloudEnv, fetcher });
    expect(response.status).toBe(200);
    expect((await response.json()).explanation).toEqual(explanation);
    expect(calls).toEqual(['https://api.vsellm.ru/v1/responses']);
    expect((await handleDocumentAnalyzeRequest(request({ ...body, rawBytes: 'PRIVATE' }), { env: cloudEnv, fetcher })).status).toBe(400);
    expect(calls).toHaveLength(1);
  });
  it('rejects digest/revision tampering before provider admission', async () => {
    const body = await prepareDocumentRequest(document());
    const response = await handleDocumentAnalyzeRequest(request({ ...body, contentDigest: '0'.repeat(64) }), { env, localDevelopment: true, codexRunner: async () => { throw new Error('must never run'); } });
    expect(response.status).toBe(409); expect((await response.json()).error.code).toBe('source_changed');
  });
  it('accepts a new reviewed non-manifest document and returns bound validated explanation', async () => {
    const body = await prepareDocumentRequest(document(), 'new-upload-request-0001');
    const response = await handleDocumentAnalyzeRequest(request(body), { env, localDevelopment: true, codexRunner: async invocation => {
      expect(invocation.input).not.toMatch(/Иванова|patient@example|999/);
      expect(invocation.instructions).toContain('untrusted data');
      return JSON.stringify(explanation);
    } });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.binding).toEqual({ requestId: body.requestId, documentRevision: body.documentRevision, contentDigest: body.contentDigest });
    expect(result.explanation).toEqual(explanation);
    expect(result).not.toHaveProperty('routeSteps');
  });
  it('cleans again at the last boundary before both actual provider adapters', async () => {
    const raw: DocumentModelSection[] = [{ id: 'conclusion', text: `ФИО: Иванова Мария Петровна\nТелефон: +7 (999) 123-45-67\nEmail: patient@example.invalid\nАдрес: Личная улица, 7\nПаспорт: 4510 123456\nСНИЛС: 123-456-789 01\n${sections.conclusion}` }];
    const inspect = (text: string) => { expect(text).not.toMatch(/Иванова|999|patient@example|Личная|4510|123-456/); expect(text).toContain(sections.conclusion); };
    await explainDocument(raw, { env, localDevelopment: true, codexRunner: async invocation => { inspect(invocation.input); return JSON.stringify(explanation); } });
    await explainDocument(raw, { env: { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'test-secret', OPENAI_MODEL: 'test' }, fetcher: async (_url, init) => {
      const body = JSON.parse(String(init?.body)); inspect(body.input);
      expect(body.store).toBe(false); expect(JSON.stringify(body)).not.toContain('test-secret');
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(explanation) }] }] });
    } });
  });
  it('removes standalone patient identity at the client and both provider boundaries', async () => {
    const text = 'Фамилия: Тестова\nИмя: Мария\nОтчество: Петровна\nФамилия врача: Сидоров\nИмя врача: Иван\nОтчество врача: Сергеевич\nПлевральный выпот не выявлен.';
    const clinical = 'Плевральный выпот не выявлен.';
    const answer = { summary: clinical, findings: [{ sectionId: 'unclassified', quote: clinical, explanation: 'В источнике указано, что плевральный выпот не обнаружен.' }] };
    const inspect = (payload: string) => {
      expect(payload).not.toMatch(/Тестова|Мария|Петровна/);
      expect(payload).toContain(clinical);
      expect(payload).toContain('Фамилия врача: Сидоров');
      expect(payload).toContain('Имя врача: Иван');
      expect(payload).toContain('Отчество врача: Сергеевич');
    };
    const minimized = prepareAnonymizedSections({ description: '', conclusion: '', recommendations: '', other: text });
    inspect(JSON.stringify(minimized));
    for (const candidate of [minimized, [{ id: 'unclassified' as const, text }]]) {
      await explainDocument(candidate, { env, localDevelopment: true, codexRunner: async invocation => { inspect(invocation.input); return JSON.stringify(answer); } });
      await explainDocument(candidate, { env: { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'mock', OPENAI_MODEL: 'mock' }, fetcher: async (_url, init) => {
        inspect(JSON.parse(String(init?.body)).input);
        return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] });
      } });
    }
  });
  it('rejects invented quote, section, numerical detail, specialist and extra model fields', async () => {
    const source = prepareAnonymizedSections(sections);
    for (const bad of [
      { ...explanation, routeSteps: [] },
      { ...explanation, summary: 'Обнаружено 17 очагов.' },
      { ...explanation, summary: 'Нужен онколог срочно.' },
      { ...explanation, findings: [{ ...explanation.findings[0], sectionId: 'other' }] },
      { ...explanation, findings: [{ ...explanation.findings[0], quote: 'Выдуманное подтверждение диагноза.' }] },
      { ...explanation, findings: [{ ...explanation.findings[0], explanation: 'Размер 18 мм.' }] },
      { ...explanation, findings: [] },
    ]) {
      expect(validDocumentExplanation(bad, source)).toBe(false);
      await expect(explainDocument(source, { env, localDevelopment: true, codexRunner: async () => JSON.stringify(bad) })).rejects.toMatchObject({ code: 'invalid_model_response' });
    }
  });
  it('binds client result to revision/digest, reports progress and leaves routes to explicit rules', async () => {
    const stages: string[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as DocumentAnalysisRequest;
      return Response.json({ binding: { requestId: body.requestId, documentRevision: body.documentRevision, contentDigest: body.contentDigest }, explanation });
    };
    const analysis = await analyzeDocument(document(), { fetcher, onProgress: stage => stages.push(stage) });
    expect(analysis.mode).toBe('anonymized_live'); expect(analysis.llmExplanation).toEqual(explanation);
    expect(analysis.routeSteps).toEqual([]); expect(stages).toEqual(['anonymizing', 'analyzing', 'validating']);
    const stale: typeof fetch = async (_url, init) => { const body = JSON.parse(String(init?.body)); return Response.json({ binding: { ...body, documentRevision: 999 }, explanation }); };
    await expect(analyzeDocument(document(), { fetcher: stale })).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(analyzeDocument(document(), { fetcher: async () => { throw new TypeError('offline'); } })).rejects.toMatchObject({ code: 'network_error' });
    await expect(analyzeDocument(document(), { fetcher: async () => Response.json({ error: { code: 'document_analysis_disabled' } }, { status: 403 }) })).rejects.toMatchObject({ code: 'document_analysis_disabled' });
  });
});

describe('safe runtime capabilities', () => {
  it('reports configuration without claiming health or leaking any environment value', () => {
    expect(runtimeCapabilities({ ...env, OPENAI_API_KEY: 'PRIVATE-secret' }, true)).toEqual({ provider: 'codex_cli', configured: true, documentAnalysisAllowed: true, reason: 'ready' });
    expect(runtimeCapabilities({ ...env, ALLOW_ANONYMIZED_DOCUMENTS: '0' }, true)).toMatchObject({ configured: true, documentAnalysisAllowed: false, reason: 'document_opt_in_required' });
    expect(runtimeCapabilities(env)).toMatchObject({ configured: false, documentAnalysisAllowed: false, reason: 'local_only' });
    expect(runtimeCapabilities({ LLM_PROVIDER: 'unknown' })).toMatchObject({ provider: 'disabled', configured: false, reason: 'invalid_provider' });
    expect(runtimeCapabilities({})).toMatchObject({ configured: false, reason: 'disabled' });
    expect(runtimeCapabilities({ LLM_PROVIDER: 'openai' })).toMatchObject({ configured: false, reason: 'missing_config' });
    expect(runtimeCapabilities({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'PRIVATE', OPENAI_MODEL: 'model' })).toMatchObject({ configured: false, reason: 'durable_limit_required' });
    expect(runtimeCapabilities({ NETLIFY: 'true', LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'PRIVATE', OPENAI_MODEL: 'model', DEMO_WITHOUT_REDIS: '1', ALLOW_ANONYMIZED_DOCUMENTS: '1', ALLOW_LOCAL_LIVE: '1' })).toEqual({ provider: 'openai', configured: true, documentAnalysisAllowed: false, reason: 'local_only' });
    expect(runtimeCapabilities({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'PRIVATE', OPENAI_MODEL: 'model', UPSTASH_REDIS_REST_URL: 'https://test.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'PRIVATE' })).toEqual({ provider: 'openai', configured: true, documentAnalysisAllowed: false, reason: 'local_only' });
  });
  it('supports a bounded client capability request and explicit retryable failure', async () => {
    const capabilities = await fetchCapabilities({ fetcher: async () => handleCapabilitiesRequest(new Request('http://localhost/api/capabilities'), { env, localDevelopment: true }) });
    expect(capabilities.documentAnalysisAllowed).toBe(true);
    await expect(fetchCapabilities({ fetcher: async () => Response.json({ configured: true, OPENAI_API_KEY: 'PRIVATE' }) })).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(fetchCapabilities({ fetcher: async () => { throw new Error('offline'); } })).rejects.toMatchObject({ code: 'network_error' });
    expect(handleCapabilitiesRequest(new Request('http://localhost/api/capabilities', { method: 'POST' }), { env }).status).toBe(405);
  });
  it('serves capabilities through Node and rejects cross-origin local document calls', async () => {
    const server = createAppServer({ env }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    try {
      const base = `http://127.0.0.1:${address.port}`;
      const capability = await fetch(`${base}/api/capabilities`);
      expect((await capability.json()).documentAnalysisAllowed).toBe(true);
      const rejected = await fetch(`${base}/api/analyze-document`, { method: 'POST', headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' }, body: '{}' });
      expect(rejected.status).toBe(403);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
