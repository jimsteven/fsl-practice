import { spawn } from 'node:child_process';
import { open, mkdir, access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const root = fileURLToPath(new URL('..', import.meta.url));
// Installation and launch deliberately use loopback, not a remote Ollama URL.
export const ollamaURL = 'http://127.0.0.1:11434';
export const model = process.env.FSL_LLM_MODEL || 'gemma3:12b';
export const ollamaRelativePath = process.platform === 'win32' ? 'ollama.exe' : process.platform === 'linux' ? 'bin/ollama' : 'ollama';
export const ollamaBinary = resolve(root, '.tools/ollama', ollamaRelativePath);

export async function ollamaReady() {
  try {
    const response = await fetch(`${ollamaURL}/api/version`, { signal: AbortSignal.timeout(2000) });
    return response.ok && typeof (await response.json()).version === 'string';
  } catch (_error) { return false; }
}

async function background(command, args, logName, env = process.env) {
  await mkdir(resolve(root, '.tools'), { recursive: true });
  const log = await open(resolve(root, '.tools', logName), 'a', 0o600);
  try {
    const child = spawn(command, args, { cwd: root, env, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  } finally { await log.close(); }
}

export async function startOllama() {
  if (await ollamaReady()) return;
  await access(ollamaBinary);
  await background(ollamaBinary, ['serve'], 'ollama.log', { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' });
  for (let i = 0; i < 60; i++) {
    if (await ollamaReady()) return;
    await delay(1000);
  }
  throw new Error('Ollama did not start. See .tools/ollama.log; port 11434 may already be occupied.');
}

export async function loadModel() {
  // Cold GPU/backend initialization can exceed the app's request deadline.
  console.log(`Loading ${model}; the first launch can take a few minutes...`);
  const response = await fetch(`${ollamaURL}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, prompt: '', stream: false }), signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!response.ok) throw new Error(`Cannot load ${model}: ${await response.text()}. Rerun installation, or try FSL_LLM_MODEL=gemma3:4b / --skip-llm on a smaller PC.`);
}

export async function startApp({ llm = true, browser = true } = {}) {
  if (llm) { await startOllama(); await loadModel(); }
  const port = Number(process.env.FSL_PORT || 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('FSL_PORT must be between 1 and 65535.');
  const url = `http://127.0.0.1:${port}`;
  // Compare the served build, not just an open port, before reusing a process.
  const { createHash } = await import('node:crypto');
  const build = createHash('sha256').update(await readFile(resolve(root, 'dist/index.html'))).digest('hex').slice(0, 16);
  const ready = async () => {
    let response;
    try { response = await fetch(`${url}/health.json`, { signal: AbortSignal.timeout(2000) }); }
    catch (_error) { return false; }
    let health;
    try { health = await response.json(); } catch (_error) { /* Another application may own this port. */ }
    if (response.ok && health?.status === 'ok' && health.scope === 'personal-loopback-only' && health.build === build && health.interpret === (llm ? model : null)) return true;
    throw new Error(`Port ${port} serves a different app or build. Stop it, or set FSL_PORT to another port and retry.`);
  };
  if (!await ready()) {
    // A cloud deployment environment must not make this personal launcher public.
    await background(process.execPath, [resolve(root, 'scripts/serve-local.mjs')], 'local-server.log', { ...process.env, AMP_DEPLOYMENT_URL: '', PORT: String(port), OLLAMA_URL: ollamaURL, FSL_DISABLE_LLM: llm ? '' : '1' });
    let started = false;
    for (let i = 0; i < 30; i++) {
      if (await ready()) { started = true; break; }
      await delay(500);
    }
    if (!started) throw new Error('App did not start. See .tools/local-server.log.');
  }
  console.log(`FSL practice is ready: http://localhost:${port}`);
  if (browser) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    const child = spawn(command, [`http://localhost:${port}`], { stdio: 'ignore', windowsHide: true });
    child.on('error', () => console.log('Open the address above in Chrome or Edge.'));
    child.unref();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await startApp({ llm: !process.argv.includes('--skip-llm') }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
