import type { RuntimeCapabilities } from '../src/privacy/documentContract';
import { hasDurableLimit } from './limits';
import { resolveProvider, type Environment } from './provider';
import { ServiceError } from './errors';

export function runtimeCapabilities(env: Environment, localDevelopment = false): RuntimeCapabilities {
  const requested = env.LLM_PROVIDER?.trim() || (env.OPENAI_API_KEY && env.OPENAI_MODEL ? 'openai' : 'disabled');
  const provider = ['codex_cli', 'openai'].includes(requested) ? requested as 'codex_cli' | 'openai' : 'disabled';
  const result: RuntimeCapabilities = { provider, configured: false, documentAnalysisAllowed: false, reason: 'disabled' };
  try { resolveProvider(env, localDevelopment); }
  catch (error) {
    const code = error instanceof ServiceError ? error.code : '';
    result.reason = code === 'invalid_provider' ? 'invalid_provider' : code === 'provider_local_only' ? 'local_only' : requested === 'disabled' ? 'disabled' : 'missing_config';
    return result;
  }
  if (!(localDevelopment && env.ALLOW_LOCAL_LIVE === '1') && env.DEMO_WITHOUT_REDIS !== '1' && !hasDurableLimit(env)) return { ...result, reason: 'durable_limit_required' };
  result.configured = true;
  const cloud = !localDevelopment || env.NETLIFY === 'true' || !!env.AWS_LAMBDA_FUNCTION_NAME;
  if (cloud && env.ALLOW_CLOUD_DOCUMENTS !== '1') return { ...result, reason: 'local_only' };
  if (env.ALLOW_ANONYMIZED_DOCUMENTS !== '1' || !cloud && env.ALLOW_LOCAL_LIVE !== '1') return { ...result, reason: 'document_opt_in_required' };
  return { ...result, documentAnalysisAllowed: true, reason: 'ready' };
}
export function handleCapabilitiesRequest(request: Request, options: { env: Environment; localDevelopment?: boolean }): Response {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (request.method !== 'GET') return Response.json({ error: { code: 'method_not_allowed' } }, { status: 405, headers: { ...headers, Allow: 'GET' } });
  return Response.json(runtimeCapabilities(options.env, options.localDevelopment), { headers });
}
