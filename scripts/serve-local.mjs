import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.task': 'application/octet-stream', '.mp4': 'video/mp4', '.csv': 'text/csv; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'",
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'
};

const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TRIAL_BYTES = 2_000_000;

// The only write route: the Webcam test page appends its own records (hand
// landmarks and model answers, never video) to one JSONL file per session.
async function saveWebcamTrial(req, res, port, dataDirectory) {
  if (![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin)) { res.writeHead(403); return res.end(); }
  if (!/^application\/json(;|$)/.test(req.headers['content-type'] || '')) { res.writeHead(415); return res.end(); }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Read (and drop) a modestly oversized body so the browser receives the
    // 413 instead of a reset; abandon anything far beyond the limit.
    if (size > MAX_TRIAL_BYTES * 10) return req.destroy();
    if (size <= MAX_TRIAL_BYTES) chunks.push(chunk);
  }
  if (size > MAX_TRIAL_BYTES) { res.writeHead(413); return res.end(); }
  let record;
  try { record = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_error) { res.writeHead(400); return res.end(); }
  if (record?.schemaVersion !== 1 || record.protocolVersion !== 'webcam-test-v1' || !['trial', 'discard'].includes(record.type) || !SESSION.test(record.sessionId) || !SESSION.test(record.trialId)) { res.writeHead(400); return res.end(); }
  await mkdir(dataDirectory, { recursive: true });
  const file = `${record.sessionId}.jsonl`;
  await appendFile(resolve(dataDirectory, file), JSON.stringify({ ...record, receivedAt: new Date().toISOString() }) + '\n');
  res.writeHead(201, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ saved: true, file: `.tools/webcam/${file}` }));
}

// Default: Jim's Mac, loopback only, webcam-test records saved for retraining.
// On a public Amp Box (AMP_DEPLOYMENT_URL set), visitors' webcam-test records
// are never accepted; results stay in their browser unless they download them.
export async function createLocalServer({ root = fileURLToPath(new URL('../dist', import.meta.url)), dataDirectory = fileURLToPath(new URL('../.tools/webcam', import.meta.url)), publicHost = null } = {}) {
  const directory = await realpath(root);
  const build = createHash('sha256').update(await readFile(resolve(directory, 'index.html'))).digest('hex').slice(0, 16);
  return createServer(async (req, res) => {
    const port = req.socket.localPort;
    res.setHeaders(new Map(Object.entries(SECURITY_HEADERS)));
    res.setHeader('Cache-Control', 'no-cache');
    if (![`localhost:${port}`, `127.0.0.1:${port}`, publicHost].includes(req.headers.host)) { res.writeHead(403); return res.end(); }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/api/webcam-trials' && req.method === 'POST') {
        if (publicHost) { res.writeHead(404); return res.end(); }
        return await saveWebcamTrial(req, res, port, dataDirectory);
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); res.writeHead(405); return res.end(); }
      if (pathname === '/health.json') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', build, scope: publicHost ? 'public-box' : 'personal-loopback-only', webcamSaving: !publicHost }));
      }
      if (pathname.split('/').some(part => part.startsWith('.')) || pathname.includes('\\') || pathname.includes('\0')) { res.writeHead(404); return res.end(); }
      const file = await realpath(resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname)));
      if (!file.startsWith(directory + sep) || !TYPES[extname(file)]) { res.writeHead(404); return res.end(); }
      const info = await stat(file);
      if (!info.isFile()) { res.writeHead(404); return res.end(); }
      let start = 0, end = info.size - 1, status = 200;
      res.setHeader('Accept-Ranges', 'bytes');
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
        start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
        status = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
      }
      res.writeHead(status, { 'Content-Type': TYPES[extname(file)], 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(file, { start, end });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) { res.writeHead(error.code === 'ENOENT' || error instanceof URIError ? 404 : 500); res.end(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const deployment = process.env.AMP_DEPLOYMENT_URL ? new URL(process.env.AMP_DEPLOYMENT_URL) : null;
  const server = await createLocalServer({ publicHost: deployment?.host || null });
  const port = Number(process.env.PORT || process.env.FSL_PORT || 5173);
  const host = deployment ? '0.0.0.0' : '127.0.0.1';
  server.on('error', error => { console.error(`Local server could not start: ${error.message}`); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`FSL practice: ${deployment ? deployment.href : `http://localhost:${port}`}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}
