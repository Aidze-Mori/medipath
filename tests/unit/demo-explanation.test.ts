import { describe, expect, it } from 'vitest';
import { createClinicDocument, updateDocumentSections, confirmDocument } from '../../src/domain';
import { prepareDemoRequest, acceptDemoResponse } from '../../src/privacy/policy';
import { handleAnalyzeRequest } from '../../server/analyze';
import { runModel } from '../../server/model';
import { minimize } from '../../src/privacy/minimize';
import { stubExplanation } from './model-response-helper';

const env = { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'stub-secret', OPENAI_MODEL: 'stub-model', UPSTASH_REDIS_REST_URL: 'https://medipath-test.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'stub-redis' };
const output = (value: unknown) => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const doc = () => createClinicDocument('chest-referral');

describe('full synthetic live document explanation', () => {
  it('uses one real transport invocation contract and preserves model explanation through manifest-bound client acceptance', async () => {
    const document = doc();
    const prepared = (await prepareDemoRequest(document, 'rich-demo-request-01'))!;
    const explanation = stubExplanation(document.sections);
    explanation.findings[0].explanation = 'В описании отмечен очаг размером 4 мм в правом лёгком; плевральный выпот не выявлен.';
    const calls: string[] = [];
    const response = await handleAnalyzeRequest(new Request('https://medipath.invalid/api/analyze-demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prepared.request) }), { env, fetcher: async (url, init) => {
      calls.push(String(url));
      if (String(url).includes('upstash')) return Response.json({ result: 1 });
      const body = JSON.parse(String(init?.body));
      const payload = JSON.parse(body.input);
      expect(body.store).toBe(false);
      expect(body.text.format.schema.required).toContain('llmExplanation');
      expect(payload.sections.map((section: { id: string }) => section.id)).toEqual(['description', 'conclusion', 'recommendations']);
      expect(body.input).not.toMatch(/Тестов|canary|1234567890123456|rawBytes|filename|studyMetadata|equipment|Учебная клиника/);
      expect(Object.keys(payload).sort()).toEqual(['citations', 'sections', 'workflowExplanations']);
      const referenced = { ...explanation, findings: explanation.findings.map(finding => ({ ...finding, quote: payload.citations.find((citation: { quote: string }) => citation.quote === finding.quote).id })) };
      return output({ statementIds: ['description', 'conclusion', 'recommendations'], explanationIds: [], llmExplanation: referenced });
    } });
    expect(response.status).toBe(200);
    expect(calls).toEqual([env.UPSTASH_REDIS_REST_URL, 'https://api.openai.com/v1/responses']);
    const result = await response.json();
    const accepted = acceptDemoResponse(document, prepared.binding, result)!;
    expect(accepted.mode).toBe('synthetic_live');
    expect(accepted.llmExplanation).toEqual(explanation);
    expect(accepted.llmExplanation?.findings).toHaveLength(3);
    expect(accepted.routeSteps[0].specialtyId).toBe('pulmonology');
    expect(accepted.llmExplanation?.findings[0].explanation).not.toBe(document.sections.description);
    expect(acceptDemoResponse(confirmDocument(updateDocumentSections(document, { ...document.sections, conclusion: 'Другой исходник.' })), prepared.binding, result)).toBeNull();
    for (const value of [undefined, { ...explanation, findings: [{ ...explanation.findings[0], quote: 'Выдуманный текст источника.' }] }, { ...explanation, summary: 'Очаг 99 мм.' }]) {
      expect(acceptDemoResponse(document, prepared.binding, { ...result, analysis: { ...result.analysis, llmExplanation: value } })).toBeNull();
    }
  });
  it.each(['missing', 'invented_quote', 'wrong_section', 'new_number', 'new_specialty', 'extra_field'])('rejects unsafe or incomplete model explanation: %s', async failure => {
    const document = doc();
    const explanation = stubExplanation(document.sections);
    const response: Record<string, unknown> = { statementIds: ['conclusion'], explanationIds: [], llmExplanation: explanation };
    if (failure === 'missing') delete response.llmExplanation;
    if (failure === 'invented_quote') explanation.findings[0].quote = 'Вымыслили другую находку.';
    if (failure === 'wrong_section') explanation.findings[0].sectionId = 'recommendations';
    if (failure === 'new_number') explanation.findings[0].explanation = 'Размер очага 77 мм.';
    if (failure === 'new_specialty') explanation.summary = 'Рекомендован кардиолог.';
    if (failure === 'extra_field') response.diagnosis = 'Новый диагноз';
    await expect(runModel(minimize(document.sections).sections, [], { env, fetcher: async () => output(response) }, undefined, true)).rejects.toMatchObject({ code: 'invalid_model_response' });
  });
  it('repeats identifier removal at the CLI last boundary in the richer schema', async () => {
    const text = 'Фамилия: Тестова\nИмя: Мария\nТелефон: +7 (999) 123-45-67\nПлевральный выпот не выявлен.';
    const result = await runModel([{ id: 'description', text }], [], { env: { LLM_PROVIDER: 'codex_cli', CODEX_MODEL: 'stub', ALLOW_LOCAL_LIVE: '1' }, localDevelopment: true, codexRunner: async invocation => {
      expect(invocation.input).not.toMatch(/Тестова|Мария|999/);
      expect(JSON.parse(invocation.input).sections).toEqual([{ id: 'description', text: 'Плевральный выпот не выявлен.' }]);
      return JSON.stringify({ statementIds: ['description'], explanationIds: [], llmExplanation: { summary: 'Плевральный выпот не выявлен.', findings: [{ sectionId: 'description', quote: 'Плевральный выпот не выявлен.', explanation: 'В описании указано отсутствие плеврального выпота.' }] } });
    } }, undefined, true);
    expect(result.llmExplanation?.findings[0].quote).toBe('Плевральный выпот не выявлен.');
  });
});
