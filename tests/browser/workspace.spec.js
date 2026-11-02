import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('practice is honest, keyboard reachable, and passes automated accessibility checks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your practice desk.');
  await expect(page.getByText('No automatic correctness assessment.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Begin attempt' })).toBeEnabled({ timeout: 30000 });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations).toEqual([]);
});

test('unavailable alphabet and real empty review remain honest without camera', async ({ page }) => {
  await page.goto('/#learn');
  await page.getByRole('button', { name: 'Alphabet · pending' }).click();
  await page.getByRole('button', { name: 'Letter A Review pending' }).click();
  await expect(page.getByRole('heading', { name: 'Not available for instruction.' })).toBeVisible();
  await page.getByRole('link', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Something to return to.' })).toBeVisible();
  await expect(page.getByText('Example learner A')).toHaveCount(0);
  await page.getByRole('link', { name: 'Sessions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No sessions. No pressure.' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No sessions. No pressure.' })).toBeVisible();
});

test('camera denial has an actionable persistent error and library still works', async ({ page }) => {
  await page.addInitScript(() => { window.cameraRequests = 0; navigator.mediaDevices.getUserMedia = async () => { window.cameraRequests++; throw new DOMException('Denied for test', 'NotAllowedError'); }; });
  await page.goto('/');
  await expect(page.getByRole('status').first()).toContainText('Camera permission was denied');
  await expect(page.getByRole('button', { name: 'Retry camera' })).toBeEnabled();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new window.Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new window.Event('visibilitychange'));
  });
  expect(await page.evaluate(() => window.cameraRequests)).toBe(1);
  await expect(page.locator('.camera-status')).toContainText('Camera permission was denied');
  await page.getByRole('button', { name: 'Retry camera' }).click();
  await expect.poll(() => page.evaluate(() => window.cameraRequests)).toBe(2);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Numbers', exact: true })).toBeVisible();
});

test('saved camera permission supports automatic start, return and reload; navigation releases tracks', async ({ page, context }) => {
  await context.grantPermissions(['camera']);
  const requests = [];
  page.context().on('request', request => requests.push({ url: request.url(), method: request.method(), body: request.postData() }));
  await page.addInitScript(() => {
    window.testStreams = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => { const stream = await original(constraints); window.testStreams.push(stream); return stream; };
  });
  await page.goto('/');
  await expect(page.getByRole('status').first()).toContainText('Hand tracking is available', { timeout: 30000 });
  await expect(page.locator('.live-caption')).toContainText('0 hands detected', { timeout: 15000 });
  await expect(page.getByRole('button', { name: /Start camera|Stop camera/ })).toHaveCount(0);
  expect(await page.evaluate(() => window.testStreams.length)).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new window.Event('visibilitychange'));
  });
  expect(await page.evaluate(() => window.testStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new window.Event('visibilitychange'));
  });
  await expect(page.locator('.camera-status')).toContainText('Hand tracking is available', { timeout: 30000 });
  expect(await page.evaluate(() => window.testStreams.length)).toBe(2);
  await page.screenshot({ path: 'test-results/tracking-test-pattern.png', fullPage: true });
  await page.getByRole('button', { name: 'Begin attempt' }).click();
  await expect(page.getByRole('button', { name: 'Finish attempt' })).toBeVisible();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Finish attempt' }).click();
  await page.getByRole('button', { name: 'Save summary' }).click();
  await page.getByRole('link', { name: 'Sessions', exact: true }).click();
  await expect(page.locator('.session-row')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.testStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
  await page.screenshot({ path: 'test-results/saved-summary.png', fullPage: true });
  await expect(page.getByText('No recognition assessment')).toHaveCount(0);
  expect(requests.filter(r => !r.url.startsWith(new URL(page.url()).origin))).toEqual([]);
  expect(requests.filter(r => r.method !== 'GET' || r.body)).toEqual([]);
  await page.getByRole('link', { name: 'Practice', exact: true }).click();
  await expect(page.locator('.camera-status')).toContainText('Hand tracking is available', { timeout: 30000 });
  expect(await page.evaluate(() => window.testStreams.length)).toBe(3);
  await page.reload();
  await expect(page.locator('.camera-status')).toContainText('Hand tracking is available', { timeout: 30000 });
  await page.getByRole('link', { name: 'Sessions', exact: true }).click();
  await expect(page.locator('.session-row')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.testStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
});

test('leaving during automatic permission request disposes a late stream without starting tracking', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => { const stream = await original(constraints); window.lateStream = stream; await new Promise(resolve => { window.releaseCamera = resolve; }); return stream; };
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => !!window.releaseCamera)).toBe(true);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.evaluate(() => window.releaseCamera());
  await expect.poll(() => page.evaluate(() => window.lateStream.getTracks().every(t => t.readyState === 'ended'))).toBe(true);
  await expect(page.locator('.camera-panel')).toHaveCount(0);
});

test('missing tracking asset fails closed and stops the camera', async ({ page }) => {
  await page.route('**/tracking/hand_landmarker.task', route => route.abort());
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => { window.assetTestStream = await original(constraints); return window.assetTestStream; };
  });
  await page.goto('/');
  await expect(page.getByRole('status').first()).toContainText(/tracking.*(failed|could not load)/i, { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Begin attempt' })).toBeDisabled();
  expect(await page.evaluate(() => window.assetTestStream.getTracks().every(t => t.readyState === 'ended'))).toBe(true);
});

test('page teardown stops an active stream even while the document is visible', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => { window.teardownStream = await original(constraints); return window.teardownStream; };
  });
  await page.goto('/');
  await expect(page.getByRole('status').first()).toContainText('Hand tracking is available', { timeout: 30000 });
  await page.evaluate(() => window.dispatchEvent(new window.Event('pagehide')));
  await expect(page.getByRole('status').first()).toHaveText('Camera is off.');
  expect(await page.evaluate(() => window.teardownStream.getTracks().every(t => t.readyState === 'ended'))).toBe(true);
});

for (const [name, errorName, expected] of [['missing camera', 'NotFoundError', 'No camera was found'], ['busy camera', 'NotReadableError', 'in use by another app']]) {
  test(`${name} gives an actionable error without recognition`, async ({ page }) => {
    await page.addInitScript(name => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Synthetic device error', name); }; }, errorName);
    await page.goto('/');
    await expect(page.getByRole('status').first()).toContainText(expected);
    await expect(page.getByRole('button', { name: 'Begin attempt' })).toBeDisabled();
  });
}

test('each workspace screen has labeled controls and no automated AA violations', async ({ page }) => {
  for (const route of ['test', 'learn', 'progress', 'teacher', 'privacy']) {
    await page.goto(`/#${route}`);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(result.violations, route).toEqual([]);
    await page.screenshot({ path: `test-results/${route}.png`, fullPage: true });
  }
});

test('200 percent text size remains reflowable', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/text-200-percent.png', fullPage: true });
});

for (const [name, width, height] of [['phone', 390, 844], ['tablet', 820, 1180], ['laptop', 1440, 1000], ['landscape', 844, 390], ['reflow', 320, 900]]) {
  test(`${name} layout has no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.locator('.camera-status')).toContainText('Hand tracking is available', { timeout: 30000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: /Start camera|Stop camera/ })).toHaveCount(0);
    await expect(page.getByLabel('Live camera preview, processed on this device')).toBeVisible();
    await page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
  });
}
