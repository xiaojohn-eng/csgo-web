#!/usr/bin/env node
// Sky-pass draw call / triangle probe. Loads the built release twice — default
// (sky batch ON) and ?noskybatch (OFF, the original per-mesh path) — at the
// deterministic menu camera (first amber spawn) and audits the Source_Original_3D_Sky
// scene, the per-pass draw call split, the batch audit and the renderer budget.
// Evidence lands in output/sky-batch-probe.json.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.SKY_PROBE_BASE || 'http://127.0.0.1:27025';
const output = resolve(root, process.argv[2] || 'output/sky-batch-probe.json');
mkdirSync(dirname(output), { recursive: true });

// The required chromium build is not in the local cache; fall back to the
// system Chrome channel, then the cached chromium-1208 binary.
const fallback1208 = '/Users/developer/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
async function launch() {
  try { return await chromium.launch({ channel: 'chrome' }); }
  catch { return chromium.launch({ executablePath: existsSync(fallback1208) ? fallback1208 : undefined }); }
}

const pageAudit = `(() => {
  const B = window.__BREACHLINE__;
  const g = B.runtime();
  const map = g.art.sourceMap;
  const sky = map.sky;
  let meshes = 0, triangles = 0, withGroups = 0, materialArrays = 0;
  const materials = new Map(), meshList = [];
  sceneTraversal: {
    sky.scene.traverse(o => {
      const m = o;
      if (!m.isMesh) return;
      meshes++;
      const tris = (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
      triangles += tris;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (Array.isArray(m.material)) materialArrays++;
      if ((m.geometry.groups ?? []).length) withGroups++;
      const key = mats.map(x => x.type + ' | ' + (x.transparent ? 'transparent' : 'opaque') + ' | ' +
        (typeof x.customProgramCacheKey === 'function' ? x.customProgramCacheKey() : 'onBeforeCompile(){}') + ' | ' + x.name).join(' + ');
      let entry = materials.get(key);
      if (!entry) { entry = { meshes: 0, triangles: 0, distinctMaterialInstances: new Set(), distinctMaps: new Set() }; materials.set(key, entry); }
      entry.meshes++; entry.triangles += tris;
      for (const x of mats) { entry.distinctMaterialInstances.add(x.uuid); entry.distinctMaps.add(x.map ? x.map.uuid : 'none'); }
      meshList.push({ name: m.name || (m.parent ? m.parent.name : '?'),
        materialNames: mats.map(x => x.name), materialTypes: mats.map(x => x.type),
        transparent: mats.map(x => !!x.transparent), triangles: tris,
        groups: (m.geometry.groups ?? []).length, attributes: Object.keys(m.geometry.attributes).join(','),
        frustumCulled: m.frustumCulled, matrixAutoUpdate: m.matrixAutoUpdate });
    });
  }
  return {
    url: location.href,
    statsSky: sky.stats,
    skyBatchAudit: map.stats.skyBatch,
    lastCalls: B.drawCallSplit(),
    metrics: B.metrics(),
    skyScene: { meshes, triangles, withGroups, materialArrays, estimatedDrawCalls: meshes,
      visible: sky.scene.visible, children: sky.scene.children.length },
    materials: Object.fromEntries([...materials.entries()].map(([k, v]) => [k,
      { meshes: v.meshes, triangles: v.triangles, distinctMaterialInstances: v.distinctMaterialInstances.size, distinctMaps: v.distinctMaps.size }])),
    meshes: meshList,
  };
})()`;

async function probe(url) {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => {
      const g = window.__BREACHLINE__?.runtime?.();
      const map = g?.art?.sourceMap;
      return !!map?.sky && window.__BREACHLINE__?.drawCallSplit?.()?.sky > 0;
    }, null, { timeout: 240000 });
    // Let the menu camera render a few frames so lastCalls/metrics settle.
    await page.waitForTimeout(1200);
    const audit = await page.evaluate(pageAudit);
    return { ...audit, errors };
  } finally { await browser.close(); }
}

const on = await probe(base + '/?map=de_dust2');
const off = await probe(base + '/?map=de_dust2&noskybatch');
const evidence = {
  title: 'Sky pass (Source_Original_3D_Sky) batch draw call / triangle probe',
  date: new Date().toISOString(),
  build: 'release/source-r4 served by 127.0.0.1:27025 (source-sky-batch r1, enableSkyBatch default ON, ?noskybatch runtime switch)',
  method: 'Headless Chromium + Metal. Deterministic menu camera (first amber spawn, fov 75). ' +
    'drawCallSplit = worldComposite per-pass renderer.info.render.calls; skyScene audit traverses the borrowed sky scene.',
  on, off,
};
writeFileSync(output, JSON.stringify(evidence, null, 2));
const summary = {
  on: { skyCalls: on.lastCalls.sky, skySceneMeshes: on.skyScene.meshes, skySceneTriangles: on.skyScene.triangles, batch: on.skyBatchAudit },
  off: { skyCalls: off.lastCalls.sky, skySceneMeshes: off.skyScene.meshes, skySceneTriangles: off.skyScene.triangles, batch: off.skyBatchAudit },
};
console.log(JSON.stringify(summary, null, 2));
