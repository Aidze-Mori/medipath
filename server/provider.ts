import { ServiceError } from './errors';
export type LlmProvider = 'disabled' | 'openai' | 'codex_cli';
export type Environment = Record<string, string | undefined>;
export function responsesEndpoint(env: Environment): string {
  const base = (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/u, '');
  // Only the two approved server-side destinations may receive the API key.
  if (!['https://api.openai.com/v1', 'https://api.vsellm.ru/v1'].includes(base)) throw new ServiceError('invalid_provider', 503);
  return `${base}/responses`;
}
export function resolveProvider(env: Environment, localDevelopment = false): LlmProvider {
  const provider = env.LLM_PROVIDER?.trim() || (env.OPENAI_API_KEY && env.OPENAI_MODEL ? 'openai' : 'disabled');
  if (provider === 'disabled') throw new ServiceError('live_not_configured', 503);
  if (provider === 'openai') {
    if (!env.OPENAI_API_KEY?.trim() || !env.OPENAI_MODEL?.trim()) throw new ServiceError('live_not_configured', 503);
    responsesEndpoint(env);
    return provider;
  }
  if (provider === 'codex_cli') {
    if (!localDevelopment || env.ALLOW_LOCAL_LIVE !== '1' || env.NETLIFY === 'true' || env.AWS_LAMBDA_FUNCTION_NAME) throw new ServiceError('provider_local_only', 503);
    if (!env.CODEX_MODEL?.trim()) throw new ServiceError('live_not_configured', 503);
    return provider;
  }
  throw new ServiceError('invalid_provider', 503);
}
