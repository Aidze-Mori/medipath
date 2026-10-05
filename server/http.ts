import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAnalyzeRequest } from './analyze';
import { handleClinicRequest } from './clinic';
import { handleDocumentAnalyzeRequest } from './analyzeDocument';
import { handleCapabilitiesRequest } from './capabilities';

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8' };
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" };

async function requestBody(request: IncomingMessage, response: ServerResponse, limit = 8192): Promise<Uint8Array | null> {
  return new Promise((resolveBody, reject) => {
    let size = 0, overLimit = false;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        if (!overLimit) { response.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ error: { code: 'too_large' } })); }
        overLimit = true;
        chunks.length = 0;
      } else if (!overLimit) chunks.push(chunk);
    });
    request.on('end', () => resolveBody(overLimit ? null : Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

export function createAppServer(options: { env?: Record<string, string | undefined>; staticDir?: string; host?: string } = {}) {
  const env = options.env ?? process.env;
  const root = resolve(options.staticDir ?? 'dist');
  const localDevelopment = ['127.0.0.1', '::1', 'localhost'].includes(options.host ?? '127.0.0.1');
  return createServer(async (incoming, outgoing) => {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) outgoing.setHeader(key, value);
    try {
      const url = new URL(incoming.url ?? '/', 'http://localhost');
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/capabilities') {
          const response = handleCapabilitiesRequest(new Request(url, { method: incoming.method ?? 'GET' }), { env, localDevelopment });
          outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries())); outgoing.end(await response.text()); return;
        }
        if (url.pathname === '/api/clinic-demo') {
          const response = await handleClinicRequest(new Request(url, { method: incoming.method ?? 'GET' }));
          outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
          outgoing.end(await response.text());
          return;
        }
        const documentOperation = url.pathname === '/api/analyze-document';
        if (!documentOperation && url.pathname !== '/api/analyze-demo') { outgoing.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); outgoing.end(JSON.stringify({ error: { code: 'not_found' } })); return; }
        if (documentOperation) {
          const loopback = (value: string) => { try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname); } catch { return false; } };
          if (!loopback(`http://${incoming.headers.host ?? ''}`) || incoming.headers.origin && !loopback(incoming.headers.origin)) { outgoing.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); outgoing.end(JSON.stringify({ error: { code: 'document_analysis_local_only' } })); return; }
        }
        const bytes = incoming.method === 'POST' ? await requestBody(incoming, outgoing, documentOperation ? 131072 : 8192) : undefined;
        if (bytes === null) return;
        const abortController = new AbortController();
        outgoing.on('close', () => { if (!outgoing.writableEnded) abortController.abort(); });
        const requestHeaders = new Headers();
        if (typeof incoming.headers['content-type'] === 'string') requestHeaders.set('content-type', incoming.headers['content-type']);
        const request = new Request(url, { method: incoming.method ?? 'GET', headers: requestHeaders, body: bytes as BodyInit | undefined, signal: abortController.signal });
        const response = await (documentOperation ? handleDocumentAnalyzeRequest : handleAnalyzeRequest)(request, { env, localDevelopment });
        outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        outgoing.end(await response.text());
        return;
      }
      if (!['GET', 'HEAD'].includes(incoming.method ?? 'GET')) { outgoing.writeHead(405, { Allow: 'GET, HEAD' }); outgoing.end(); return; }
      let relative: string;
      try { relative = decodeURIComponent(url.pathname); } catch { outgoing.writeHead(400); outgoing.end(); return; }
      const requested = ['/', '/patient', '/clinic', '/patient/', '/clinic/'].includes(relative) ? 'index.html' : relative.replace(/^\/+/, '');
      const target = resolve(root, requested);
      if (target !== root && !target.startsWith(`${root}${sep}`)) { outgoing.writeHead(404); outgoing.end(); return; }
      let actual: string;
      try { actual = await realpath(target); } catch { outgoing.writeHead(404); outgoing.end('Not found'); return; }
      const actualRoot = await realpath(root);
      if (!actual.startsWith(`${actualRoot}${sep}`) || !(await stat(actual)).isFile()) { outgoing.writeHead(404); outgoing.end(); return; }
      outgoing.writeHead(200, { 'Content-Type': MIME[extname(actual)] ?? 'application/octet-stream', 'Cache-Control': extname(actual) === '.html' ? 'no-cache' : 'public, max-age=3600' });
      if (incoming.method === 'HEAD') outgoing.end();
      else createReadStream(actual).on('error', () => outgoing.destroy()).pipe(outgoing);
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ error: { code: 'internal_error' } }));
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  createAppServer({ host }).listen(port, host, () => console.log(`MediPath server listening on ${host}:${port}`));
}
