import { test, expect } from '@playwright/test';

function referenceCamera(holdFrame) {
  navigator.mediaDevices.getUserMedia = async () => {
    const source = document.createElement('video');
    source.src = '/references/fsl105-24.mp4';
    source.muted = true; source.loop = true; source.playsInline = true;
    await source.play();
    window.testVideoSource = source;
    if (!holdFrame) return source.captureStream();
    // A genuine source frame held steady removes replay/sampling jitter from
    // the positive integration control. This is NOT a full-motion FSL test.
    await new Promise(resolve => { source.onseeked = resolve; source.currentTime = 2.5; });
    source.pause();
    const canvas = document.createElement('canvas');
    canvas.width = source.videoWidth; canvas.height = source.videoHeight;
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const timer = setInterval(() => {
      if (track.readyState === 'ended') { clearInterval(timer); return; }
      canvas.getContext('2d').drawImage(source, 0, 0); track.requestFrame();
    }, 80);
    return stream;
  };
}

test('a deliberate save and review note survive reload, and deletion removes both', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.camera-status')).toContainText('Hand tracking is available', { timeout: 30000 });
  await page.getByRole('button', { name: 'Begin attempt' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Finish attempt' }).click();
  await page.getByRole('button', { name: 'Save summary' }).click();
  await page.getByRole('link', { name: 'Sessions', exact: true }).click();
  await expect(page.locator('.session-row')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.session-row')).toHaveCount(1);
  await page.getByRole('link', { name: 'Review', exact: true }).click();
  await page.getByLabel('Review note for Exercise 01').fill('Use a little more room next time. Personal note, not expert feedback.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('status').last()).toContainText('Note saved');
  await page.reload();
  await expect(page.getByLabel('Review note for Exercise 01')).toHaveValue('Use a little more room next time. Personal note, not expert feedback.');
  await page.getByRole('link', { name: 'Sessions', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export summaries' }).click();
  expect((await download).suggestedFilename()).toBe('fsl-personal-sessions.json');
  await page.getByRole('button', { name: 'Clear summaries' }).click();
  await page.getByRole('button', { name: 'Delete saved attempts' }).click();
  // Wait for the committed deletion, not just the start of its async request.
  await expect(page.getByRole('heading', { name: 'No sessions. No pressure.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No sessions. No pressure.' })).toBeVisible();
  await page.getByRole('link', { name: 'Review', exact: true }).click();
  await expect(page.getByLabel('Review note for Exercise 01')).toHaveCount(0);
});

test('an attributed FSL video loads, plays, pauses and remains available without camera access', async ({ page }) => {
  await page.goto('/#learn');
  await page.getByRole('button', { name: /Hello.*Video reference/ }).click();
  const reference = page.getByLabel('FSL reference: Hello');
  await expect(reference).toBeVisible();
  await expect.poll(() => reference.evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2);
  await reference.evaluate(v => v.play());
  await expect.poll(() => reference.evaluate(v => v.currentTime)).toBeGreaterThan(0.1);
  await reference.evaluate(v => v.pause());
  expect(await reference.evaluate(v => v.paused)).toBe(true);
  await expect(page.getByRole('link', { name: /CC BY 4.0/ }).first()).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
  await expect(page.getByRole('link', { name: /FSL-105/ }).first()).toHaveAttribute('href', 'https://data.mendeley.com/datasets/48y2y99mb9/2');
  expect(await page.locator('.camera-viewport video').count()).toBe(0);
});

test('the real number model abstains on no-hand camera input', async ({ page }) => {
  await page.goto('/#practice?sign=fsl105-20');
  await expect(page.locator('.recognition-status')).toContainText('Experimental model ready', { timeout: 30000 });
  await expect(page.locator('.camera-status')).toContainText('Hand tracking is available', { timeout: 30000 });
  await page.getByRole('button', { name: 'Begin attempt' }).click();
  await expect(page.locator('.recognition-result')).toContainText('No suggestion — keep one hand visible', { timeout: 15000 });
  await expect(page.getByText(/Model suggestion:/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save summary' })).toBeEnabled();
});

for (const failure of ['missing', 'tampered', 'incompatible']) {
  test(`${failure} number assets fall back to usable tracking without a prediction`, async ({ page, context }) => {
    const asset = failure === 'incompatible' ? 'manifest.json' : 'weights.bin';
    await context.route(`**/models/numbers/${asset}`, route => failure === 'missing' ? route.abort() : route.fulfill({ status: 200, contentType: 'application/octet-stream', body: failure === 'incompatible' ? '{"schemaVersion":999}' : 'not the checksummed weights' }));
    await page.goto('/#practice?sign=fsl105-20');
    await expect(page.locator('.recognition-status')).toContainText('could not load or run', { timeout: 30000 });
    await expect(page.locator('.mode-line')).toContainText('Tracking only');
    await expect(page.locator('.camera-status')).toContainText('Hand tracking is available', { timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Begin attempt' })).toBeEnabled();
    await expect(page.getByText(/Model suggestion:/)).toHaveCount(0);
    await context.unroute(`**/models/numbers/${asset}`);
    await page.getByRole('button', { name: 'Retry recognition' }).click();
    await expect(page.locator('.recognition-status')).toContainText('Experimental model ready', { timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Begin attempt' })).toBeEnabled();
  });
}

test('a held licensed number frame goes through real tracking, real CNN, and a durable summary', async ({ page, context }) => {
  const requests = [];
  context.on('request', request => requests.push({ url: request.url(), method: request.method(), body: request.postData() }));
  // Substitute only the physical camera boundary. No fake landmarks, model
  // responses or labels: the same locally attributed FSL source is decoded.
  // This reference is a training clip; held-out evaluation is reported separately.
  await page.addInitScript(referenceCamera, true);
  await page.goto('/#practice?sign=fsl105-24');
  await expect(page.locator('.recognition-status')).toContainText('Experimental model ready', { timeout: 30000 });
  await expect(page.locator('.camera-status')).toContainText('Hand tracking is available', { timeout: 30000 });
  await page.getByRole('button', { name: 'Begin attempt' }).click();
  await expect(page.locator('.recognition-result')).toContainText('Model suggestion: Five', { timeout: 15000 });
  await page.screenshot({ path: 'test-results/number-recognition.png', fullPage: true });
  await page.getByRole('button', { name: 'Save summary' }).click();
  await expect(page.getByText('Summary saved in this browser. It will survive reload.')).toBeVisible();
  await page.getByRole('link', { name: 'Sessions', exact: true }).click();
  await expect(page.locator('.session-row')).toContainText('Model suggestion: Five');
  await page.reload();
  await expect(page.locator('.session-row')).toContainText('Model suggestion: Five');
  expect(requests.filter(r => !r.url.startsWith(new URL(page.url()).origin))).toEqual([]);
  expect(requests.filter(r => r.method !== 'GET' || r.body)).toEqual([]);
});

test('moving source video may match Five or explicitly abstain, never invent another number', async ({ page }) => {
  await page.addInitScript(referenceCamera, false);
  await page.goto('/#practice?sign=fsl105-24');
  await expect(page.locator('.recognition-status')).toContainText('Experimental model ready', { timeout: 30000 });
  await expect(page.locator('.camera-status')).toContainText('Hand tracking is available', { timeout: 30000 });
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /^(Begin attempt|Try again)$/ }).click();
    // Align the clip with the capture window, which opens after the countdown.
    await expect(page.getByRole('button', { name: 'Finish attempt' })).toBeVisible({ timeout: 5000 });
    await page.evaluate(() => { window.testVideoSource.currentTime = 0; });
    await expect(page.locator('.recognition-result')).toContainText(/^(Model suggestion: Five|No confident suggestion\.)/, { timeout: 15000 });
  }
});

test('guided practice counts down, shows framing cues, and offers try again and next sign', async ({ page }) => {
  await page.addInitScript(referenceCamera, true);
  await page.goto('/#practice?sign=fsl105-24');
  await expect(page.locator('.recognition-status')).toContainText('Experimental model ready', { timeout: 30000 });
  await expect(page.locator('.live-caption')).toContainText(/1 hand detected · (Good position|.*(closer|back|middle))/, { timeout: 15000 });
  await page.getByRole('button', { name: 'Begin attempt' }).click();
  await expect(page.locator('.countdown')).toHaveText('3');
  await expect(page.getByText(/Get ready… starting in [123]\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finish attempt' })).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.countdown')).toHaveCount(0);
  await expect(page.locator('.recognition-result')).toContainText('Model suggestion: Five', { timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
  await page.getByRole('button', { name: /Next sign: One/ }).click();
  await expect(page.getByLabel('Practice focus')).toHaveValue('fsl105-20');
  await expect(page.getByRole('button', { name: 'Begin attempt' })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('button', { name: 'Begin attempt' }).click();
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.waitForTimeout(3500);
  await expect(page.getByRole('button', { name: 'Finish attempt' })).toHaveCount(0);
});

test('webcam test records separate outcomes with landmarks, supports redo, and saves only through its own route', async ({ page }) => {
  const posts = [];
  await page.route('**/api/webcam-trials', async route => {
    posts.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ saved: true, file: '.tools/webcam/test.jsonl' }) });
  });
  await page.addInitScript(referenceCamera, true);
  await page.goto('/#test');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Test the model on your webcam.');
  await page.getByRole('button', { name: 'Start webcam test' }).click({ timeout: 30000 });
  await expect(page.getByText('Trial 1 of 23')).toBeVisible();
  await expect(page.locator('.camera-status')).toContainText(/Correct suggestion|Wrong suggestion|Refused|False match|Correctly refused/, { timeout: 20000 });
  await expect(page.getByText('Trial 2 of 23')).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Redo last check' }).click();
  await expect(page.getByText('Trial 1 of 23')).toBeVisible();
  await expect(page.locator('.camera-status')).toContainText(/Correct suggestion|Wrong suggestion|Refused|False match|Correctly refused/, { timeout: 20000 });
  await page.getByRole('button', { name: 'End test now' }).click();
  await expect(page.getByRole('heading', { name: 'Your webcam results' })).toBeVisible();
  await expect(page.getByText('Saved to .tools/webcam/test.jsonl on this Mac for evaluation and retraining.')).toBeVisible();
  await expect(page.locator('.result-table tbody tr')).toHaveCount(1);
  expect(posts.map(p => p.type)).toEqual(['trial', 'discard', 'trial']);
  expect(posts[1].trialId).toBe(posts[0].trialId);
  const [record] = posts.slice(-1);
  expect(record.trialIndex).toBe(0);
  expect(['correct', 'wrong', 'refused', 'refused-tracking', 'false-match', 'correct-rejection']).toContain(record.outcome);
  expect(record.capture.frames.length).toBeGreaterThanOrEqual(12);
  expect(record.capture.frames.some(f => f.landmarks.length === 1 && f.landmarks[0].length === 21)).toBe(true);
  expect(JSON.stringify(record)).not.toMatch(/data:image|blob:/);
  await page.screenshot({ path: 'test-results/webcam-test-summary.png', fullPage: true });
});

test('recognition follows focus without restarting the camera or carrying an old attempt', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.camera-status')).toContainText('Hand tracking is available', { timeout: 30000 });
  await page.evaluate(() => { window.initialCameraStream = document.querySelector('.media-plane video').srcObject; });
  const focus = page.getByLabel('Practice focus');
  await expect(page.getByRole('button', { name: /Start camera|Stop camera|Enable experimental recognition|Use tracking only/ })).toHaveCount(0);
  await focus.selectOption({ label: 'One' });
  await expect(page.locator('.recognition-status')).toContainText('Experimental model ready', { timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Four-second check', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Begin attempt' }).click();
  await expect(page.getByRole('button', { name: 'Finish attempt' })).toBeVisible();
  await focus.selectOption({ label: 'Five' });
  await expect(page.getByRole('button', { name: 'Begin attempt' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Save summary' })).toBeDisabled();
  await expect(page.locator('.recognition-result')).toHaveCount(0);
  await expect(page.locator('.mode-line')).toContainText('Experimental number recognition');
  await focus.selectOption({ label: 'Hello' });
  await expect(page.locator('.mode-line')).toContainText('Tracking only');
  await expect(page.getByRole('heading', { name: 'Practice timer', exact: true })).toBeVisible();
  await expect(page.locator('.recognition-status')).toContainText('Tracking only for this focus');
  await focus.selectOption({ label: 'Free hand tracking' });
  await expect(page.locator('.mode-line')).toContainText('Tracking only');
  await focus.selectOption({ label: 'Two' });
  await expect(page.locator('.recognition-status')).toContainText('Experimental model ready', { timeout: 30000 });
  expect(await page.evaluate(() => document.querySelector('.media-plane video').srcObject === window.initialCameraStream && window.initialCameraStream.getTracks().every(t => t.readyState === 'live'))).toBe(true);
});

function loopingClip(src) {
  navigator.mediaDevices.getUserMedia = async () => {
    const source = document.createElement('video');
    source.src = src; source.muted = true; source.loop = true; source.playsInline = true;
    await source.play();
    return source.captureStream();
  };
}

test('interpreter locks in signs between rests, reads the face, and underlines LLM-added words', async ({ page }) => {
  const asked = [];
  await page.route('**/api/interpret', async route => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sentence: 'Hello there!', model: 'test', ms: 5 }) });
  });
  // A licensed FSL-105 HELLO reference loops at the camera boundary: each loop is
  // hands up then hands out of view, i.e. one sign followed by a rest.
  await page.addInitScript(loopingClip, '/references/fsl105-3.mp4');
  await page.goto('/#interpret');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign it. Read it back.');
  await expect(page.locator('.camera-status')).toContainText('Experimental model ready', { timeout: 30000 });
  await page.getByLabel('Interpret after a 2-second rest').uncheck();
  await expect(page.locator('.gloss-pill').first()).toBeVisible({ timeout: 20000 });
  const glosses = await page.locator('.gloss-pill').allTextContents();
  await page.getByRole('button', { name: /Interpret now/ }).click();
  await expect(page.locator('.interpret-sentence')).toHaveText('Hello there!');
  expect(asked).toHaveLength(1);
  expect(asked[0].signs.map(s => s.gloss)).toEqual(glosses);
  expect(asked[0].signs.every(s => ['Happy', 'Sad', 'Neutral', 'Angry', 'Questioning', 'Skeptical'].includes(s.emotion))).toBe(true);
  if (glosses.includes('HELLO')) await expect(page.locator('.interpret-sentence u')).toHaveText('there!');
  await expect(page.locator('.emotion-panel li.current')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/interpret.png', fullPage: true });
  await page.getByRole('button', { name: 'Undo last sign' }).click();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('.interpret-sentence')).toHaveCount(0);
});

test('LLM-free installation keeps the recognition preview unobscured and explains how to enable sentences', async ({ page }) => {
  await page.route('**/health.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ webcamSaving: true, interpret: null }) }));
  await page.addInitScript(loopingClip, '/references/fsl105-3.mp4');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/#interpret');
    await expect(page.getByRole('status').filter({ hasText: 'Experimental model ready' })).toBeVisible({ timeout: 30000 });
    await page.getByLabel('Interpret after a 2-second rest').uncheck();
    await expect(page.locator('.gloss-pill').first()).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /Interpret now/ }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('without --skip-llm');
    const camera = await page.getByRole('region', { name: 'Interpreter camera' }).boundingBox();
    expect((await alert.boundingBox()).y).toBeGreaterThanOrEqual(camera.y + camera.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('h1').click();
    await page.screenshot({ path: `test-results/llm-free-${width}.png`, fullPage: true });
  }
});

test('a slower earlier interpretation never replaces a newer one', async ({ page }) => {
  const replies = [];
  let secondArrived, secondDone;
  const second = new Promise(resolve => { secondArrived = resolve; });
  const answered = new Promise(resolve => { secondDone = resolve; });
  await page.route('**/api/interpret', async route => {
    const count = route.request().postDataJSON().signs.length;
    replies.push(count);
    // The first request (fewer signs) is held until the second one has answered.
    if (replies.length === 1) { await second; await answered; await new Promise(resolve => setTimeout(resolve, 300)); }
    else { secondArrived(); setTimeout(secondDone, 100); }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sentence: `Sentence for ${count}`, model: 'test', ms: 5 }) });
  });
  await page.addInitScript(loopingClip, '/references/fsl105-3.mp4');
  await page.goto('/#interpret');
  await expect(page.locator('.camera-status')).toContainText('Experimental model ready', { timeout: 30000 });
  await page.getByLabel('Interpret after a 2-second rest').uncheck();
  await expect(page.locator('.gloss-pill')).toHaveCount(1, { timeout: 20000 });
  await page.locator('h1').click();
  await page.keyboard.press('Enter');
  await expect(page.locator('.gloss-pill')).toHaveCount(2, { timeout: 20000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('.interpret-sentence')).toHaveText(/Sentence for \d/);
  await page.waitForTimeout(1500);
  expect(replies).toHaveLength(2);
  await expect(page.locator('.interpret-sentence')).toHaveText(`Sentence for ${replies[1]}`);
});

test('check my signs says try again for a different sign and good job for the target', async ({ page }) => {
  // The looping licensed HELLO reference is the "signer". The first target is
  // GOOD MORNING, so it must not earn a good job; HELLO must.
  await page.addInitScript(loopingClip, '/references/fsl105-3.mp4');
  await page.goto('/#interpret');
  await expect(page.locator('.camera-status')).toContainText('Experimental model ready', { timeout: 30000 });
  await page.getByRole('button', { name: 'Check my signs' }).click();
  await expect(page.locator('#drill-title')).toHaveText('GOOD MORNING');
  await expect(page.locator('.drill-verdict')).toHaveText(/Try again|Almost/, { timeout: 20000 });
  // Every miss explains itself: five checks against the FSL-105 examples, and
  // the camera shows the first thing to fix (or says all checks look close).
  await expect(page.locator('.drill-checks li')).toHaveCount(5);
  const fixes = await page.locator('.drill-checks li.fix > span:last-child').allTextContents();
  await expect(page.locator('.drill-verdict-tip')).toHaveText(fixes[0] || /look close to the examples/);
  await expect(page.locator('.closeness')).toHaveAttribute('aria-label', /How close: (Far from it|Getting there|Close)/);
  await page.getByRole('button', { name: /Skip to next sign/ }).click();
  await expect(page.locator('#drill-title')).toHaveText('HELLO');
  await expect(page.locator('.drill-verdict')).toHaveText(/Good job!/, { timeout: 20000 });
  await expect(page.locator('.drill-detail')).toHaveText('Good job! Recognized as HELLO.');
  await expect(page.locator('.closeness')).toHaveAttribute('aria-label', 'How close: Recognized');
  await expect(page.getByRole('button', { name: /^Next sign/ })).toBeVisible();
  await expect(page.locator('.drill-verdict')).toHaveAttribute('role', 'status');
});

test('recording mode saves one labelled landmark sample per sign through the local route', async ({ page }) => {
  const posts = [];
  await page.route('**/api/webcam-trials', async route => {
    posts.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ saved: true, file: '.tools/webcam/test.jsonl' }) });
  });
  await page.addInitScript(loopingClip, '/references/fsl105-0.mp4');
  await page.goto('/#interpret');
  await page.getByRole('button', { name: 'Record my signs' }).click();
  await expect(page.getByRole('heading', { name: 'GOOD MORNING' })).toBeVisible();
  await page.getByRole('button', { name: 'Start recording' }).click({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'HELLO' })).toBeVisible({ timeout: 20000 });
  const [sample] = posts;
  expect(sample).toMatchObject({ type: 'sample', protocolVersion: 'vocab-record-v1', target: { datasetId: 0, gloss: 'GOOD MORNING' } });
  expect(sample.rows.length).toBeGreaterThanOrEqual(4);
  expect(sample.rows.every(row => row.length === 133)).toBe(true);
  await page.getByRole('button', { name: 'Redo last' }).click();
  await expect(page.getByRole('heading', { name: 'GOOD MORNING' })).toBeVisible();
  expect(posts.at(-1)).toMatchObject({ type: 'discard', trialId: sample.trialId });
});
