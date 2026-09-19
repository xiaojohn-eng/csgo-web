#!/usr/bin/env node
// Fires the real game's rifle at the map's own surfaces and reads what the original leaves.
//
// The unit tests pin the table, the rectangles and the waves against the shipped files. This
// proves the game itself uses them: in a real browser, on the shipped map, each shot that
// stops on the world draws one original bullet hole of that surface's own decal group and
// plays one original wave of that surface's own impact event — and a shot that stops on a
// different surface draws a different original hole and plays a different original wave.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.SOURCE_IMPACT_BASE || 'http://127.0.0.1:27019';
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const errors = [];

// Aim through the real pointer-locked mousemove path, then fire with the real canvas events.
const aimAndFire = (yawOffset, pitch, rounds) => `(async () => {
  const g = window.__BREACHLINE__.runtime();
  if (!g || !document.pointerLockElement) return { reason: 'not-locked' };
  const desiredYaw = g.yaw + ${yawOffset};
  const yawDelta = Math.atan2(Math.sin(desiredYaw - g.yaw), Math.cos(desiredYaw - g.yaw));
  const pitchDelta = ${pitch} - g.pitch;
  document.dispatchEvent(new MouseEvent('mousemove', {
    movementX: -yawDelta / 0.0018, movementY: -pitchDelta / 0.0018,
  }));
  await new Promise((r) => setTimeout(r, 120));
  const canvas = g.art.renderer.domElement;
  let fired = 0;
  for (let round = 0; round < ${rounds}; round++) {
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    await new Promise((r) => setTimeout(r, 110));
    canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    await new Promise((r) => setTimeout(r, 180));
    fired++;
  }
  return { reason: 'fired', fired, yaw: g.yaw, pitch: g.pitch };
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
  await page.getByRole('textbox', { name: '呼号', exact: true }).fill('Impact');
  await start.click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  // The shipped decal sheets have to be verified against their receipts before a shot can mark.
  await page.waitForFunction(() => {
    const audit = window.__BREACHLINE__?.assetAudit?.()?.sourceImpact;
    return !!audit && audit.atlases.length > 0 && audit.atlases.every((atlas) => atlas.verified);
  }, null, { timeout: 180000 });
  await page.waitForFunction(() => (window.__BREACHLINE__?.audioAudit?.()?.impactSounds?.records ?? 0) > 0,
    null, { timeout: 180000 });
  const before = await page.evaluate(() => ({
    impact: window.__BREACHLINE__.assetAudit().sourceImpact,
    audio: window.__BREACHLINE__.audioAudit().impactSounds,
  }));

  const rounds = [];
  // Straight ahead and around the spawn: walls, then the ground close and far, then up.
  for (const [yaw, pitch, shots] of [[0, -0.20, 4], [1.2, -0.30, 3], [2.4, -0.25, 3], [3.6, -0.25, 3],
    [4.8, -0.30, 3], [6.0, -0.20, 3], [0.4, -0.70, 3], [2.9, -0.70, 3], [5.4, -0.75, 3],
    [0, 0.10, 3], [3.1, 0.15, 3]]) {
    rounds.push(await page.evaluate(aimAndFire(yaw, pitch, shots)));
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => {
    const g = window.__BREACHLINE__.runtime();
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: (0.1 - g.pitch) / 0.0018 }));
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(outputDir, 'source-impact-ingame.png') });
  const after = await page.evaluate(() => ({
    impact: window.__BREACHLINE__.assetAudit().sourceImpact,
    audio: window.__BREACHLINE__.audioAudit().impactSounds,
  }));
  await page.keyboard.press('Escape');

  // The staged table read from disk, so every decision the page made is checked against the
  // shipped file rather than against the page's own copy of it.
  const table = JSON.parse(readFileSync(resolve(root, 'game/source-impact-table.json'), 'utf8'));
  const metresPerUnit = JSON.parse(
    readFileSync(resolve(root, 'public/source/csgo-12426148/dust2/level.json'), 'utf8')).metersPerSourceUnit;

  const marks = after.impact.marks;
  if (marks.length < 12) throw Error('Too few original decals were drawn to read: ' + marks.length);
  // Each mark must be one of the surface's own decal group, inside the sheet it names, with
  // the size the shipped rectangle and scale imply.
  const sheets = new Map(after.impact.atlases.map((atlas) => [atlas.name, atlas]));
  const surfaces = new Map();
  for (const mark of marks) {
    if (!mark.drawn || !mark.material) throw Error('A recorded mark was not drawn: ' + JSON.stringify(mark));
    const sheet = sheets.get(mark.atlas);
    if (!sheet) throw Error('A mark names an atlas that was not verified: ' + mark.atlas);
    const [x, y, width, height] = mark.atlasRect;
    if (x < 0 || y < 0 || x + width > sheet.width || y + height > sheet.height)
      throw Error(`A mark sits outside its sheet: ${JSON.stringify(mark.atlasRect)} in ${sheet.name}`);
    const normal = Math.hypot(...mark.normal);
    if (Math.abs(normal - 1) > 1e-6) throw Error('A mark has no unit normal: ' + normal);
    const offset = Math.hypot(mark.position[0] - mark.surfacePoint[0], mark.position[1] - mark.surfacePoint[1],
      mark.position[2] - mark.surfacePoint[2]);
    // The quad is biased off the surface by 0.01 Source units; nothing else may move it.
    if (offset > 0.001) throw Error('A mark is not on the surface the shot reported: ' + offset);
    const row = table.impact[mark.surfaceProp];
    if (!row) throw Error('A mark names a surface the shipped table does not describe: ' + mark.surfaceProp);
    const member = row.decals.find((entry) => entry.material === mark.material);
    if (!member) throw Error(`A mark drew ${mark.material}, which is not in ${mark.surfaceProp}'s decal group`);
    const definition = table.decalMaterials[mark.material];
    if (definition.atlas !== mark.atlas || JSON.stringify([definition.pos[0], definition.pos[1], definition.size[0],
      definition.size[1]]) !== JSON.stringify(mark.atlasRect))
      throw Error('A mark drew a rectangle its own material does not carry: ' + mark.material);
    const base = definition.size[0] * definition.scale * metresPerUnit;
    const variation = definition.scaleVariation ?? 0;
    if (Math.abs(mark.sizeMetres - base) > base * variation + 1e-6)
      throw Error(`A mark's size is outside its own $decalScaleVariation: ${mark.sizeMetres} vs ${base}`);
    if (!(mark.gameMaterial === row.gameMaterial))
      throw Error('A mark reports a game material its surface does not have');
    const entry = surfaces.get(mark.surfaceProp) ?? { surfaceProp: mark.surfaceProp, gameMaterial: mark.gameMaterial,
      materials: new Set(), sizes: [], count: 0, event: row.bulletImpact };
    entry.materials.add(mark.material);
    entry.sizes.push(mark.sizeMetres);
    entry.count++;
    surfaces.set(mark.surfaceProp, entry);
  }
  if (surfaces.size < 2)
    throw Error(`The shots only ever landed on ${surfaces.size} original surface(s): ${[...surfaces.keys()].join(',')}`);
  const distinctMaterials = new Set(marks.map((mark) => mark.material));
  if (distinctMaterials.size < 2) throw Error('Every surface drew the same original decal');

  const played = after.audio.played;
  if (Object.values(played).reduce((sum, count) => sum + count, 0) < 12)
    throw Error('Too few original impact waves were played: ' + JSON.stringify(played));
  const verified = Object.values(after.audio.hashVerified);
  if (verified.length !== after.audio.records || verified.some((value) => value !== true))
    throw Error('Not every original impact wave was verified before use');
  if (Object.keys(played).length < 2)
    throw Error('The shots only ever played one original impact sound: ' + JSON.stringify(played));
  // Every surface hit has to have played exactly its own shipped impact event.
  for (const entry of surfaces.values()) {
    if (!entry.event) throw Error(`The shipped table names no impact sound for ${entry.surfaceProp}`);
    if (!(played[entry.event] > 0))
      throw Error(`${entry.surfaceProp} was hit ${entry.count} time(s) but ${entry.event} never played`);
  }
  const evidence = {
    status: 'passed-original-bullet-impacts-in-game',
    scope: 'The local player in a real browser on the shipped de_dust2: every shot that stopped on the '
      + 'world drew one bullet hole from the surface\'s own decal group on the shipped atlas, and played '
      + 'one verified wave of that surface\'s own original impact event.',
    url: base,
    tableBuild: after.impact.tableBuild, decalMaterials: after.impact.decalMaterials,
    surfacesInTable: after.impact.surfaces, budget: after.impact.budget, live: after.impact.live,
    atlases: after.impact.atlases.map((atlas) => ({ name: atlas.name, url: atlas.url, bytes: atlas.bytes,
      sha256: atlas.sha256, width: atlas.width, height: atlas.height, verified: atlas.verified })),
    shotsAttempted: rounds.reduce((sum, round) => sum + (round.fired ?? 0), 0),
    rounds, marksRead: marks.length, marksDrawn: after.impact.drawn, refused: after.impact.refused,
    surfacesHit: [...surfaces.values()].map((entry) => ({ surfaceProp: entry.surfaceProp,
      gameMaterial: entry.gameMaterial, marks: entry.count, decals: [...entry.materials].sort(),
      impactEvent: entry.event, played: played[entry.event] ?? 0,
      sizeMetres: [Math.min(...entry.sizes), Math.max(...entry.sizes)].map((value) => +value.toFixed(4)) })),
    distinctDecals: [...distinctMaterials].sort(),
    impactWaves: { records: after.audio.records, verifiedRecords: verified.length,
      allVerified: verified.every((value) => value === true), played, recent: after.audio.history.slice(-12) },
    before: { atlases: before.impact.atlases.length, marks: before.impact.marks.length,
      records: before.audio.records, played: before.audio.played },
    errors,
    boundary: 'Reads the marks the port drew and the waves it played; it does not compare them against a '
      + 'recording of the original client, and the original `Subrect` depth fade, r_decals budget '
      + 'and draw inside `$decalScaleVariation` are not reproduced. The decal\'s fog fade is drawn - '
      + '`scripts/run-playwright-source-decal-fog-fade.mjs` measures it in pixels against the shipped '
      + 'program\'s own arithmetic.',
  };
  writeFileSync(resolve(outputDir, 'source-impact-ingame.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await browser.close();
}
