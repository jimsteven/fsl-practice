import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { root, model, ollamaURL, ollamaBinary, ollamaRelativePath, ollamaReady, startOllama, loadModel, startApp } from './run-local.mjs';

const args = process.argv.slice(2);
const allowed = ['--start', '--no-start', '--skip-llm', '--no-open', '--help'];
if (args.some(arg => !allowed.includes(arg))) {
  console.error(`Unknown option. Use one of: ${allowed.join(', ')}`);
  process.exit(1);
}
if (args.includes('--help')) {
  console.log('Install Node dependencies, tracking assets, Ollama and the local model, then launch.\n--start: launch an existing installation\n--no-start: install without launching the app\n--skip-llm: practice/recognition only, without Ollama or sentence generation\n--no-open: do not open a browser automatically\nFSL_LLM_MODEL selects the model (default gemma3:12b). FSL_PORT selects the app port.');
  process.exit(0);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function installOllama() {
  if (await ollamaReady()) {
    console.log('Reusing the running local Ollama service.');
    return;
  }
  const lock = JSON.parse(await readFile(new URL('./ollama-assets.json', import.meta.url), 'utf8'));
  const asset = lock.assets[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error('Ollama requires macOS, glibc Linux or Windows on x64/ARM64.');
  const destination = resolve(root, '.tools/ollama');
  const marker = resolve(destination, '.fsl-version');
  try {
    if ((await readFile(marker, 'utf8')).trim() === lock.version) { await access(ollamaBinary); return; }
    throw new Error('The bundled Ollama version differs. Move .tools/ollama aside and retry.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Never replace an existing manual installation in our target directory.
  try { await access(destination); throw new Error('Move the existing .tools/ollama directory aside and retry.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temp = await mkdtemp(resolve(root, '.tools/ollama-download-'));
  try {
    const [name, expected] = asset;
    const archive = resolve(temp, name);
    const url = `https://github.com/ollama/ollama/releases/download/v${lock.version}/${name}`;
    console.log(`Downloading Ollama ${lock.version} (${name}); this can exceed 1.5 GB...`);
    const response = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
    if (!response.ok) throw new Error(`Ollama download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { flags: 'wx' }));
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    if (hash.digest('hex') !== expected) throw new Error('Ollama checksum mismatch; refusing to extract.');
    const unpacked = resolve(temp, 'unpacked');
    await mkdir(unpacked);
    if (name.endsWith('.zip')) {
      // Environment variables avoid quoting paths containing apostrophes/spaces.
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:FSL_ARCHIVE -DestinationPath $env:FSL_UNPACKED'], { env: { ...process.env, FSL_ARCHIVE: archive, FSL_UNPACKED: unpacked } });
    } else if (name.endsWith('.zst')) {
      const child = spawn('tar', ['-xf', '-', '-C', unpacked], { stdio: ['pipe', 'inherit', 'inherit'] });
      const finished = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(`tar exited with code ${code}`)));
      });
      // Node includes zstd: no system zstd/package-manager installation needed.
      const { createZstdDecompress } = await import('node:zlib');
      await Promise.all([pipeline(createReadStream(archive), createZstdDecompress(), child.stdin), finished]);
    } else {
      await run('tar', ['-xzf', archive, '-C', unpacked]);
    }
    const binary = resolve(unpacked, ollamaRelativePath);
    await access(binary);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(resolve(unpacked, '.fsl-version'), lock.version + '\n');
    await rename(unpacked, destination);
  } finally { await rm(temp, { recursive: true, force: true }); }
}

async function pullModel() {
  console.log(`Downloading/checking ${model}. The first model download is several GB; keep this window open.`);
  const response = await fetch(`${ollamaURL}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal: AbortSignal.timeout(2 * 60 * 60 * 1000) });
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
  let buffer = '', last = '', success = false;
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const update = JSON.parse(line);
      if (update.error) throw new Error(update.error);
      const status = update.total ? `${update.status}: ${Math.floor(100 * (update.completed || 0) / update.total)}%` : update.status;
      if (status !== last) { console.log(status); last = status; }
      if (update.status === 'success') success = true;
    }
  }
  if (!success) throw new Error('Model download ended before success. Rerun the installer to resume.');
  await loadModel();
}

try {
  if (!['darwin', 'linux', 'win32'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) throw new Error('Supported platforms: macOS/Linux/Windows, x64/ARM64.');
  const llm = !args.includes('--skip-llm');
  if (!args.includes('--start')) {
    await mkdir(resolve(root, '.tools'), { recursive: true });
    console.log('Installing app dependencies with the locked npm versions...');
    // npm.cmd cannot be spawned directly on Windows without a shell. Run its JS
    // entry point with this same pinned Node instead; paths need no shell quoting.
    const npm = resolve(process.execPath, '..', process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
    await run(process.execPath, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    await run(process.execPath, [resolve(root, 'scripts/setup-tracking.mjs')]);
    // References and trained models ship with the source ZIP, including attribution.
    const provenance = JSON.parse(await readFile(resolve(root, 'public/references/provenance.json'), 'utf8'));
    for (const asset of provenance.assets) {
      const bytes = await readFile(resolve(root, 'public', asset.path.replace(/^\//, '')));
      if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Reference checksum mismatch: ${asset.path}`);
    }
    await run(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build']);
    if (llm) { await installOllama(); await startOllama(); await pullModel(); }
    console.log('Installation complete. Rerun install.sh/install.ps1 with --start to launch next time.');
  }
  if (!args.includes('--no-start')) await startApp({ llm, browser: !args.includes('--no-open') });
} catch (error) {
  console.error(`Installation/launch failed: ${error.message}\nFix the issue and rerun the same command. Existing models and personal recordings are kept.`);
  process.exitCode = 1;
}
