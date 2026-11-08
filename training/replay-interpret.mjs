import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { VOCAB } from '../src/vocab.js';

// End-to-end check of the Interpret page on the running local server
// (default http://localhost:5173): held-out FSL-105 test clips of the given
// glosses play back to back at the camera boundary, then the page's real
// segmentation, vocabulary model, expression tags and local LLM run unchanged.
// Usage: node training/replay-interpret.mjs "GOOD MORNING,MOTHER,COFFEE,HOT,NO SUGAR" [baseURL]
const glosses = (process.argv[2] || 'GOOD MORNING,MOTHER,COFFEE,HOT,NO SUGAR').split(',');
const base = process.argv[3] || 'http://localhost:5173';
const samples = JSON.parse(await readFile('.tools/fsl105/vocab-samples.json', 'utf8'));
const clips = glosses.map(g => {
  const sign = VOCAB.find(v => v.gloss === g);
  if (!sign) throw new Error(`Unknown gloss ${g}`);
  const clip = samples.find(s => s.datasetId === sign.datasetId && s.split === 'test');
  return { gloss: g, path: clip.path };
});

function sequenceCamera(urls) {
  navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d');
    const source = document.createElement('video');
    source.muted = true; source.playsInline = true;
    let index = -1, playing = false;
    window.replayDone = false;
    const next = async () => {
      index++;
      if (index >= urls.length) { playing = false; window.replayDone = true; return; }
      source.src = urls[index]; await source.play(); playing = true;
    };
    source.onended = next;
    window.startReplay = next;
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    setInterval(() => {
      ctx.fillStyle = '#4a4d48'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (playing && source.videoWidth) {
        const scale = Math.min(canvas.width / source.videoWidth, canvas.height / source.videoHeight);
        ctx.drawImage(source, (canvas.width - source.videoWidth * scale) / 2, (canvas.height - source.videoHeight * scale) / 2, source.videoWidth * scale, source.videoHeight * scale);
      }
      track.requestFrame();
    }, 40);
    return stream;
  };
}

const browser = await chromium.launch({ executablePath: process.env.FSL_CHROME_EXECUTABLE, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/replay/**', async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.replace('/replay/', ''));
    if (!clips.some(c => c.path === path)) return route.abort();
    await route.fulfill({ status: 200, contentType: 'video/mp4', body: await readFile(`.tools/fsl105/${path}`) });
  });
  await page.addInitScript(sequenceCamera, clips.map(c => `/replay/${c.path}`));
  await page.goto(`${base}/#interpret`);
  await page.getByText(/Experimental model ready/).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.startReplay());
  await page.waitForFunction(() => window.replayDone, null, { timeout: 120000 });
  // Let the final sign lock in on rest, then let the 2-second auto-interpret
  // finish its local LLM call before reading the page.
  await page.waitForTimeout(4500);
  await page.waitForFunction(() => !/Interpreting/.test(document.querySelector('.interpret-sentence')?.textContent || ''), null, { timeout: 30000 });
  const recognized = await page.locator('.gloss-pill').allTextContents();
  const sentence = await page.locator('.interpret-sentence').textContent().catch(() => null);
  const added = await page.locator('.interpret-sentence u').allTextContents();
  console.log(JSON.stringify({ signed: glosses, clips: clips.map(c => c.path), recognized, sentence, underlined: added }, null, 2));
  if (process.argv[4]) await page.screenshot({ path: process.argv[4], fullPage: true });
} finally { await browser.close(); }
