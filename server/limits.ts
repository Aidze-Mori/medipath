import { ServiceError } from './errors';
import { resolveProvider } from './provider';
type Environment = Record<string, string | undefined>;
const localCalls: number[] = [];
export function hasDurableLimit(env: Environment): boolean {
  if (!env.UPSTASH_REDIS_REST_TOKEN || !env.UPSTASH_REDIS_REST_URL) return false;
  try { const url = new URL(env.UPSTASH_REDIS_REST_URL); return url.protocol === 'https:' && url.hostname.endsWith('.upstash.io') && !url.username && !url.password && url.pathname === '/'; } catch { return false; }
}
export async function admitModelCall(env: Environment, options: { localDevelopment?: boolean; fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<void> {
  resolveProvider(env, options.localDevelopment);
  if (options.localDevelopment && env.ALLOW_LOCAL_LIVE === '1') {
    const now = Date.now();
    while (localCalls.length && localCalls[0] < now - 60000) localCalls.shift();
    if (localCalls.length >= 3) throw new ServiceError('rate_limited', 429);
    localCalls.push(now);
    return;
  }
  // Explicit jury-only deployment option: no shared spending cap is claimed.
  if (env.DEMO_WITHOUT_REDIS === '1') return;
  if (!hasDurableLimit(env)) throw new ServiceError('live_not_configured', 503);
  const minute = Math.floor(Date.now() / 60000), day = Math.floor(Date.now() / 86400000);
  const script = "local m=tonumber(redis.call('GET',KEYS[1]) or '0'); local d=tonumber(redis.call('GET',KEYS[2]) or '0'); if m>=10 or d>=100 then return 0 end; redis.call('INCR',KEYS[1]); redis.call('EXPIRE',KEYS[1],120); redis.call('INCR',KEYS[2]); redis.call('EXPIRE',KEYS[2],172800); return 1";
  try {
    const response = await (options.fetcher ?? fetch)(env.UPSTASH_REDIS_REST_URL!, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(['EVAL', script, '2', `medipath:v1:minute:${minute}`, `medipath:v1:day:${day}`]), signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) });
    if (!response.ok) throw new ServiceError('limit_unavailable', 503);
    const result = await response.json() as { result?: unknown };
    if (result.result === 0) throw new ServiceError('rate_limited', 429);
    if (result.result !== 1) throw new ServiceError('limit_unavailable', 503);
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError('limit_unavailable', 503);
  }
}
