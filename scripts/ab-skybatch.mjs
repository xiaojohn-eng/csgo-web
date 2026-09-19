#!/usr/bin/env node
// Sky batch render-consistency A/B. Same build, same deterministic procedure:
// default (sky batch ON) vs ?noskybatch (OFF, original per-mesh sky path), plus
// a second ON session as the capture-determinism control.
//
// Determinism recipe (mirrors the accepted world-batch methodology):
// - menu mode camera: Source_Original_3D_Sky renders every frame with no
//   actors/gun/effects, and the camera is driven by the first amber spawn,
//   which is mutated per pose (amber/blue x first/middle/last);
// - requestAnimationFrame is patched before app boot; after the map is ready
//   the harness flips to manual mode and drives fixed 60 Hz frames itself, so
//   wind/animation state evolves identically in every session;
// - before each pose the map wind is regenerated (art.sourceWindGeneration++),
//   the same mechanism restart() uses: the next driven frame sees a fresh
//   epoch string, resets the wind owner from fixed seed 0 and re-advances it
//   the same fixed steps (nulled art.sourceWindEpoch must NOT be used: it only
//   rewinds sourceWindTime while the owner keeps its epoch, so the monotonic
//   time check throws inside frame() every driven frame and the render loop
//   circuit-breaks to a dead black canvas);
// - canvas.toDataURL is called in the same task as the last driven render
//   (the WebGL drawing buffer survives until the task ends).
// Evidence lands in output/sky-batch-ab.json.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.SKY_PROBE_BASE || 'http://127.0.0.1:27025';
const output = resolve(root, process.argv[2] || 'output/sky-batch-ab.json');
mkdirSync(dirname(output), { recursive: true });

const fallback1208 = '/Users/developer/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
async function launch() {
  try { return await chromium.launch({ channel: 'chrome' }); }
  catch { return chromium.launch({ executablePath: existsSync(fallback1208) ? fallback1208 : undefined }); }
}

const rafPatch = `(() => {
  const realRAF = window.requestAnimationFrame.bind(window);
  const state = { manual: false, queue: [] };
  window.__SKYAB__ = state;
  window.requestAnimationFrame = cb => {
    if (state.manual) { state.queue.push(cb); return state.queue.length; }
    return realRAF(cb);
  };
})();`;

const POSE_FRAMES = 8;

async function session(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(rafPatch);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const g = window.__BREACHLINE__?.runtime?.();
    return !!g?.art?.sourceMap?.sky && window.__BREACHLINE__?.drawCallSplit?.()?.sky > 0;
  }, null, { timeout: 240000 });
  // Settle, then hand the render loop over to the manual driver.
  await page.waitForTimeout(800);
  const poses = await page.evaluate(() => {
    const map = window.__BREACHLINE__.runtime().art.sourceMap;
    const pick = (team) => {
      const list = map.level.spawns.filter(s => s.team === team);
      const mid = Math.floor((list.length - 1) / 2);
      return [list[0], list[mid], list[list.length - 1]].map((s, i) =>
        ({ name: team + [0, Math.floor((list.length - 1) / 2), list.length - 1][i], x: s.x, y: s.y, z: s.z, yaw: s.yaw }));
    };
    return [...pick('amber'), ...pick('blue')];
  });
  const captures = await page.evaluate(async ({ poseSpecs, frames }) => {
    const art = window.__BREACHLINE__.runtime().art;
    const state = window.__SKYAB__;
    const spawn = art.sourceMap.level.spawns.find(s => s.team === 'amber');
    const saved = { x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw };
    const canvas = document.querySelector('canvas');
    state.manual = true;
    // Let the in-flight real frame finish; its re-registration lands in the queue.
    await new Promise(r => setTimeout(r, 120));
    const drive = (t) => { for (const cb of state.queue.splice(0)) cb(t); };
    const step = 1000 / 60;
    let clock = 0;
    const results = [];
    for (const spec of poseSpecs) {
      spawn.x = spec.x; spawn.y = spec.y; spawn.z = spec.z; spawn.yaw = spec.yaw;
      // Regenerate the map wind: the next driven frame sees a fresh epoch
      // ('menu:<generation>') and resets the wind owner from fixed seed 0, so
      // every session advances the same fixed steps after it.
      art.sourceWindGeneration++;
      for (let i = 0; i < frames; i++) { clock += step; drive(clock); }
      results.push({ name: spec.name, data: canvas.toDataURL('image/png') });
    }
    Object.assign(spawn, saved);
    return results;
  }, { poseSpecs: poses, frames: POSE_FRAMES });
  const calls = await page.evaluate(() => ({
    split: window.__BREACHLINE__.drawCallSplit(),
    batch: window.__BREACHLINE__.runtime().art.sourceMap.stats.skyBatch,
  }));
  await page.close();
  return { poses, captures, calls, errors };
}

const diffInPage = async (browser, a, b) => {
  const page = await browser.newPage();
  try {
    return await page.evaluate(([dataA, dataB]) => new Promise(resolve => {
      const load = src => new Promise(img => { const i = new Image(); i.onload = () => img(i); i.src = src; });
      Promise.all([load(dataA), load(dataB)]).then(([ia, ib]) => {
        const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
        const ctx = (img) => {
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g;
        };
        const d1 = ctx(ia).getImageData(0, 0, w, h).data, d2 = ctx(ib).getImageData(0, 0, w, h).data;
        let maxDiff = 0, sum = 0, over8 = 0, over32 = 0, bbox = null;
        for (let i = 0; i < w * h; i++) {
          const p = i * 4;
          const diff = Math.max(
            Math.abs(d1[p] - d2[p]), Math.abs(d1[p + 1] - d2[p + 1]),
            Math.abs(d1[p + 2] - d2[p + 2]), Math.abs(d1[p + 3] - d2[p + 3]));
          if (!diff) continue;
          maxDiff = Math.max(maxDiff, diff); sum += diff;
          if (diff > 8) over8++;
          if (diff > 32) over32++;
          const x = i % w, y = (i - x) / w;
          if (!bbox) bbox = [x, y, x, y];
          else { bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y); }
        }
        const pixels = w * h;
        resolve({ width: w, height: h, maxDiff, meanDiff: sum / pixels,
          pctOver8: over8 / pixels, pctOver32: over32 / pixels, bbox });
      });
    }), [a, b]);
  } finally { await page.close(); }
};

const browser = await launch();
try {
  const on1 = await session(browser, base + '/?map=de_dust2');
  const off = await session(browser, base + '/?map=de_dust2&noskybatch');
  const on2 = await session(browser, base + '/?map=de_dust2');
  const byName = (session) => Object.fromEntries(session.captures.map(c => [c.name, c.data]));
  const a = byName(on1), b = byName(off), c = byName(on2);
  // Keep viewable PNG artifacts and prove the captures are real renders, not
  // blank buffers: report mean luminance and distinct colors per capture.
  const statsInPage = async (dataURL) => {
    const page = await browser.newPage();
    try {
      return await page.evaluate((src) => new Promise(resolve => {
        const i = new Image(); i.onload = () => {
          const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
          const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0);
          const d = g.getImageData(0, 0, i.width, i.height).data;
          let sum = 0; const colors = new Set();
          for (let p = 0; p < d.length; p += 4) {
            sum += (d[p] * .299 + d[p + 1] * .587 + d[p + 2] * .114);
            colors.add((d[p] << 16) | (d[p + 1] << 8) | d[p + 2]);
          }
          resolve({ meanLuminance: sum / (d.length / 4), distinctColors: colors.size });
        };
        i.src = src;
      }), dataURL);
    } finally { await page.close(); }
  };
  const captureStats = {};
  for (const name of Object.keys(a)) {
    captureStats[name] = { on: await statsInPage(a[name]), off: await statsInPage(b[name]) };
  }
  for (const name of ['amber0', 'blue7']) {
    writeFileSync(resolve(root, `output/sky-batch-ab-on-${name}.png`), Buffer.from(a[name].split(',')[1], 'base64'));
    writeFileSync(resolve(root, `output/sky-batch-ab-off-${name}.png`), Buffer.from(b[name].split(',')[1], 'base64'));
  }
  const diffs = {};
  for (const name of Object.keys(a)) {
    diffs[name] = {
      onVsOff: await diffInPage(browser, a[name], b[name]),
      onVsOn: await diffInPage(browser, a[name], c[name]),
    };
  }
  const evidence = {
    title: 'Sky pass (Source_Original_3D_Sky) batch render-consistency A/B',
    date: new Date().toISOString(),
    build: 'release/source-r4 served by 127.0.0.1:27025 (source-sky-batch r1, enableSkyBatch default ON, ?noskybatch runtime switch)',
    method: `ab-skybatch.mjs: default (sky batch ON) vs ?noskybatch (OFF), identical deterministic menu poses ` +
      `(6 camera positions: amber/blue team x first/middle/last spawn, fov 75), rAF patched for manual ` +
      `fixed-60Hz frame drive, map wind regenerated per pose via sourceWindGeneration++ (fresh epoch, ` +
      `fixed seed-0 reset) for a deterministic wind timeline, in-task canvas.toDataURL pixel compare. ` +
      `Third ON session is the capture-determinism control. Headless system Chrome + Metal. ` +
      `Viewable artifacts: output/sky-batch-ab-{on,off}-{amber0,blue7}.png.`,
    poses: on1.poses,
    calls: { on: on1.calls, off: off.calls, onControl: on2.calls },
    captureStats,
    diffs,
    errors: { on: on1.errors, off: off.errors, onControl: on2.errors },
  };
  writeFileSync(output, JSON.stringify(evidence, null, 2));
  const summary = {};
  for (const [name, d] of Object.entries(diffs))
    summary[name] = { onVsOff: d.onVsOff, onVsOn: d.onVsOn };
  console.log(JSON.stringify({ captureStats, summary }, null, 2));
} finally { await browser.close(); }
