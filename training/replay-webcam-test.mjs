import { chromium } from '@playwright/test';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'vite';

// Runs the real Webcam test page end to end without a person: the camera is
// replaced by held-out FSL-105 test clips (never used for training) for each
// requested sign and a blank frame for no-hand checks. Records go to
// .tools/webcam-replay, never .tools/webcam, so they cannot leak into training.
// Read them with FSL_WEBCAM_DIR=.tools/webcam-replay npm run report:webcam.
const root = process.cwd();
const outDir = '.tools/webcam-replay';
const tests = JSON.parse(await readFile('.tools/fsl105/features-extended.json', 'utf8')).filter(s => s.split === 'test');
const used = {};
const clipFor = datasetId => {
  const clips = tests.filter(s => s.datasetId === datasetId);
  const clip = clips[(used[datasetId] = (used[datasetId] ?? -1) + 1) % clips.length];
  return '/@fs/' + join(root, '.tools/fsl105', clip.path);
};

function fakeCamera() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const source = document.createElement('video');
  source.muted = true; source.playsInline = true; source.loop = true;
  let showClip = false;
  window.replay = {
    load: async url => { showClip = Boolean(url); if (url) { source.src = url; await new Promise(r => { source.onloadeddata = r; }); source.pause(); source.currentTime = 0; } },
    play: () => { if (showClip) { source.currentTime = 0; source.play(); } }
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const ctx = canvas.getContext('2d');
    const timer = setInterval(() => {
      if (track.readyState === 'ended') { clearInterval(timer); return; }
      ctx.fillStyle = '#5a5d58'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (showClip && source.videoWidth) {
        const scale = Math.min(canvas.width / source.videoWidth, canvas.height / source.videoHeight);
        ctx.drawImage(source, (canvas.width - source.videoWidth * scale) / 2, (canvas.height - source.videoHeight * scale) / 2, source.videoWidth * scale, source.videoHeight * scale);
      }
      track.requestFrame();
    }, 40);
    return stream;
  };
}

await mkdir(outDir, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.FSL_CHROME_EXECUTABLE, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => console.error(error.message));
  await page.route('**/api/webcam-trials', async route => {
    const record = route.request().postDataJSON();
    await appendFile(`${outDir}/${record.sessionId}.jsonl`, JSON.stringify({ ...record, receivedAt: new Date().toISOString(), replay: true }) + '\n');
    if (record.type === 'trial') console.log(`${record.trialIndex + 1}/${record.trialCount} ${record.target.label.padEnd(12)} → ${String(record.result.label).padEnd(6)} ${record.outcome}`);
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ saved: true, file: `${outDir}/${record.sessionId}.jsonl` }) });
  });
  await page.addInitScript(fakeCamera);
  await page.goto('http://127.0.0.1:5174/#test');
  await page.getByRole('button', { name: 'Start webcam test' }).click({ timeout: 60000 });
  const labels = Object.fromEntries((await import('../src/content.js')).references.map(r => [r.label, r.datasetId]));
  for (let trial = 1; ; trial++) {
    const done = page.getByRole('heading', { name: 'Your webcam results' });
    await page.getByText(`Trial ${trial} of 23`).or(done).waitFor({ timeout: 30000 });
    if (await done.isVisible()) break;
    const label = await page.locator('.test-label').textContent();
    await page.evaluate(url => window.replay.load(url), label === 'No hands' ? null : clipFor(labels[label]));
    await page.locator('.capture-badge').waitFor({ timeout: 10000 });
    await page.evaluate(() => window.replay.play());
    await page.getByText(`Trial ${trial + 1} of 23`).or(done).waitFor({ timeout: 30000 });
  }
  await page.screenshot({ path: `${outDir}/summary.png`, fullPage: true });
} finally { await browser.close(); await server.close(); }
