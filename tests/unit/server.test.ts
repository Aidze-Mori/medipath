import { describe, expect, it } from 'vitest';
import { handleAnalyzeRequest } from '../../server/analyze';
import { runModel } from '../../server/model';
import { minimize } from '../../src/privacy/minimize';
import { SYNTHETIC_FIXTURES } from '../../src/domain';
import { admitModelCall } from '../../server/limits';
import { createAppServer } from '../../server/http';
import { once } from 'node:events';
import { stubExplanation } from './model-response-helper';

const body = { fixtureId: 'chest-referral', fixtureRevision: 1, reviewVariantId: 'canonical', operation: 'explain', requestId: 'test-request-0001' };
const request = (value: unknown) => new Request('http://localhost/api/analyze-demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
describe('public demo API admission', () => {
  it('rejects arbitrary fields, even if isSynthetic is true', async () => {
    const response = await handleAnalyzeRequest(request({ ...body, isSynthetic: true, text: 'PRIVATE-CANARY' }), { env: {} });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('PRIVATE-CANARY');
  });
  it('rejects unknown fixtures and oversized payloads', async () => {
    expect((await handleAnalyzeRequest(request({ ...body, fixtureId: 'unknown' }), { env: {} })).status).toBe(404);
    expect((await handleAnalyzeRequest(request({ ...body, text: 'x'.repeat(9000) }), { env: {} })).status).toBe(413);
  });
  it('accepts only integer fixture versions and resolves the exact released version before any provider call', async () => {
    const fetcher: typeof fetch = async () => { throw new Error('No provider request expected'); };
    for (const fixtureRevision of [0, -1, 1.5, '1', null, 1000001]) {
      expect((await handleAnalyzeRequest(request({ ...body, fixtureRevision }), { env: {}, fetcher })).status).toBe(400);
    }
    expect((await handleAnalyzeRequest(request({ ...body, fixtureRevision: 2 }), { env: {}, fetcher })).status).toBe(404);
    const current = SYNTHETIC_FIXTURES.find(fixture => fixture.id === 'explicit-urgent')!;
    const accepted = await handleAnalyzeRequest(request({ ...body, fixtureId: current.id, fixtureRevision: current.revision }), { env: {}, fetcher });
    expect(accepted.status).toBe(503);
    expect((await accepted.json()).error.code).toBe('live_not_configured');
  });
  it('fails closed without a configured provider and durable public limit', async () => {
    const response = await handleAnalyzeRequest(request(body), { env: { OPENAI_API_KEY: 'test', OPENAI_MODEL: 'test' } });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('live_not_configured');
  });
  it('supports the explicit jury demo without Redis while keeping canonical-only admission', async () => {
    const env = { NETLIFY: 'true', LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'test', OPENAI_MODEL: 'test', DEMO_WITHOUT_REDIS: '1' };
    const calls: string[] = [];
    const fetcher: typeof fetch = async (url) => {
      calls.push(String(url));
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ statementIds: ['conclusion'], explanationIds: [], llmExplanation: stubExplanation(SYNTHETIC_FIXTURES[0].sections) }) }] }] });
    };
    const rejected = await handleAnalyzeRequest(request({ ...body, isSynthetic: true, text: 'PRIVATE-CANARY' }), { env, fetcher });
    expect(rejected.status).toBe(400);
    expect(calls).toEqual([]);
    const accepted = await handleAnalyzeRequest(request(body), { env, fetcher });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).analysis.mode).toBe('synthetic_live');
    expect(calls).toEqual(['https://api.openai.com/v1/responses']);
    for (const value of ['0', 'true', '']) {
      await expect(admitModelCall({ ...env, DEMO_WITHOUT_REDIS: value }, { fetcher })).rejects.toMatchObject({ code: 'live_not_configured' });
    }
    await expect(admitModelCall({ ...env, OPENAI_API_KEY: '' }, { fetcher })).rejects.toMatchObject({ code: 'live_not_configured' });
    await expect(admitModelCall({ ...env, LLM_PROVIDER: 'codex_cli', CODEX_MODEL: 'test', ALLOW_LOCAL_LIVE: '1' }, { fetcher })).rejects.toMatchObject({ code: 'provider_local_only' });
  });
  it('runs a real adapter contract without accepting medical free text from the model', async () => {
    const seen: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      seen.push(String(url), String(init?.body));
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ statementIds: ['conclusion'], explanationIds: [] }) }] }] });
    };
    const result = await runModel(minimize(SYNTHETIC_FIXTURES[0].sections).sections, [], { env: { OPENAI_API_KEY: 'test-secret', OPENAI_MODEL: 'configured-model' }, fetcher });
    expect(result.statementIds).toEqual(['conclusion']);
    expect(seen[0]).toBe('https://api.openai.com/v1/responses');
    expect(seen[1]).not.toMatch(/canary|Тестов|1234567890123456|test-secret/);
    expect(JSON.parse(seen[1]).store).toBe(false);
    const invalid: typeof fetch = async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"statementIds":["imagined"],"explanationIds":[]}' }] }] });
    await expect(runModel(minimize(SYNTHETIC_FIXTURES[0].sections).sections, [], { env: { OPENAI_API_KEY: 'test', OPENAI_MODEL: 'test' }, fetcher: invalid })).rejects.toThrow();
  });
  it('uses the approved VseLLM endpoint and rejects other destinations before sending a secret', async () => {
    const env = { OPENAI_API_KEY: 'test-secret', OPENAI_MODEL: 'openai/gpt-5.2-chat', OPENAI_BASE_URL: 'https://api.vsellm.ru/v1/' };
    const calls: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push(String(url));
      expect(init?.redirect).toBe('error');
      expect(JSON.parse(String(init?.body)).store).toBe(false);
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ statementIds: ['conclusion'], explanationIds: [] }) }] }] });
    };
    const sections = minimize(SYNTHETIC_FIXTURES[0].sections).sections;
    await runModel(sections, [], { env, fetcher });
    expect(calls).toEqual(['https://api.vsellm.ru/v1/responses']);
    for (const OPENAI_BASE_URL of ['https://example.com/v1', 'http://api.vsellm.ru/v1', 'https://api.vsellm.ru/v1?key=secret', 'https://user:password@api.vsellm.ru/v1', 'https://api.vsellm.ru.evil.example/v1']) {
      await expect(runModel(sections, [], { env: { ...env, OPENAI_BASE_URL }, fetcher })).rejects.toMatchObject({ code: 'invalid_provider' });
    }
    expect(calls).toHaveLength(1);
  });
  it('requires successful durable admission before the provider call', async () => {
    const calls: string[] = [];
    const env = { OPENAI_API_KEY: 'test', OPENAI_MODEL: 'test', UPSTASH_REDIS_REST_URL: 'https://medipath-test.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'test' };
    const fetcher: typeof fetch = async (url, init) => {
      calls.push(String(url));
      if (String(url).includes('upstash')) return Response.json({ result: 1 });
      expect(String(init?.body)).not.toMatch(/canary|Тестов|1234567890123456/);
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ statementIds: ['conclusion'], explanationIds: [], llmExplanation: stubExplanation(SYNTHETIC_FIXTURES[0].sections) }) }] }] });
    };
    const response = await handleAnalyzeRequest(request(body), { env, fetcher });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.binding.requestId).toBe(body.requestId);
    expect(result.analysis.mode).toBe('synthetic_live');
    expect(calls).toEqual([env.UPSTASH_REDIS_REST_URL, 'https://api.openai.com/v1/responses']);
    await expect(admitModelCall(env, { fetcher: async () => Response.json({ result: 0 }) })).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
    await expect(admitModelCall(env, { fetcher: async () => Response.json({ error: 'failed' }) })).rejects.toMatchObject({ code: 'limit_unavailable', status: 503 });
  });
  it('serves an unknown API path as JSON 404 through the portable HTTP adapter', async () => {
    const server = createAppServer({ env: {} });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/unknown`);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toBe('application/json');
      expect(await response.json()).toEqual({ error: { code: 'not_found' } });
      const bare = await fetch(`http://127.0.0.1:${address.port}/api`);
      expect(bare.headers.get('content-type')).toBe('application/json');
      const invalid = await fetch(`http://127.0.0.1:${address.port}/api/analyze-demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, document: 'PRIVATE-CANARY' }) });
      expect(invalid.status).toBe(400);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});

describe('provider selection and failures', () => {
  const sections = minimize(SYNTHETIC_FIXTURES[0].sections).sections;
  const localEnv = { LLM_PROVIDER: 'codex_cli', CODEX_MODEL: 'test-model', ALLOW_LOCAL_LIVE: '1' };
  it('uses the CLI adapter with the same validated result contract', async () => {
    let called = false;
    const result = await runModel(sections, [], { env: localEnv, localDevelopment: true, codexRunner: async invocation => {
      called = true;
      expect(invocation.input).not.toMatch(/canary|Тестов|1234567890123456/);
      expect(invocation.instructions).toContain('untrusted data');
      return JSON.stringify({ statementIds: ['conclusion'], explanationIds: [] });
    } });
    expect(called).toBe(true);
    expect(result.statementIds).toEqual(['conclusion']);
  });
  it('refuses CLI on public adapters and Netlify even with the local opt-in', async () => {
    const run = () => Promise.reject(new Error('CLI must never be called'));
    await expect(runModel(sections, [], { env: localEnv, codexRunner: run })).rejects.toMatchObject({ code: 'provider_local_only' });
    await expect(runModel(sections, [], { env: { ...localEnv, NETLIFY: 'true' }, localDevelopment: true, codexRunner: run })).rejects.toMatchObject({ code: 'provider_local_only' });
    await expect(runModel(sections, [], { env: { ...localEnv, AWS_LAMBDA_FUNCTION_NAME: 'analyze' }, localDevelopment: true, codexRunner: run })).rejects.toMatchObject({ code: 'provider_local_only' });
  });
  it('cleans identifier canaries at the shared last boundary before either adapter', async () => {
    const raw = [{ id: 'conclusion' as const, text: 'ФИО: Иванова Мария Петровна\nТелефон: +7 (999) 123-45-67\nEmail: private@example.invalid\nАдрес: Личная, 17\nПаспорт: 4510 123456\nСНИЛС: 123-456-789 01\nСправа очаг 4 мм не выявлен.' }];
    const inspect = (body: string) => {
      expect(body).not.toMatch(/Иванова|999|private@example|Личная|4510|123-456/);
      expect(body).toContain('Справа очаг 4 мм не выявлен.');
    };
    await runModel(raw, [], { env: localEnv, localDevelopment: true, codexRunner: async invocation => { inspect(invocation.input); return '{"statementIds":["conclusion"],"explanationIds":[]}'; } });
    await runModel(raw, [], { env: { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'test', OPENAI_MODEL: 'test' }, fetcher: async (_url, init) => {
      inspect(JSON.parse(String(init?.body)).input);
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"statementIds":["conclusion"],"explanationIds":[]}' }] }] });
    } });
  });
  it('fails closed for disabled, incomplete and unknown providers', async () => {
    for (const env of [{ LLM_PROVIDER: 'disabled' }, { LLM_PROVIDER: 'openai' }, { LLM_PROVIDER: 'unknown' }]) await expect(runModel(sections, [], { env })).rejects.toBeTruthy();
  });
  it('reports network errors separately from model validation errors', async () => {
    const env = { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'test', OPENAI_MODEL: 'test' };
    await expect(runModel(sections, [], { env, fetcher: async () => { throw new TypeError('network unavailable'); } })).rejects.toMatchObject({ code: 'model_unavailable', status: 503 });
    await expect(runModel(sections, [], { env, fetcher: async () => new Response('not json') })).rejects.toMatchObject({ code: 'invalid_model_response', status: 503 });
    await expect(runModel(sections, [], { env, fetcher: async () => new Response('', { status: 429 }) })).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
    const controller = new AbortController(); controller.abort();
    await expect(runModel(sections, [], { env, signal: controller.signal, fetcher: async (_url, init) => { init?.signal?.throwIfAborted(); throw new Error('unexpected'); } })).rejects.toMatchObject({ code: 'timeout', status: 504 });
  });
  it('rejects model free text, invented IDs, empty evidence and extra fields from CLI', async () => {
    for (const output of ['invalid', '{"statementIds":["invented"],"explanationIds":[]}', '{"statementIds":[],"explanationIds":[]}', '{"statementIds":["conclusion"],"explanationIds":[],"diagnosis":"invented"}']) await expect(runModel(sections, [], { env: localEnv, localDevelopment: true, codexRunner: async () => output })).rejects.toMatchObject({ code: 'invalid_model_response' });
  });
  it('configures CLI with read-only sandbox, no inherited user instructions or access tools', async () => {
    const { codexArguments } = await import('../../server/codex');
    const args = codexArguments('/tmp/medipath-test', 'test-model');
    expect(args).toContain('--ignore-user-config');
    expect(args).toContain('--ignore-rules');
    expect(args).toContain('--ephemeral');
    expect(args).toContain('read-only');
    expect(args).toContain('web_search="disabled"');
    expect(args).toContain('shell_environment_policy.inherit="none"');
    for (const feature of ['shell_tool', 'apps', 'plugins', 'hooks', 'multi_agent', 'browser_use', 'computer_use', 'view_image']) expect(args[args.indexOf(feature) - 1]).toBe('--disable');
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });
});

describe('synthetic clinic source adapter', () => {
  it('returns canonical ready source records without pretending OCR confirmation', async () => {
    const { handleClinicRequest } = await import('../../server/clinic');
    const response = await handleClinicRequest(new Request('http://localhost/api/clinic-demo?patientId=demo-patient-01'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = await response.json();
    expect(result.source).toBe('synthetic_clinic_adapter');
    expect(result.records.map((record: { fixtureId: string }) => record.fixtureId)).toEqual(['chest-referral', 'breast-referral', 'chest-negative']);
    expect(result.records[0].sourceKind).toBe('structured');
    expect(result.records[0].status).toBe('ready');
    expect(result.records[0]).not.toHaveProperty('confirmedRevision');
  });
  it('refuses other patients, unknown or duplicate inputs, and non-read requests', async () => {
    const { handleClinicRequest } = await import('../../server/clinic');
    for (const [query, status] of [['patientId=someone-else', 404], ['patientId=demo-patient-01&fixtureId=unknown', 404], ['patientId=demo-patient-01&fixtureId=', 404], ['patientId=demo-patient-01&patientId=someone-else', 400], ['patientId=demo-patient-01&text=PRIVATE-CANARY', 400]] as const) {
      const response = await handleClinicRequest(new Request(`http://localhost/api/clinic-demo?${query}`));
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain('PRIVATE-CANARY');
    }
    expect((await handleClinicRequest(new Request('http://localhost/api/clinic-demo?patientId=demo-patient-01', { method: 'POST' }))).status).toBe(405);
  });
});
