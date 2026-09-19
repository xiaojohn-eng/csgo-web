#!/usr/bin/env node
// Fires the real game's rifle and reads which of the model's own fire sequences each shot ran.
//
// The unit tests prove the appended clips reproduce the shipped variant channel for channel,
// and that the loader refuses a model missing one. This proves the game itself draws between
// them: in a real browser, on the shipped asset, over real shots, one variant per shot.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.SOURCE_FIRE_BASE || 'http://127.0.0.1:27019';
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const FIRE_POSES = ['fire', 'fire2', 'fire3'];
const errors = [];

const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(base + '/?map=de_dust2');
  const start = page.getByRole('button', { name: /^开始人机训练/ });
  await start.waitFor({ state: 'visible', timeout: 120000 });
  await page.getByRole('textbox', { name: '呼号', exact: true }).fill('Rifle Fire');
  await start.click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  // The local first-person rifle has to be the AK-47 before anything is fired.
  await page.waitForFunction(() => window.__BREACHLINE__?.handlingAudit?.()?.rifleView?.weapon === 'ak47', null, { timeout: 60000 });
  const registered = await page.evaluate(() => window.__BREACHLINE__.handlingAudit().rifleView);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const capture = window.__SOURCE_RIFLE_FIRE__ = { samples: [], done: false };
    const step = () => {
      if (capture.done) return;
      const view = window.__BREACHLINE__.handlingAudit()?.rifleView;
      if (view) capture.samples.push({ pose: view.pose, time: view.time, shotIdle: view.shotIdle, generation: view.generation });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await page.mouse.down();
  await page.waitForTimeout(3800);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const capture = await page.evaluate(() => { window.__SOURCE_RIFLE_FIRE__.done = true; return window.__SOURCE_RIFLE_FIRE__; });
  await page.screenshot({ path: resolve(outputDir, 'source-rifle-fire-variants-ingame.png') });
  await page.keyboard.press('Escape');

  const samples = capture.samples;
  if (samples.length < 200) throw Error('Too few animation samples to read a shot: ' + samples.length);
  // A shot is the shot clock starting over; the whole shot has to play one variant.
  const shots = [];
  let current = null;
  for (const sample of samples) {
    if (sample.pose !== 'fire' && !FIRE_POSES.includes(sample.pose)) { current = null; continue; }
    if (!current || sample.shotIdle < current.lastShotIdle) { current = { poses: [], lastShotIdle: sample.shotIdle, firstTime: sample.time }; shots.push(current); }
    current.poses.push(sample.pose);
    current.lastShotIdle = sample.shotIdle;
  }
  const fired = shots.filter((shot) => shot.poses.length > 1);
  if (fired.length < 8) throw Error('Too few shots were read: ' + fired.length);
  for (const [index, shot] of fired.entries()) {
    const distinct = new Set(shot.poses);
    if (distinct.size !== 1) throw Error(`Shot ${index} changed variant mid-shot: ${[...distinct].join(',')}`);
  }
  const counts = new Map(FIRE_POSES.map((pose) => [pose, 0]));
  for (const shot of fired) counts.set(shot.poses[0], (counts.get(shot.poses[0]) ?? 0) + 1);
  const used = [...counts.entries()].filter(([, count]) => count > 0);
  // Twenty shots all landing on one variant has probability 3 * (1/3)^20, so every variant
  // the model carries has to appear when the game fires enough rounds.
  if (used.length !== FIRE_POSES.length) throw Error(`The game used ${used.length} of the model's ${FIRE_POSES.length} fire variants: ${used.map(([pose, count]) => pose + '=' + count).join(',')}`);
  const evidence = {
    status: 'passed-original-rifle-fire-variants-in-game',
    scope: 'The local first-person AK-47 in a real browser against the LAN service: the model\'s own fire sequences as the game registered them, and the variant each shot actually played.',
    url: base, registeredFireVariants: registered.fireVariants, firePoses: FIRE_POSES,
    shotsRead: fired.length, variantCounts: Object.fromEntries(counts),
    shotLengths: fired.map((shot) => shot.poses.length),
    oneVariantPerShot: true, everyVariantUsed: true, sampleCount: samples.length, errors,
    boundary: 'Reads the pose the view model is playing; it does not measure which variant the original engine would have drawn for the same shot.',
  };
  writeFileSync(resolve(outputDir, 'source-rifle-fire-variants-ingame.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await browser.close();
}
