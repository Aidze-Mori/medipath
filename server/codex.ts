import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServiceError } from './errors';
import type { Environment } from './provider';

export interface CodexInvocation { instructions: string; input: string; schema: object; env: Environment; signal: AbortSignal }
export type CodexRunner = (invocation: CodexInvocation) => Promise<string>;
const DISABLED_FEATURES = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'multi_agent', 'multi_agent_v2', 'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser', 'image_generation', 'view_image', 'js_repl', 'code_mode', 'code_mode_host', 'skill_search', 'skill_mcp_dependency_install', 'memories', 'workspace_dependencies', 'tool_suggest'];

export function codexArguments(directory: string, model: string): string[] {
  return [
    '--no-daemon', '--ask-for-approval', 'never', 'exec', '--ignore-user-config', '--ignore-rules',
    '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '--json',
    '--cd', directory, '--model', model, '--output-schema', join(directory, 'schema.json'),
    '--output-last-message', join(directory, 'response.json'),
    ...DISABLED_FEATURES.flatMap(feature => ['--disable', feature]),
    '--enable', 'skip_host_skill_discovery',
    '-c', 'web_search="disabled"', '-c', 'mcp_servers={}', '-c', 'project_doc_max_bytes=0',
    '-c', 'skills.include_instructions=false', '-c', 'shell_environment_policy.inherit="none"',
    '-c', 'history.persistence="none"', '-c', 'model_reasoning_effort="low"',
    '-c', `model_instructions_file=${JSON.stringify(join(directory, 'instructions.txt'))}`, '-',
  ];
}

// Local demonstration only. No shell, user/project instructions, plugins,
// connectors, execution tools, or document-controlled command arguments.
export const runCodex: CodexRunner = async ({ instructions, input, schema, env, signal }) => {
  if (signal.aborted) throw new ServiceError('timeout', 504);
  const directory = await mkdtemp(join(tmpdir(), 'medipath-llm-'));
  let processClosed: Promise<void> | undefined;
  try {
    await writeFile(join(directory, 'schema.json'), JSON.stringify(schema), { mode: 0o600 });
    await writeFile(join(directory, 'instructions.txt'), instructions, { mode: 0o600 });
    const childEnv: Environment = {};
    for (const key of ['PATH', 'HOME', 'CODEX_HOME', 'TMPDIR', 'TEMP', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'SSL_CERT_FILE']) {
      if (env[key]) childEnv[key] = env[key];
      else if (process.env[key]) childEnv[key] = process.env[key];
    }
    childEnv.RUST_LOG = 'off';
    await new Promise<void>((resolve, reject) => {
      const child = spawn(env.CODEX_CLI_PATH || 'codex', codexArguments(directory, env.CODEX_MODEL!), { cwd: directory, env: childEnv, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      processClosed = new Promise(resolveClosed => child.once('close', () => resolveClosed()));
      let settled = false, bytes = 0, pending = '';
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: ServiceError) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        if (error) {
          child.kill('SIGTERM');
          killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
          killTimer.unref();
          reject(error);
        } else resolve();
      };
      const abort = () => finish(new ServiceError('timeout', 504));
      child.on('error', () => finish(new ServiceError('model_unavailable', 503)));
      child.stdin.on('error', () => finish(new ServiceError('model_unavailable', 503)));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 262144) finish(new ServiceError('invalid_model_response', 503)); });
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 262144) { finish(new ServiceError('invalid_model_response', 503)); return; }
        pending += chunk.toString('utf8');
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as { type?: string; item?: { type?: string } };
            if (event.type === 'error' || event.type === 'turn.failed') finish(new ServiceError('model_unavailable', 503));
            // CLI startup warnings use an "error" item as well. Only terminal
            // errors above fail the run; no command/MCP/web/file item is allowed.
            if (event.item?.type && !['agent_message', 'reasoning', 'plan', 'error'].includes(event.item.type)) finish(new ServiceError('invalid_model_response', 503));
          } catch { finish(new ServiceError('invalid_model_response', 503)); }
        }
      });
      child.once('close', code => { if (killTimer) clearTimeout(killTimer); finish(code === 0 ? undefined : new ServiceError('model_unavailable', 503)); });
      child.stdin.end(input);
    });
    const result = await readFile(join(directory, 'response.json'));
    if (result.byteLength > 16384) throw new ServiceError('invalid_model_response', 503);
    return result.toString('utf8');
  } finally {
    // Wait for termination before removing the directory to avoid racing a
    // late CLI output write after an abort or an oversized response.
    await processClosed;
    await rm(directory, { recursive: true, force: true });
  }
};
