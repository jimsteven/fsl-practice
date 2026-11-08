import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('portable launcher refuses an occupied port instead of reporting an unrelated or stale app as ready', async () => {
  // Use an extracted-folder layout containing spaces, without npm or a build.
  const directory = await mkdtemp(join(tmpdir(), 'fsl install '));
  await mkdir(join(directory, 'scripts'));
  await mkdir(join(directory, 'dist'));
  await writeFile(join(directory, 'dist/index.html'), '<title>new build</title>');
  for (const name of ['install.mjs', 'run-local.mjs']) await copyFile(new URL(`../scripts/${name}`, import.meta.url), join(directory, 'scripts', name));
  let health = { status: 'ok', scope: 'public-box', build: 'old', interpret: null };
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(health)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    for (const scope of ['public-box', 'personal-loopback-only']) {
      health = { ...health, scope };
      await assert.rejects(promisify(execFile)(process.execPath, [join(directory, 'scripts/install.mjs'), '--start', '--skip-llm', '--no-open'], {
        env: { ...process.env, FSL_PORT: String(port) }
      }), error => error.code === 1 && /different app or build/.test(error.stderr));
      assert.equal((await fetch(`http://127.0.0.1:${port}/health.json`)).status, 200);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
