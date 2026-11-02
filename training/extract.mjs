import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'vite';

const root = process.cwd();
// `extract:dataset -- extended` reads add-negatives.py output and reuses rows
// already extracted with the same preprocessing instead of decoding them again.
const extended = process.argv[2] === 'extended';
const output = extended ? '.tools/fsl105/features-extended.json' : '.tools/fsl105/features.json';
const samples = JSON.parse(await readFile(extended ? '.tools/fsl105/samples-extended.json' : '.tools/fsl105/samples.json', 'utf8'));
const previous = new Map();
for (const file of extended ? ['.tools/fsl105/features.json', output] : []) {
  try { for (const row of JSON.parse(await readFile(file, 'utf8'))) previous.set(row.path, row); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const server = await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.FSL_CHROME_EXECUTABLE, headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', error => console.error(error.message));
  await page.goto('http://127.0.0.1:5174/training/extract.html');
  await page.waitForFunction(() => typeof window.extractClip === 'function');
  const rows = [];
  for (const [i, sample] of samples.entries()) {
    if (!/^clips\/[0-9]+\/[0-9]+\.MOV$/.test(sample.path)) throw new Error('Invalid dataset clip path.');
    if (previous.has(sample.path)) { rows.push({ ...previous.get(sample.path), ...sample }); continue; }
    // Native Vite serving honors byte ranges; fulfilling entire MOV requests in
    // a browser route breaks seeks and silently extracts the wrong frames.
    const result = await page.evaluate(path => window.extractClip(path), '/@fs/' + join(root, '.tools/fsl105', sample.path));
    rows.push({ ...sample, ...result });
    console.log(`${i + 1}/${samples.length} ${sample.path} ${sample.split}: ${Math.round(result.coverage * 100)}% one-hand frames`);
    if (extended && rows.length % 50 === 0) await writeFile(output, JSON.stringify(rows));
  }
  await mkdir('.tools/fsl105', { recursive: true });
  await writeFile(output, JSON.stringify(rows));
} finally { await browser.close(); await server.close(); }
