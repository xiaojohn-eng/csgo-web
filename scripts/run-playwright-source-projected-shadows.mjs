#!/usr/bin/env node
// Dust2's actors cast the original's own shadows: a silhouette of the actor, projected straight
// down by the map's `shadow_control` (128 grey, 72 units of reach). `scripts/probe-source-projected-
// shadows.py` reads that out of the shipped build; this run proves the browser is drawing it.
//
//   * the live system carries the map's own numbers - colour, reach, enabled - and the renderer's
//     sun shadow is off, because this map declares no cascade light to cast one;
//   * a caster really has a silhouette under it: the ground under a bot is measured before and
//     after its shadow is shown, with the bot itself hidden, and the ratio is the map's shadow
//     colour where the silhouette covers the surface;
//   * the shadow hangs straight down rather than along the sun: its own centroid sits under the
//     caster, and the ground the sun would have shadowed (1.2 m along the sun's azimuth) is
//     untouched.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.SOURCE_SKY_BASE || 'http://127.0.0.1:27019';
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const errors = [];
const staged = JSON.parse(readFileSync(resolve(root, 'public/source/csgo-12426148/dust2/environment.json'), 'utf8'));
const shadow = staged.shadow;
const expectedColor = shadow.color.map((channel) => channel / 255);
const expectedReach = shadow.distance * staged.metersPerSourceUnit;
const sunDirection = (() => {
  const [x, y] = staged.light.sunSourceDirection;
  // The port's world frame is `(x, y, z) -> (x, z, -y)`, so the sun's horizontal direction there is
  // `(x, -y)` of the Source direction, pointing at the sun.
  const length = Math.hypot(x, y);
  return [x / length, -y / length];
})();

const AUDIT = `(() => {
  const art = window.__BREACHLINE__.runtime().art;
  const shadows = art.sourceProjectedShadows;
  if (!shadows) return {error: 'the original projected shadows are not loaded'};
  return {audit: shadows.audit(), sunCasts: art.sun.castShadow,
    shadowMapEnabled: art.renderer.shadowMap.enabled,
    casters: [...art.actors.entries()].map(([id, root]) => ({id, visible: root.visible,
      position: root.position.toArray()}))};
})()`;

/**
 * The pixel measurement.
 *
 * The camera is parked above and to the side of a caster's own shadow, looking down at the ground
 * patch it covers. The caster's model is hidden for both frames - otherwise the actor would stand
 * in front of its own shadow - and the frame is read twice: once with the shadow group hidden,
 * which is the bare ground, and once with it drawn. The ratio is the factor the shadow multiplied
 * the ground by, and the patch says how far the silhouette reaches and where its centre landed.
 */
const probe = (setup) => {
  const {id, span, step, sunward} = setup;
  const art = window.__BREACHLINE__.runtime().art;
  const shadows = art.sourceProjectedShadows;
  const renderer = art.renderer, scene = art.scene, camera = art.camera;
  const gl = renderer.getContext();
  const Vector = camera.position.constructor;
  const size = renderer.getDrawingBufferSize(new Vector());
  const width = size.x, height2 = size.y;
  const bytes = new Uint8Array(width * height2 * 4);
  const read = (at) => [bytes[at] / 255, bytes[at + 1] / 255, bytes[at + 2] / 255];

  const audit = shadows.audit();
  const caster = audit.drawn.find((row) => row.id === id);
  if (!caster) return {error: `caster ${id} has no shadow to measure`};
  const actor = art.actors.get(id);
  if (!actor) return {error: `caster ${id} is not in the scene`};
  const centre = new Vector(...caster.at);

  const saved = {position: camera.position.clone(), quaternion: camera.quaternion.clone(),
    fov: camera.fov, background: scene.background, clear: new Vector(),
    actorVisible: actor.visible, groupVisible: shadows.group.visible};
  renderer.getClearColor(saved.clear);
  const savedClearAlpha = renderer.getClearAlpha();

  // Look down at the patch from above and to the side, with the actor out of its own shadow's way.
  actor.visible = false;
  scene.background = null;
  renderer.setClearColor(0x000000, 1);
  camera.position.copy(centre).add(new Vector(span * 1.6, span * 4.2, span * 1.6));
  camera.fov = 40;
  camera.lookAt(centre);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const samples = [];
  for (let alongX = -span; alongX <= span + 1e-9; alongX += step) {
    for (let alongZ = -span; alongZ <= span + 1e-9; alongZ += step) {
      const world = centre.clone().add(new Vector(alongX, 0, alongZ));
      const screen = world.clone().project(camera);
      const x = Math.round(((screen.x + 1) / 2) * width);
      const y = Math.round(((screen.y + 1) / 2) * height2);
      if (x < 0 || y < 0 || x >= width || y >= height2) continue;
      samples.push({world: [alongX, alongZ], at: ((height2 - 1 - y) * width + x) * 4});
    }
  }
  if (samples.length < 400) return {error: `too few samples over the ground: ${samples.length}`};

  const shoot = () => {
    renderer.render(scene, camera);
    gl.readPixels(0, 0, width, height2, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  };
  shadows.group.visible = false;
  shoot();
  const bare = samples.map((sample) => read(sample.at));
  shadows.group.visible = true;
  shoot();
  const shaded = samples.map((sample) => read(sample.at));

  const rows = samples.map((sample, index) => {
    const factor = shaded[index].map((value, channel) => bare[index][channel] > 1e-6
      ? value / bare[index][channel] : 1);
    const darkest = Math.min(...factor);
    return {world: sample.world, bare: bare[index], shaded: shaded[index], factor, darkest};
  });
  const inside = rows.filter((row) => row.darkest < 0.985);
  if (!inside.length) return {error: 'the shadow changed nothing under the caster'};
  const centroid = inside.reduce((sum, row) => [sum[0] + row.world[0], sum[1] + row.world[1]],
    [0, 0]).map((value) => value / inside.length);
  const extremes = inside.reduce((sum, row) => [
    Math.min(sum[0], row.world[0]), Math.max(sum[1], row.world[0]),
    Math.min(sum[2], row.world[1]), Math.max(sum[3], row.world[1])],
    [Infinity, -Infinity, Infinity, -Infinity]);
  const darkestRow = rows.reduce((best, row) => row.darkest < best.darkest ? row : best, rows[0]);
  // What 1.2 m along the sun's azimuth from the caster's own foot reads: a shadow cast along the
  // sun would darken that ground, a shadow projected straight down cannot.
  const sunwardSample = rows.reduce((best, row) => {
    const distance = Math.hypot(row.world[0] - sunward[0], row.world[1] - sunward[1]);
    return distance < best.distance ? {row, distance} : best;
  }, {row: rows[0], distance: Infinity});

  actor.visible = saved.actorVisible;
  shadows.group.visible = saved.groupVisible;
  camera.position.copy(saved.position);
  camera.quaternion.copy(saved.quaternion);
  camera.fov = saved.fov;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  scene.background = saved.background;
  renderer.setClearColor(saved.clear, savedClearAlpha);

  return {caster, colour: audit.color, reach: audit.maxDistanceMetres,
    coverage: {fraction: inside.length / rows.length, centroid,
      extent: [extremes[1] - extremes[0], extremes[3] - extremes[2]],
      sizeMetres: caster.sizeMetres},
    darkest: {factor: darkestRow.factor, at: darkestRow.world, bare: darkestRow.bare,
      shaded: darkestRow.shaded},
    sunward: {factor: sunwardSample.row.factor, at: sunwardSample.row.world, wanted: sunward,
      distance: sunwardSample.distance},
    samples: rows.length};
};

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
  await page.getByRole('textbox', { name: '呼号', exact: true }).fill('Shadows');
  await start.click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.waitForFunction(() => {
    const audit = window.__BREACHLINE__?.runtime?.()?.art?.sourceProjectedShadowAudit?.();
    return !!(audit && audit.drawn && audit.drawn.length);
  }, null, { timeout: 180000 });
  await page.waitForTimeout(500);

  const live = await page.evaluate(AUDIT);
  if (live.error) throw Error(live.error);
  const audit = live.audit;
  const close = (a, b, tolerance) => a.length === b.length &&
    a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
  if (!audit.enabled) throw Error('the map\'s shadow control says shadows are disabled');
  if (!close(audit.color, expectedColor, 1e-9)) {
    throw Error(`the live shadow colour is ${JSON.stringify(audit.color)}, not the map's `
      + `${JSON.stringify(expectedColor)}`);
  }
  if (Math.abs(audit.maxDistanceMetres - expectedReach) > 1e-9) {
    throw Error(`the live reach is ${audit.maxDistanceMetres} m, not the map's ${expectedReach}`);
  }
  if (live.sunCasts) {
    throw Error('the sun still casts a shadow map, which this map declares no cascade light for');
  }
  if (!live.shadowMapEnabled) throw Error('the renderer\'s shadow map was turned off entirely');
  if (!audit.limitations.length) throw Error('the projected shadows state no limitations');

  // One bot with a shadow: its own id, its own origin, and what the map says a shadow is.
  const caster = audit.drawn[0];
  const sunward = [sunDirection[0] * 1.2, sunDirection[1] * 1.2];
  const measured = await page.evaluate(probe, {id: caster.id, span: 1.1, step: 0.05, sunward});
  if (measured.error) throw Error(measured.error);

  const floor = Math.min(...measured.colour);
  const darkest = Math.min(...measured.darkest.factor);
  // The shadow multiplies the ground by the control's colour where the silhouette covers it, and by
  // less where it only partly covers it - so the darkest sample sits between the colour and 1.
  if (darkest > floor + 0.06) {
    throw Error(`the darkest shadow sample is ${darkest.toFixed(4)}, where the map's own colour `
      + `would be ${floor.toFixed(4)}`);
  }
  if (darkest < floor - 0.02) {
    throw Error(`the shadow darkened the ground past the map's own colour: ${darkest.toFixed(4)} `
      + `against ${floor.toFixed(4)}`);
  }
  // It hangs under the caster: the silhouette's own centre is within a foot of the caster's origin.
  const drift = Math.hypot(measured.coverage.centroid[0], measured.coverage.centroid[1]);
  if (drift > 0.25) {
    throw Error(`the shadow's centre is ${drift.toFixed(3)} m from the caster's own footprint`);
  }
  // A shadow cast along the sun would darken the ground 1.2 m toward the sun's azimuth; a shadow
  // projected straight down leaves it alone.
  if (Math.min(...measured.sunward.factor) < 0.97) {
    throw Error(`the ground ${measured.sunward.distance.toFixed(2)} m toward the sun is darkened to `
      + `${Math.min(...measured.sunward.factor).toFixed(4)}, so the shadow is cast along the sun`);
  }
  // The silhouette covers the caster, not the whole quad: the model, not a rectangle. A standing
  // player seen from above covers a small share of its own footprint, which is the point.
  if (measured.coverage.fraction < 0.01 || measured.coverage.fraction > 0.9) {
    throw Error(`the shadow covers ${(measured.coverage.fraction * 100).toFixed(1)}% of the ground `
      + 'patch, which is not a silhouette');
  }
  if (measured.coverage.extent[0] > measured.coverage.sizeMetres * 1.2 ||
    measured.coverage.extent[1] > measured.coverage.sizeMetres * 1.2) {
    throw Error(`the shadow reaches ${JSON.stringify(measured.coverage.extent)} m for a caster `
      + `${measured.coverage.sizeMetres} m wide`);
  }

  await page.screenshot({ path: resolve(outputDir, 'source-projected-shadows-ingame.png') });
  const evidence = {scope: 'The map\'s own projected shadows: a silhouette under every actor',
    staged: {shadow, expectedColor, expectedReachMetres: expectedReach, sunHorizontal: sunDirection},
    audit: {...audit, casters: live.casters}, measured, errors};
  if (errors.length) throw Error(errors.join('\n'));
  writeFileSync(resolve(outputDir, 'source-projected-shadows-ingame.json'),
    JSON.stringify(evidence, null, 1) + '\n');
  console.log(JSON.stringify({status: 'passed',
    audit: {enabled: audit.enabled, color: audit.color, reachMetres: audit.maxDistanceMetres,
      sunCasts: live.sunCasts, casters: audit.casters, drawn: audit.drawn.length},
    shadow: {caster: measured.caster.id, footprintMetres: measured.caster.sizeMetres,
      dropMetres: measured.caster.distanceMetres,
      darkestFactor: +darkest.toFixed(4), mapColour: +floor.toFixed(4),
      centreDriftMetres: +drift.toFixed(3),
      coverageFraction: +measured.coverage.fraction.toFixed(3),
      extentMetres: measured.coverage.extent.map((value) => +value.toFixed(2)),
      sunwardFactor: +Math.min(...measured.sunward.factor).toFixed(4)},
    screenshot: 'output/playwright/source-projected-shadows-ingame.png'}, null, 1));
} finally {
  await browser.close();
}
