#!/usr/bin/env node
// Original finishes of several weapons, in several styles, composed in a real browser from the
// served bytes.
//
// The point of this check is that the composition is driven by the finish: every composition must
// use its own artwork, its own Phong values and its own wear window, and every composed colour map
// must differ from the others. The strongest case is the two glock finishes of style 1: they share
// one program and one set of weapon textures and differ only in their four palette colours, so
// identical colour maps would mean the palette never reached the shader.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(root, 'output/playwright');
const port = Number(process.env.CSGO_AK_FINISH_PREVIEW_PORT || 27026);
mkdirSync(outputDir, { recursive: true });
const issues = [];
const errors = [];
const manifest = JSON.parse(readFileSync(resolve(root, 'game/source-ak-pattern-resources.json'), 'utf8'));
const kitManifest = JSON.parse(readFileSync(resolve(root, 'game/source-kit-input-resources.json'), 'utf8'));
const stagedFor = (weapon, paintKitId) => kitManifest.find((entry) => entry.weapon === weapon
  && entry.role === 'pattern' && entry.paintKitIds.includes(String(paintKitId)));

const child = spawn(process.execPath, [resolve(root, 'scripts/serve-source-finishes.mjs')], { cwd: root, stdio: 'inherit' });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
let browser;
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/index.html`)).ok) break; } catch {}
    await wait(500);
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=metal', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  // Which URL a 404 was for: a missing texture is a staged-input problem, and the URL names it.
  page.on('response', (response) => {
    if (response.status() === 404) errors.push(`404 ${new URL(response.url()).pathname}`);
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => !!window.__AK_FINISH_PROOF__, null, { timeout: 180000 });
  const proof = await page.evaluate(() => window.__AK_FINISH_PROOF__);
  await page.locator('#gallery').screenshot({ path: resolve(outputDir, 'source-finishes.png') });
  const resolved = proof.finishes ?? [];
  if (proof.status !== 'original-finishes-composed-per-weapon')
    issues.push(`the preview reported ${proof.status}${proof.error ? ': ' + proof.error : ''}`);
  if (resolved.length !== 3) issues.push(`the preview composed ${resolved.length} AK finishes, not three`);
  for (const finish of resolved) {
    // Each composition must name the pattern it was given, and that pattern must be the
    // one the staged manifest holds for that finish.
    const staged = manifest.find((entry) => entry.field === 'pattern'
      && entry.paintKitIds.includes(String(finish.paintKitId)));
    if (!staged) { issues.push(`finish ${finish.paintKitId} has no staged pattern`); continue; }
    if (finish.patternSha256 !== staged.sha256)
      issues.push(`finish ${finish.paintKitId} composed ${finish.patternSha256}, not the staged ${staged.sha256}`);
    if (finish.patternSourceMaterial !== staged.sourceMaterial)
      issues.push(`finish ${finish.paintKitId} composed from ${finish.patternSourceMaterial}, not ${staged.sourceMaterial}`);
    if (finish.boundPattern?.sha256 !== staged.sha256)
      issues.push(`finish ${finish.paintKitId} left ${finish.boundPattern?.sha256} bound`);
    // A composed colour map with no opaque pixel would mean the pass drew nothing.
    if (!(finish.colorOpaque > 0))
      issues.push(`finish ${finish.paintKitId} composed an empty colour map`);
    if (finish.colorSize !== 1024 || finish.exponentSize !== 256)
      issues.push(`finish ${finish.paintKitId} composed at ${finish.colorSize}/${finish.exponentSize}, not the original 1024/256`);
  }
  // The finishes must differ in both the inputs they name and the output they produce.
  const namedInputs = new Set(resolved.map((finish) => finish.patternSha256));
  if (namedInputs.size !== resolved.length) issues.push('two finishes were given the same pattern texture');
  // Two original finishes may legitimately carry the same Phong values — kit 282 and kit
  // 302 both do — so this asks that the values track the finish rather than that they are
  // all distinct, and the distinct colour maps below are what proves the finish was used.
  const numeric = new Set(resolved.map((finish) => `${finish.phongExponent}:${finish.phongIntensity}`));
  if (numeric.size < 2) issues.push('every composed finish resolved the same Phong values');
  if (proof.distinctColorMaps !== proof.composedCount)
    issues.push(`only ${proof.distinctColorMaps} of ${proof.composedCount} composed colour maps differ`);
  // Every weapon's own menu has to be exactly the generated table's: a resolver that offered more
  // would promise a finish the composition refuses, and the composition itself is what this run
  // proves happens.
  if (proof.availableMatchesTable !== true)
    issues.push('a weapon\'s available list differs from the generated finish table');
  const counts = proof.availableCounts ?? {};
  for (const [weapon, expected] of [['weapon_ak47', 18], ['weapon_m4a1', 13], ['weapon_glock', 13],
    ['weapon_usp_silencer', 17]]) if (counts[weapon] !== expected)
    issues.push(`${weapon} lists ${counts[weapon]} finishes, not the table's ${expected}`);

  // One pattern finish at two seeds: a kit's `pattern_offset_*` and `pattern_rotate_*` are the range
  // the client draws that component from, so the seed shifts the pattern and the two compositions
  // differ. This is the check that the ranges are drawn from rather than pinned.
  const spread = proof.seedSpread ?? [];
  if (spread.length !== 2) issues.push(`the preview drew ${spread.length} seed spreads, not two`);
  for (const entry of spread) {
    const [scale, x, y, rotate] = entry.fields;
    if (scale !== 3) issues.push(`seed ${entry.seed} drew scale ${scale}, not the kit's own 3`);
    if (!(x >= 0 && x <= 1) || !(y >= 0 && y <= 1))
      issues.push(`seed ${entry.seed} drew offsets ${x},${y} outside the kit's 0..1`);
    if (!(rotate >= 0 && rotate <= 360))
      issues.push(`seed ${entry.seed} drew rotate ${rotate} outside the kit's 0..360`);
    if (!(entry.colorOpaque > 0)) issues.push(`seed ${entry.seed} composed an empty colour map`);
  }
  if (proof.distinctSeedSpreadMaps !== spread.length)
    issues.push('two seeds of one pattern finish composed the same colour map');

  // The M4A1: its finishes must come from its own staged inputs, so the sampled textures it composed
  // with are its own rather than the first weapon's. Three of its styles are composed, which is what
  // shows the composition follows the finish's style rather than being one program: style 7 (pattern
  // only), style 2 (pattern times the finish's own colours) and style 1 (the palette alone, with no
  // pattern bound at all).
  const groups = proof.weapons ?? [];
  const group = (weapon) => groups.find((entry) => entry.weapon === weapon);
  const m4 = group('weapon_m4a1')?.finishes ?? [];
  if (m4.length !== 4) issues.push(`the preview composed ${m4.length} M4A1 finishes, not four`);
  const m4Styles = new Set(m4.map((finish) => finish.style));
  for (const style of [7, 2, 1]) if (!m4Styles.has(style)) issues.push(`no M4A1 finish of style ${style} was composed`);
  for (const finish of m4) {
    if (finish.weapon !== 'weapon_m4a1') issues.push(`an M4A1 finish reports weapon ${finish.weapon}`);
    const staged = stagedFor('weapon_m4a1', finish.paintKitId);
    if (finish.style === 1) {
      // The solid-colour style binds no pattern: its colour comes from the palette constants, and a
      // pattern bound for it would have been refused rather than ignored.
      if (finish.patternSha256 !== null || finish.patternSourceMaterial !== null)
        issues.push(`M4A1 solid-colour finish ${finish.paintKitId} composed a pattern`);
      if (finish.colours?.length !== 4)
        issues.push(`M4A1 solid-colour finish ${finish.paintKitId} carries no four colours`);
    } else {
      if (!staged) { issues.push(`M4A1 finish ${finish.paintKitId} has no staged pattern`); continue; }
      if (finish.patternSha256 !== staged.sha256)
        issues.push(`M4A1 finish ${finish.paintKitId} composed ${finish.patternSha256}, not the staged ${staged.sha256}`);
    }
    // The weapon-level albedo boost is the M4A1's, not the AK's, which is what shows the
    // composition really took the weapon's own values.
    if (finish.phongAlbedoFactor !== 25)
      issues.push(`M4A1 finish ${finish.paintKitId} composed with albedo ${finish.phongAlbedoFactor}, not 25`);
    if (!(finish.colorOpaque > 0)) issues.push(`M4A1 finish ${finish.paintKitId} composed an empty colour map`);
    if (finish.colorSize !== 1024 || finish.exponentSize !== 256)
      issues.push(`M4A1 finish ${finish.paintKitId} composed at ${finish.colorSize}/${finish.exponentSize}`);
  }

  // The third weapon: two of its finishes are the same style, so the only thing that differs
  // between them is the finish's own four colours. Identical maps here would mean the palette never
  // reached the shader, which no per-finish pattern could hide because there is no pattern.
  const glock = group('weapon_glock')?.finishes ?? [];
  const solid = glock.filter((finish) => finish.style === 1);
  if (solid.length !== 2) issues.push(`the preview composed ${solid.length} solid-colour glock finishes, not two`);
  if (new Set(solid.map((finish) => finish.colorSha256)).size !== solid.length)
    issues.push('two solid-colour finishes of one style composed the same colour map');
  if (new Set(solid.map((finish) => finish.colours.map((colour) => colour.join(',')).join('|'))).size !== solid.length)
    issues.push('two solid-colour finishes were given the same palette');
  if (new Set(solid.map((finish) => finish.colorMean.join(','))).size !== solid.length)
    issues.push('two solid-colour finishes composed the same mean colour');
  if (!glock.some((finish) => finish.style === 7 && finish.boundPattern?.sha256 === stagedFor('weapon_glock', finish.paintKitId)?.sha256))
    issues.push('the glock\'s pattern style did not compose with its own staged artwork');
  for (const finish of glock)
    if (!(finish.colorOpaque > 0)) issues.push(`glock finish ${finish.paintKitId} composed an empty colour map`);

  // The fourth weapon: a style that multiplies the finish's own pattern by the finish's own colours.
  const usp = group('weapon_usp_silencer')?.finishes ?? [];
  if (usp.length !== 1) issues.push(`the preview composed ${usp.length} USP finishes, not one`);
  for (const finish of usp) {
    if (finish.style !== 2) issues.push(`the USP finish composed in style ${finish.style}, not 2`);
    const staged = stagedFor('weapon_usp_silencer', finish.paintKitId);
    if (!staged) issues.push(`USP finish ${finish.paintKitId} has no staged pattern`);
    else if (finish.patternSha256 !== staged.sha256)
      issues.push(`USP finish ${finish.paintKitId} composed ${finish.patternSha256}, not the staged ${staged.sha256}`);
    if (finish.phongAlbedoFactor !== 80)
      issues.push(`USP finish ${finish.paintKitId} composed with albedo ${finish.phongAlbedoFactor}, not 80`);
    if (!(finish.colorOpaque > 0)) issues.push(`USP finish ${finish.paintKitId} composed an empty colour map`);
  }

  // The weapons must not have composed the same maps even though they share the shared paint
  // textures, since their weapon-level inputs differ.
  const all = groups.flatMap((entry) => entry.finishes);
  if (new Set(all.map((finish) => finish.colorSha256)).size !== all.length)
    issues.push('two compositions share a colour map');
  if (errors.length) issues.push(...errors.map((error) => 'browser: ' + error));
  const evidence = { status: issues.length ? 'FAILED' : 'ORIGINAL FINISH COMPOSITION PASSED', port, proof, issues, errors };
  writeFileSync(resolve(outputDir, 'source-finishes-evidence.json'), JSON.stringify(evidence, null, 1) + '\n');
  console.log(evidence.status);
  for (const finish of all)
    console.log(`  ${finish.weapon.replace('weapon_', '')} #${finish.paintKitId} style ${finish.style} `
      + `${finish.patternSourceMaterial ? finish.patternSourceMaterial.split('/').pop() : 'palette-only'} `
      + `albedo ${finish.phongAlbedoFactor} color ${finish.colorSha256.slice(0, 12)}… `
      + `mean ${finish.colorMean.join(',')} opaque ${finish.colorOpaque}`);
  if (issues.length) { for (const issue of issues) console.log('  issue: ' + issue); process.exitCode = 1; }
} finally {
  await browser?.close?.().catch?.(() => {});
  child.kill('SIGTERM');
}
