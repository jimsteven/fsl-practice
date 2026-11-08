import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VOCAB, EMOTIONS, missingGlosses } from '../src/vocab.js';

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
  const known = { 'webcam-test-v1': ['trial', 'discard'], 'vocab-record-v1': ['sample', 'discard'] }[record?.protocolVersion];
  if (record?.schemaVersion !== 1 || !known?.includes(record.type) || !SESSION.test(record.sessionId) || !SESSION.test(record.trialId)) { res.writeHead(400); return res.end(); }
  await mkdir(dataDirectory, { recursive: true });
  const file = `${record.sessionId}.jsonl`;
  await appendFile(resolve(dataDirectory, file), JSON.stringify({ ...record, receivedAt: new Date().toISOString() }) + '\n');
  res.writeHead(201, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ saved: true, file: `.tools/webcam/${file}` }));
}

// Default: Jim's Mac, loopback only, webcam-test records saved for retraining.
// On a public Amp Box (AMP_DEPLOYMENT_URL set), visitors' webcam-test records
// are never accepted; results stay in their browser unless they download them.
// Local LLM interpretation through Ollama on this Mac. The browser never talks
// to Ollama directly (CSP connect-src 'self'); only validated gloss + expression
// tags are sent, never landmarks or video.
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
export const LLM_MODEL = process.env.FSL_LLM_MODEL || 'gemma3:12b';
const SYSTEM_PROMPT = `You turn a sequence of Filipino Sign Language (FSL) glosses into one short, natural English sentence, as the signer would say it.
FSL grammar differs from English: glosses omit articles, copulas and tense, and word order can differ. Time signs (TODAY, TOMORROW, YESTERDAY) set the tense. A sign can be a statement, a question or a request; choose whichever reads most naturally.
Each gloss has a facial-expression tag. Questioning means the signer is asking a question. Show Happy, Sad, Angry or Skeptical through word choice and punctuation (for example "!" or "..."), never with adverbs like "happily" or "angrily". Neutral adds nothing.
Keep the meaning of every gloss; do not drop any, and use each one once. NO SUGAR is one sign meaning "without sugar". Add only the small words English needs (pronouns, articles, "is", tense, punctuation). Add "want" or "please" only for a food or drink with nothing else to link it. Never add new facts, objects or words like "something".
An adjective after a noun usually describes it (COFFEE COLD = "the coffee is cold"). With no person signed, the signer means themselves ("I"). The tags are never words: do not write "happy", "skeptical" and so on in the sentence.
Examples:
HELLO (Happy), NICE TO MEET YOU (Happy) -> {"sentence": "Hello, nice to meet you!"}
MOTHER (Neutral), DEAF (Neutral) -> {"sentence": "My mother is deaf."}
TODAY (Neutral), FATHER (Questioning), RICE (Questioning) -> {"sentence": "Does Dad want rice today?"}
KNOW (Skeptical), NO (Skeptical) -> {"sentence": "I know... no."}
RICE (Angry), HOT (Angry) -> {"sentence": "The rice is hot!"}
COFFEE (Neutral), NO SUGAR (Neutral) -> {"sentence": "Coffee without sugar, please."}
YESTERDAY (Questioning), MOTHER (Questioning) -> {"sentence": "Mother, yesterday?"}
SLOW (Neutral), THANK YOU (Happy) -> {"sentence": "Slower, thank you!"}
Reply only as JSON: {"sentence": "<the English sentence>"}`;
async function interpret(req, res) {
  const chunks = [];
  for await (const chunk of req) { chunks.push(chunk); if (chunks.reduce((n, c) => n + c.length, 0) > 20000) return req.destroy(); }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_error) { res.writeHead(400); return res.end(); }
  const glosses = new Set(VOCAB.map(v => v.gloss));
  const signs = body?.signs;
  if (!Array.isArray(signs) || !signs.length || signs.length > 30 || !signs.every(s => glosses.has(s.gloss) && EMOTIONS.includes(s.emotion))) { res.writeHead(400); return res.end(); }
  const started = Date.now();
  const ask = async messages => {
    const response = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000), body: JSON.stringify({
      model: LLM_MODEL, stream: false, format: { type: 'object', properties: { sentence: { type: 'string' } }, required: ['sentence'] }, options: { temperature: .2 }, messages
    }) });
    if (!response.ok) throw new Error(`Ollama ${response.status}`);
    const sentence = String(JSON.parse((await response.json()).message.content).sentence || '').trim().slice(0, 400);
    if (!sentence) throw new Error('empty');
    return sentence;
  };
  try {
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: signs.map(s => `${s.gloss} (${s.emotion})`).join(', ') }];
    let sentence = await ask(messages);
    // One retry when a sign was dropped; the second answer is returned either way.
    const missing = missingGlosses(sentence, signs.map(s => s.gloss));
    if (missing.length) sentence = await ask([...messages, { role: 'assistant', content: JSON.stringify({ sentence }) }, { role: 'user', content: `You left out ${missing.join(', ')}. Rewrite the sentence so it includes the meaning of every sign.` }]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ sentence, model: LLM_MODEL, ms: Date.now() - started, retried: missing.length > 0 }));
  } catch (_error) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: `The local LLM (${LLM_MODEL} in Ollama) did not answer. Check that Ollama is running on this Mac.` }));
  }
}

export async function createLocalServer({ root = fileURLToPath(new URL('../dist', import.meta.url)), dataDirectory = fileURLToPath(new URL('../.tools/webcam', import.meta.url)), publicHost = null, llmEnabled = true } = {}) {
  const directory = await realpath(root);
  const build = createHash('sha256').update(await readFile(resolve(directory, 'index.html'))).digest('hex').slice(0, 16);
  return createServer(async (req, res) => {
    const port = req.socket.localPort;
    res.setHeaders(new Map(Object.entries(SECURITY_HEADERS)));
    res.setHeader('Cache-Control', 'no-cache');
    if (![`localhost:${port}`, `127.0.0.1:${port}`, publicHost].includes(req.headers.host)) { res.writeHead(403); return res.end(); }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/api/interpret' && req.method === 'POST') {
        if (publicHost || !llmEnabled) { res.writeHead(404); return res.end(); }
        if (![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin)) { res.writeHead(403); return res.end(); }
        return await interpret(req, res);
      }
      if (pathname === '/api/webcam-trials' && req.method === 'POST') {
        if (publicHost) { res.writeHead(404); return res.end(); }
        return await saveWebcamTrial(req, res, port, dataDirectory);
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); res.writeHead(405); return res.end(); }
      if (pathname === '/health.json') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok', build, scope: publicHost ? 'public-box' : 'personal-loopback-only', webcamSaving: !publicHost, interpret: publicHost || !llmEnabled ? null : LLM_MODEL }));
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
  const server = await createLocalServer({ publicHost: deployment?.host || null, llmEnabled: process.env.FSL_DISABLE_LLM !== '1' });
  const port = Number(process.env.PORT || process.env.FSL_PORT || 5173);
  const host = deployment ? '0.0.0.0' : '127.0.0.1';
  server.on('error', error => { console.error(`Local server could not start: ${error.message}`); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`FSL practice: ${deployment ? deployment.href : `http://localhost:${port}`}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}
