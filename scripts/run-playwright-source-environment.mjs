#!/usr/bin/env node
// Dust2 now lights and hazes itself from what the map states, not from renderer defaults.
//
// The map ships one `light_environment` (its sun, its ambient, and the `_lightscaleHDR` the sky
// shaders read as `cLightScale`), one `env_fog_controller` (its colour, its `fogstart`/`fogend`
// and its `fogmaxdensity`) and a `logic_auto` that pushes an exposure range into an
// `env_tonemap_controller`. `scripts/probe-source-environment.py` reads those out of the frozen
// BSP and the shipped build; this run proves the *browser* is using them:
//
//  * the live fog is a three linear `Fog` carrying the map's own near/far and colour, the ramp
//    the GPU was given is the original's capped linear one, and the cap every fogged material
//    reads is one shared value (asserted by object identity across two different materials);
//  * the two-texture sky material's own program, as compiled, ends with `rgb * cLightScale`;
//  * and the fog is measured in pixels against the original's own formula
//    `min($fogmaxdensity, ($fogstart..$fogend ramp))`, on probe quads placed at known depths so
//    the expected factor is exact - including past `$fogend`, where three's own smoothstep
//    towards 1 would be wrong, and at the map's own cap, which three cannot express at all.
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
const CLOUD = 'models/props/de_nuke/hr_nuke/nuke_skydome_001/nuke_clouds_002';
if (!staged.fog || staged.fog.maxDensity !== 0.4) throw Error('the staged map environment lost its fog');
// The material's own second texture name, so the live dome is compared with the descriptor it
// came from rather than with a staged file name it never carries.
const sky = JSON.parse(readFileSync(resolve(root, 'public/source/csgo-12426148/dust2/sky.json'), 'utf8'));
const cloud = sky.unlitMaterials.find((rule) => rule.source === CLOUD);
if (!cloud || !cloud.second) throw Error('the staged sky no longer carries its cloud layer');
// The original's own ramp, straight from the map's numbers.
const expectedFactor = (metres) => Math.min(staged.fog.maxDensity,
  Math.max(0, (metres - staged.fog.nearMetres) / (staged.fog.farMetres - staged.fog.nearMetres)));

/** Reads what the running game is actually hazing and lighting with. */
const AUDIT = `(() => {
  const game = window.__BREACHLINE__.runtime();
  const art = game && game.art;
  if (!art) return { error: 'the game has no scene' };
  const audit = art.sourceEnvironmentAudit;
  // Every fogged material in the scene, to check the cap is one shared object rather than a
  // per-material copy; only a few are kept, the rest are counted.
  const properties = art.renderer.properties;
  const values = new Set();
  const sample = [];
  const seen = new Set();
  art.scene.traverse((object) => {
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (!material || !material.fog || seen.has(material.uuid)) continue;
      seen.add(material.uuid);
      const uniforms = properties.get(material).uniforms;
      if (!uniforms || !uniforms.fogMaxDensity) continue;
      values.add(uniforms.fogMaxDensity.value);
      if (sample.length < 4) sample.push({name: material.name, same: true, cap: uniforms.fogMaxDensity.value.x});
    }
  });
  const sky = art.sourceMap && art.sourceMap.sky ? art.sourceMap.sky : null;
  let dome = null;
  if (sky) sky.scene.traverse((object) => {
    for (const material of (Array.isArray(object.material) ? object.material : [object.material]))
      if (material && material.userData && material.userData.sourceLightScale !== undefined) dome = material;
  });
  const programs = (art.renderer.info.programs || []).map((program) => ({cacheKey: program.cacheKey,
    fragment: art.renderer.getContext().getShaderSource(program.fragmentShader) || ''}))
    .filter((program) => String(program.cacheKey).includes('source-sky-two-texture'));
  // How much of the real scene is even fogged: a frame that barely changes is uninformative.
  let meshes = 0, fogged = 0, unfogged = 0, noFogFlag = 0;
  art.scene.traverse((object) => {
    if (!object.isMesh && !object.isSprite && !object.isPoints) return;
    meshes++;
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (!material || material.fog === undefined) { noFogFlag++; continue; }
      if (material.fog) fogged++; else unfogged++;
    }
  });
  return {audit, shared: {carriers: seen.size, distinctObjects: values.size, sample},
    dome: dome ? {name: dome.name, lightScale: dome.userData.sourceLightScale,
      second: dome.userData.sourceSecondTexture || null} : null,
    census: {meshes, fogged, unfogged, noFogFlag},
    programs: programs.map((program) => ({cacheKey: program.cacheKey,
      multipliesRgb: program.fragment.includes('diffuseColor.rgb *= sourceSkyLightScale;'),
      declaresLightScale: program.fragment.includes('uniform float sourceSkyLightScale;'),
      samplesSecond: program.fragment.includes('sourceSkySecondTexture')}))};
})()`;

/** Measures the fog in pixels: probe quads at known depths, then the real map frame. */
const measure = ({depths, fogSrgb, nearMetres, farMetres, maxDensity, quads}) => {
  const game = window.__BREACHLINE__.runtime();
  const art = game.art, renderer = art.renderer, scene = art.scene, camera = art.camera;
  const gl = renderer.getContext();
  const size = renderer.getDrawingBufferSize(new (camera.position.constructor)());
  const width = size.x, height = size.y;
  const bytes = new Uint8Array(width * height * 4);
  const readback = () => { gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes); return bytes.slice(); };
  const centre = {x: Math.floor(width / 2), y: Math.floor(height / 2)};
  const pixel = (buffer, at) => { const i = ((height - 1 - at.y) * width + at.x) * 4; return [buffer[i], buffer[i + 1], buffer[i + 2]]; };
  renderer.setRenderTarget(null);
  const capUniform = (() => {
    let found = null;
    scene.traverse((object) => {
      for (const material of (Array.isArray(object.material) ? object.material : [object.material]))
        if (!found && material && material.fog) {
          const uniforms = renderer.properties.get(material).uniforms;
          if (uniforms && uniforms.fogMaxDensity) found = uniforms.fogMaxDensity;
        }
    });
    return found;
  })();
  if (!capUniform) return {error: 'no fogged material carries the shared fog cap uniform'};

  // --- (B) the real map frame: the same three caps, so the cap clamp is checked on real geometry.
  const original = capUniform.value.x;
  const compareFrame = () => {
    const frame = (cap) => { capUniform.value.x = cap; renderer.render(scene, camera); return readback(); };
    const noFog = frame(0), mapFog = frame(maxDensity), lowered = frame(0.25);
    // A pixel that blends a surface with the one behind it - a sprite, an additive ribbon, the
    // unfogged sky through glass - is a cascade of two different fog factors, and no single
    // factor describes it. Hiding every blended surface and drawing again says which pixels are
    // one surface only: those, and only those, are judged.
    const blended = [];
    scene.traverse((object) => {
      const list = Array.isArray(object.material) ? object.material : [object.material];
      const mixes = object.isSprite || object.isPoints || list.some((material) => material &&
        (material.transparent || (material.blending !== undefined && material.blending !== 1)));
      if (mixes) { blended.push({object, visible: object.visible}); object.visible = false; }
    });
    capUniform.value.x = 0;
    renderer.render(scene, camera);
    const opaqueOnly = readback();
    capUniform.value.x = original;
    for (const row of blended) row.object.visible = row.visible;
    capUniform.value.x = original;
    let covered = 0, changed = 0, worst = 0, beyondCap = 0, mismatched = 0, worstClamp = 0;
    let capLawViolations = 0, capLawChannels = 0, checkedClamp = 0, unscalable = 0;
    const bands = Array.from({length: 8}, () => 0), examples = [];
    let lowest = Infinity, highest = 0;
    for (let i = 0; i < noFog.length; i += 4) {
      const at = i / 4, x = at % width, y = Math.floor(at / width);
      // An antialiased or depth-discontinuous pixel mixes two surfaces that carry two different
      // fog factors, so no single factor models it. Interior pixels only.
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      const neighbours = [i - width * 4, i + width * 4, i - 4, i + 4];
      if (!neighbours.every((next) => [0, 1, 2]
        .every((channel) => Math.abs(noFog[next + channel] - noFog[i + channel]) <= 8))) continue;
      // One surface only: hiding every blended surface left this pixel exactly as it was.
      if ([0, 1, 2].some((channel) => opaqueOnly[i + channel] !== noFog[i + channel])) continue;
      const off = [noFog[i], noFog[i + 1], noFog[i + 2]];
      // A pixel that clips against 0 or 255 in the fogged frame loses the factor that pushed it
      // there, so it cannot be solved back out. Skip it rather than read it as a small factor.
      if (mapFog[i] >= 250 || mapFog[i + 1] >= 250 || mapFog[i + 2] >= 250) continue;
      if (mapFog[i] <= 4 || mapFog[i + 1] <= 4 || mapFog[i + 2] <= 4) continue;
      // Only channels whose fog colour is far enough from the pixel can carry a factor: a level of
      // 8-bit rounding on a narrow span would be read as the whole factor. The same channels are
      // the only ones the fit is then checked against, for the same reason.
      const solved = off.map((value, channel) => ({channel, gap: fogSrgb[channel] - value,
        delta40: mapFog[i + channel] - value, delta25: lowered[i + channel] - value}))
        .filter((row) => Math.abs(row.gap) >= 60);
      if (solved.length < 2) continue;
      const weight = solved.reduce((sum, row) => sum + row.gap * row.gap, 0);
      const fit = (key) => solved.reduce((sum, row) => sum + row[key] * row.gap, 0) / weight;
      const factor = fit('delta40'), factor25 = fit('delta25');
      // One surface only: a single factor must explain the whole colour change to within rounding.
      if (solved.some((row) => Math.abs(row.delta40 - factor * row.gap) > 1.2)) continue;
      const gap = Math.max(...solved.map((row) => Math.abs(row.gap)));
      covered++;
      const moved = Math.max(...off.map((value, channel) => Math.abs(mapFog[i + channel] - value)));
      if (moved > 0) changed++;
      worst = Math.max(worst, moved);
      lowest = Math.min(lowest, factor); highest = Math.max(highest, factor);
      bands[Math.min(bands.length - 1, Math.floor((factor / maxDensity) * bands.length))]++;

      // The cap, on every comparable channel and with no assumption about the span the surface
      // mixes over: the fog is always a mix toward one colour by `min(cap, the surface's own
      // factor)`, so a cap of 0.4 can never haze a channel by less than a cap of 0.25, and never
      // by more than 0.4/0.25 of it. This is the statement that three's own fog cannot make.
      for (const row of solved) {
        const per = row.gap > 0 ? 1 / row.gap : -1 / row.gap;   // one level, in factor units
        const u40 = row.delta40 * per, u25 = row.delta25 * per;
        capLawChannels++;
        if (u40 < u25 - 1.5 || u40 > u25 * (maxDensity / 0.25) + 2) capLawViolations++;
      }
      // The cap is only judged where the colour distance makes the rounding small.
      if (factor > maxDensity + 2.5 / gap) beyondCap++;

      // And the same statement with the span the scene states, wherever the two frames agree that
      // this pixel's own factor is what the estimate says it is. A surface that mixes over a
      // narrower span than the fog colour it is drawn toward reports a factor in both frames that
      // cannot be reconciled this way; those pixels are counted, not judged, here.
      if (Math.abs(factor25 - Math.min(0.25, factor)) <= 1.2 / gap) {
        checkedClamp++;
        const applied = Math.min(0.25, Math.min(maxDensity, factor));
        const loweredSolved = solved.map((row) => Math.round(off[row.channel] + row.gap * applied));
        const deviation = Math.max(...solved.map((row, at) => Math.abs(lowered[i + row.channel] - loweredSolved[at])));
        worstClamp = Math.max(worstClamp, deviation);
        if (deviation > 1) {
          mismatched++;
          if (examples.length < 5) examples.push({x, y, off, applied, factor, factor25, gap, deviation,
            solved: solved.map((row, at) => ({channel: row.channel, gap: row.gap, lowered40: mapFog[i + row.channel],
              expected25: loweredSolved[at], lowered25: lowered[i + row.channel]}))});
        }
      } else unscalable++;
    }
    return {covered, changed, worstMoved: worst, beyondCap, mismatchedClamp: mismatched, worstClampDeviation: worstClamp,
      capLawChannels, capLawViolations, checkedClamp, unscalablePixels: unscalable,
      examples, recoveredFactor: {lowest: Number.isFinite(lowest) ? lowest : null, highest, bands}};
  };

  // --- (A) probe quads, one per depth, each drawn alone against the scene's own fog state.
  if (!quads) return {samples: [], frame: compareFrame()};
  const world = scene.children.map((child) => ({child, visible: child.visible}));
  const rows = [];
  for (const row of world) row.child.visible = false;
  const sample = scene.children.find((child) => child.isMesh) || world[0].child;
  const Geometry = sample.geometry.constructor, Attribute = sample.geometry.attributes.position.constructor;
  const Vector = camera.position.constructor, Mesh = sample.constructor;
  const Basic = (() => {
    let material = null;
    scene.traverse((object) => {
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const candidate of list) if (!material && candidate && candidate.isMeshBasicMaterial) material = candidate;
    });
    return material ? material.constructor : null;
  })();
  if (!Basic) return {error: 'the scene has no basic material to build a probe from'};
  const geometry = new Geometry();
  geometry.setAttribute('position', new Attribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geometry.setAttribute('uv', new Attribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeBoundingSphere();
  const material = new Basic({color: 0xffffff, fog: true});
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  const forward = new Vector(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const half = Math.tan((camera.fov * Math.PI) / 360);
  quad.quaternion.copy(camera.quaternion);
  scene.add(quad);
  for (const depth of depths) {
    quad.position.copy(camera.position).addScaledVector(forward, depth);
    quad.scale.setScalar(depth * half * 2.4);
    quad.updateMatrixWorld(true);
    capUniform.value.x = 0;
    renderer.render(scene, camera);
    const off = pixel(readback(), centre);
    capUniform.value.x = maxDensity;
    renderer.render(scene, camera);
    const on = pixel(readback(), centre);
    const factor = Math.min(maxDensity, Math.max(0, (depth - nearMetres) / (farMetres - nearMetres)));
    const expected = off.map((value, channel) => Math.round(value + (fogSrgb[channel] - value) * factor));
    rows.push({depth, off, on, expected, factor,
      deviation: Math.max(...on.map((value, channel) => Math.abs(value - expected[channel])))});
  }
  capUniform.value.x = original;
  scene.remove(quad);
  geometry.dispose();
  material.dispose();
  for (const row of world) row.child.visible = row.visible;
  return {width, height, sharedCap: original, samples: rows, frame: compareFrame()};
};

const DEPTHS = [5, 20, 60, 99.3, 130, 228.6, 260];

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
  await page.getByRole('textbox', { name: '呼号', exact: true }).fill('MapEnv');
  await start.click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.waitForFunction(() => {
    const game = window.__BREACHLINE__?.runtime?.();
    return !!(game && game.art && game.art.sourceMap && game.art.sourceEnvironmentAudit.applied.fog);
  }, null, { timeout: 180000 });

  const audit = await page.evaluate(AUDIT);
  if (audit.error) throw Error(audit.error);
  const live = audit.audit;
  const fog = live.applied.fog;
  if (!fog) throw Error('the live scene is not drawing the map\'s fog');
  for (const [what, got, want] of [
    ['fog colour', live.sceneFog && live.sceneFog.color, '#' + staged.fog.color
      .map((c) => c.toString(16).padStart(2, '0')).join('')],
    ['fog near', live.sceneFog && live.sceneFog.near, staged.fog.nearMetres],
    ['fog far', live.sceneFog && live.sceneFog.far, staged.fog.farMetres],
    ['fog cap', fog.maxDensity, staged.fog.maxDensity],
    ['shared cap', fog.sharedMaxDensity, staged.fog.maxDensity],
    ['fog source', fog.from, 'map env_fog_controller'],
    ['light scale', live.applied.lightScale, staged.light.lightScaleHDR],
    ['sun colour', live.environment.light.sunColor.join(' '), staged.light.sunColor.join(' ')],
    ['ambient colour', live.environment.light.ambientColor.join(' '), staged.light.ambientColor.join(' ')],
    ['sun direction', live.environment.light.sunSourceDirection.join(' '), staged.light.sunSourceDirection.join(' ')],
  ]) {
    if (got !== want) throw Error(`Live ${what} is ${JSON.stringify(got)}, not the map's own ${JSON.stringify(want)}`);
  }
  if (live.sceneFog.type !== 'Fog') throw Error(`The scene fog is ${live.sceneFog.type}, not the original's linear fog`);
  if (!/min\( fogMaxDensity\.x,/.test(live.fogFragment) || /smoothstep/.test(live.fogFragment)) {
    throw Error('The installed fog ramp is not the original\'s capped linear one');
  }
  if (audit.shared.carriers < 2 || audit.shared.distinctObjects !== 1) {
    throw Error(`${audit.shared.carriers} fogged materials carry ${audit.shared.distinctObjects} cap objects, not one`);
  }
  if (audit.shared.sample.some((row) => row.cap !== staged.fog.maxDensity)) {
    throw Error(`A fogged material's cap is not the map's own: ${JSON.stringify(audit.shared.sample)}`);
  }
  if (!audit.dome) throw Error('The sky scene draws no material carrying the map\'s light scale');
  if (audit.dome.lightScale !== staged.light.lightScaleHDR) {
    throw Error(`The sky material's light scale is ${audit.dome.lightScale}, not the map's ${staged.light.lightScaleHDR}`);
  }
  if (audit.dome.second !== cloud.second.texture) {
    throw Error(`The sky material samples ${JSON.stringify(audit.dome.second)}, not the descriptor's `
      + `${JSON.stringify(cloud.second.texture)}`);
  }
  const twoTexture = audit.programs.filter((program) => program.cacheKey.includes('r2'));
  if (twoTexture.length !== 1 || !twoTexture[0].multipliesRgb || !twoTexture[0].samplesSecond
    || !twoTexture[0].declaresLightScale) {
    throw Error(`The compiled two-texture program is not the original's product: ${JSON.stringify(audit.programs)}`);
  }

  const args = { depths: DEPTHS, fogSrgb: staged.fog.color, nearMetres: staged.fog.nearMetres,
    farMetres: staged.fog.farMetres, maxDensity: staged.fog.maxDensity };
  const probe = await page.evaluate(measure, {...args, quads: true});
  if (probe.error) throw Error(probe.error);
  if (probe.sharedCap !== staged.fog.maxDensity) {
    throw Error(`The shared cap read back ${probe.sharedCap}, not the map's ${staged.fog.maxDensity}`);
  }
  for (const row of probe.samples) {
    if (row.deviation > 1) {
      throw Error(`At ${row.depth} m the frame is ${JSON.stringify(row.on)}, not the original's `
        + `${JSON.stringify(row.expected)} for its own factor ${row.factor}`);
    }
    if (Math.abs(row.factor - expectedFactor(row.depth)) > 1e-12) {
      throw Error(`The probe's own factor at ${row.depth} m disagrees with the map's formula`);
    }
  }
  const farthest = probe.samples[probe.samples.length - 1];
  if (farthest.factor !== staged.fog.maxDensity) throw Error('The far probe did not reach the map\'s cap');

  // The map's own geometry as well. A pose that only shows nearby walls cannot say anything about
  // the far end of the ramp, so the view is swept until a long sightline is in frame.
  const yaw = () => page.evaluate(() => window.__BREACHLINE__.handlingAudit().yaw);
  const turn = (movementX) => page.evaluate((dx) => document.dispatchEvent(
    new MouseEvent('mousemove', {movementX: dx, movementY: 0, bubbles: true})), movementX);
  const before = await yaw();
  await turn(400);
  await page.waitForTimeout(150);
  const scale = 400 / Math.max(1e-6, Math.abs((await yaw()) - before));
  const sweeps = [{step: 0, yaw: before, frame: probe.frame}];
  let best = probe.frame;
  for (let step = 1; step <= 8 && (best.recoveredFactor.highest ?? 0) < 0.3; step++) {
    await turn(Math.round(scale * 40));
    await page.waitForTimeout(150);
    const next = await page.evaluate(measure, {...args, quads: false});
    if (next.error) throw Error(next.error);
    sweeps.push({step, yaw: await yaw(), frame: next.frame});
    if ((next.frame.recoveredFactor.highest ?? 0) > (best.recoveredFactor.highest ?? 0)) best = next.frame;
  }
  if (best.covered < 1000) throw Error(`Too few map pixels to compare against the fog colour: ${best.covered}`);
  if (best.changed / best.covered < 0.1) {
    throw Error(`Only ${best.changed} of ${best.covered} comparable map pixels are hazed at all; `
      + `census ${JSON.stringify(audit.census)}, factors ${JSON.stringify(best.recoveredFactor)}`);
  }
  if ((best.recoveredFactor.highest ?? 0) < 0.2) {
    throw Error(`No view of the map reached past the ramp's first stretch; `
      + `factors ${JSON.stringify(best.recoveredFactor)}`);
  }
  if (best.beyondCap !== 0) throw Error(`${best.beyondCap} map pixels are hazed past the map's own cap`);
  if (best.capLawViolations !== 0) {
    throw Error(`${best.capLawViolations} of ${best.capLawChannels} map channels break the cap law `
      + `(a higher cap must haze by at least as much, and by at most 0.4/0.25 of it)`);
  }
  if (best.checkedClamp < 10000) {
    throw Error(`Only ${best.checkedClamp} map pixels could be judged against the map's own ramp; `
      + `${best.unscalablePixels} were not reconcilable`);
  }
  if (best.mismatchedClamp !== 0) {
    throw Error(`${best.mismatchedClamp} of ${best.checkedClamp} map pixels do not obey min(0.25, the map's own ramp); `
      + `worst deviation ${best.worstClampDeviation}; examples ${JSON.stringify(best.examples)}`);
  }
  await page.screenshot({ path: resolve(outputDir, 'source-environment-ingame.png') });
  const evidence = {scope: 'Live Dust2 fog and sky light scale, read from the map\'s own entities',
    staged, audit: {sceneFog: live.sceneFog, applied: fog, fragmentRamp: live.fogFragment,
      sharedCapObject: audit.shared, dome: audit.dome, twoTextureProgram: twoTexture[0],
      materialCensus: audit.census, unapplied: live.unapplied},
    probes: probe.samples, sweeps, errors};
  if (errors.length) throw Error(errors.join('\n'));
  writeFileSync(resolve(outputDir, 'source-environment-ingame.json'), JSON.stringify(evidence, null, 1) + '\n');
  console.log(JSON.stringify({status: 'passed', sceneFog: live.sceneFog, sharedCap: probe.sharedCap,
    probes: probe.samples.map((row) => ({depth: row.depth, factor: +row.factor.toFixed(4), deviation: row.deviation})),
    sweeps: sweeps.map((row) => ({step: row.step, highest: row.frame.recoveredFactor.highest,
      covered: row.frame.covered, changed: row.frame.changed})),
    best, screenshot: 'output/playwright/source-environment-ingame.png'}, null, 1));
} finally {
  await browser.close();
}
