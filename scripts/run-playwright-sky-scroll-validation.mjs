#!/usr/bin/env node
// Dust2's second sky layer now drifts on the transform its own material asks for.
//
// The installed client's TextureScroll proxy composes that transform from the material's own
// rate, angle and scale (scripts/probe-source-texture-scroll-apply.py), and the port advances
// the same measured law from its own game clock. This run proves the *game* is doing it: it
// reads what the sky backdrop's scrolled texture actually holds, at two clock readings, and
// checks both values against the law evaluated at the clock the renderer itself reported.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.SOURCE_SKY_BASE || 'http://127.0.0.1:27019';
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const errors = [];
const DEGREES_TO_RADIANS = 0.017453292519943295;
const scroll = JSON.parse(readFileSync(resolve(root, 'research/source-texture-scroll-apply.json'), 'utf8')).reading;
const sky = JSON.parse(readFileSync(resolve(root, 'public/source/csgo-12426148/dust2/sky.json'), 'utf8'));
const CLOUD = 'models/props/de_nuke/hr_nuke/nuke_skydome_001/nuke_clouds_002';
const staged = sky.unlitMaterials.find((m) => m.source === CLOUD);
if (!staged) throw Error('The staged sky no longer carries its cloud layer');
const block = staged.scrolls.find((s) => s.variable === '$basetexturetransform');
if (!block) throw Error('The staged cloud layer no longer scrolls its base transform');

const fraction = (value) => { const f = value - Math.trunc(value); return f < 0 ? f + 1 : f; };
const law = (time) => {
  const radians = block.angle * DEGREES_TO_RADIANS;
  return { u: fraction(time * block.rate * Math.cos(radians)), v: fraction(time * block.rate * Math.sin(radians)) };
};

const read = `(() => {
  const audit = window.__BREACHLINE__.assetAudit();
  const sky = audit.sourceSky ?? null;
  return { sky, clock: audit.clock ?? null };
})()`;

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
  await page.getByRole('textbox', { name: '呼号', exact: true }).fill('SkyScroll');
  await start.click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  // Aim at the sky so the map's own 3D sky is what the frame is actually using.
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove',
    { movementX: 0, movementY: -900, bubbles: true })));
  await page.waitForFunction(() => (window.__BREACHLINE__?.assetAudit?.()?.sourceSky?.scroll ?? []).length > 0,
    null, { timeout: 60000 });
  const first = await page.evaluate(read);
  await page.waitForTimeout(2500);
  const second = await page.evaluate(read);

  const samples = [first, second];
  const entries = samples.map((sample) => (sample.sky.scroll ?? [])
    .find((entry) => entry.source === CLOUD && entry.variable === '$basetexturetransform'));
  if (entries.some((entry) => !entry)) throw Error('The sky audit never carried the cloud layer\'s scroll');
  const [one, two] = entries;
  const checked = [];
  for (const entry of entries) {
    if (entry.repeat !== block.scale)
      throw Error(`The cloud texture is scaled ${entry.repeat}, not the material's own ${block.scale}`);
    if (!(entry.u >= 0 && entry.u < 1 && entry.v >= 0 && entry.v < 1))
      throw Error(`A cloud offset left [0,1): ${JSON.stringify(entry)}`);
    // The value the game published is the measured law at the clock the game published.
    const expected = law(entry.timeSeconds);
    const deviation = Math.max(Math.abs(entry.u - expected.u), Math.abs(entry.v - expected.v));
    checked.push({ timeSeconds: entry.timeSeconds, u: entry.u, v: entry.v, expected, deviation });
    if (deviation > 1e-9)
      throw Error(`The cloud transform at ${entry.timeSeconds}s is ${entry.u}/${entry.v}, not the measured `
        + `law's ${expected.u}/${expected.v}`);
  }
  if (!(two.timeSeconds > one.timeSeconds))
    throw Error('The sky clock did not advance between the two readings');
  // And it really moved: over the gap the offsets advanced by the law's own increment.
  const gap = two.timeSeconds - one.timeSeconds;
  const incrementU = fraction(one.u + fraction(gap * block.rate * Math.cos(block.angle * DEGREES_TO_RADIANS))) - one.u;
  const incrementV = fraction(one.v + fraction(gap * block.rate * Math.sin(block.angle * DEGREES_TO_RADIANS))) - one.v;
  const moved = Math.hypot(two.u - one.u, two.v - one.v);
  if (!(moved > 0)) throw Error('The cloud transform did not move at all over the gap');
  // The drift's direction is the material's own angle: the sine axis advances faster than the
  // cosine axis, by exactly tan(angle), which no clock reading enters.
  const observedRatio = gap > 0 ? (two.v - one.v) / (two.u - one.u) : null;
  await page.screenshot({ path: resolve(outputDir, 'source-sky-scroll-ingame.png') });

  const evidence = {
    status: 'passed-original-sky-scroll-in-game',
    scope: 'The local player in a real browser on the shipped de_dust2, looking at the map\'s own 3D sky: '
      + 'the second sky layer\'s base texture carries the transform the installed TextureScroll proxy composes '
      + '(rate, angle and scale from the shipped material), evaluated on the game clock.',
    url: base, block, proxyReading: { degreesToRadians: scroll.onBind.degreesToRadians, sincos: scroll.onBind.sincos.symbol },
    samples: checked, gapSeconds: gap, increment: { u: incrementU, v: incrementV },
    observed: { movedMetres: moved, ratio: observedRatio, expectedRatio: Math.tan(block.angle * DEGREES_TO_RADIANS) },
    staged: { shader: staged.shader, alpha: staged.alpha, limitations: staged.limitations },
    errors,
    boundary: 'Reads the transform the port applied, not a recording of the original client. The layer draws its own '
      + 'program\'s product as well (scripts/run-playwright-cloud-layer-validation.mjs); that run records its own '
      + 'boundary, and the program\'s trailing cLightScale factor is still not applied.',
  };
  writeFileSync(resolve(outputDir, 'source-sky-scroll-ingame.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify({
    status: evidence.status, block, samples: checked, gapSeconds: gap,
    observed: evidence.observed, errors }, null, 2) + '\n');
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await browser.close();
}
