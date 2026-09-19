#!/usr/bin/env node
// The original fades a decal out as the map's own fog thickens, and tints what is left toward the
// fog colour. `scripts/probe-source-decal-fog-fade.py` reads both out of the shipped `DecalModulate`
// program; this run proves the browser is drawing them.
//
//   * the live decal system carries the map's own fog, in the form the shipped program's constants
//     take (`c12.x` a bias, `c12.w` a scale, `c12.z` the map's cap) and the map's own colour;
//   * the sheet whose material states `$fogfadeend 0.5` draws with that fade, and the sheet whose
//     material states none draws with none - which is the shipped plain program;
//   * and a mark on a probe quad is measured in pixels: the ratio the decal applies to the surface
//     has to be the program's own arithmetic of the distance from the eye, in all three channels.
//
// The measurement is a ratio, so the surface it lands on and the fog on that surface divide out:
// `value / base` is exactly the factor the decal multiplied the framebuffer by. The eye-to-mark
// distance is the sample's own, so a run at several distances walks the ramp and then the map's cap.
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
const fadeReport = JSON.parse(readFileSync(resolve(root, 'research/source-decal-fog-fade.json'), 'utf8'));

/** The map's own fog, as the shipped program's constants: a bias, a scale and a cap. */
const fog = {
  near: staged.fog.nearMetres, far: staged.fog.farMetres, cap: staged.fog.maxDensity,
  color: staged.fog.color.map((channel) => channel / 255),
};
const span = fog.far - fog.near;
/** What the shader declares for a parameter, which is what a sheet that states none is drawn with. */
const declared = (name) => Number(fadeReport.shader.parameters.find((row) => row.name === name).default);
const amountAt = (metres) => Math.min(Math.max(metres / span - fog.near / span, 0), fog.cap);
const tintAt = (metres, sheet) => Math.pow(
  Math.min(Math.max(amountAt(metres) * (sheet ? sheet.scale : declared('$FOGSCALE')), 0), 1),
  sheet ? sheet.exponent : declared('$FOGEXPONENT')) ** 2;
const fadeAt = (metres, sheet) => sheet === null ? 0
  : Math.min(Math.max((amountAt(metres) - sheet.fadeStart) / (sheet.fadeEnd - sheet.fadeStart), 0), 1);
/** The factor the program writes into the blend, per channel: `2 * mix(mix(texel, 0.5, fade), fog, tint)`. */
const predict = (metres, sheet, texel) => {
  const fade = fadeAt(metres, sheet);
  const tint = tintAt(metres, sheet ?? { scale: 1, exponent: 0.4 });
  return [0, 1, 2].map((channel) => {
    const faded = texel[channel] + (0.5 - texel[channel]) * fade;
    const shaded = faded + (fog.color[channel] - faded) * tint;
    // The fragment colour is clamped to the framebuffer's range before the blend, so a decal that
    // would brighten past white leaves the surface alone rather than doubling it.
    return Math.min(1, 2 * shaded);
  });
};
/** What a decoded sheet would give: the same arithmetic with the texel pulled to linear. */
const decoded = (value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

const AUDIT = `(() => {
  const art = window.__BREACHLINE__.runtime().art;
  const audit = art.sourceImpactAudit();
  return audit && audit.fogFade ? {fogFade: audit.fogFade, drawn: audit.drawn, live: audit.live,
    lastDecal: audit.lastDecal} : {error: 'the original decal system is not loaded'};
})()`;

/**
 * The pixel measurement.
 *
 * A probe quad is parked in clear air at a known distance from a probe camera, and a real mark is
 * drawn on it by the live decal system - the same call a shot makes, with the probe choosing which
 * decal of the surface's shipped group, so a run can name the sheet it is measuring. The frame is
 * then read twice: once with the mark hidden, which is the surface, and once with it drawn, which is
 * the surface times the factor the decal applied. Their ratio is the measurement, and the fog on the
 * surface divides out of it.
 */
/**
 * The pixel measurement.
 *
 * A probe quad is parked in clear air at a known distance from a probe camera, and a real mark is
 * drawn on it by the live decal system - the same call a shot makes, with the probe choosing which
 * decal of the surface's shipped group, so a run can name the sheet it is measuring. The frame is
 * then read twice: once with the mark hidden, which is the surface, and once with it drawn, which is
 * the surface times the factor the decal applied. Their ratio is the measurement, so the surface and
 * the fog on it divide out, and the eye-to-sample distance is the sample's own.
 *
 * The camera is aimed at a flat patch of the mark's own rectangle rather than at its centre, because
 * the sampled pixel has to read one texel rather than a blur of several: the patch is looked for in
 * the shipped sheet, and the world point it sits at is solved from the quad's own geometry.
 */
const measure = async (setup) => {
  const { height, distances, sheets, fov, candidates, patchHalf} = setup;
  const art = window.__BREACHLINE__.runtime().art;
  const impacts = art.sourceImpacts;
  if (!impacts) return {error: 'the original decal system is not loaded'};
  const renderer = art.renderer, scene = art.scene, camera = art.camera;
  const gl = renderer.getContext();
  const Vector = camera.position.constructor;
  const size = renderer.getDrawingBufferSize(new Vector());
  const width = size.x, height2 = size.y;
  const bytes = new Uint8Array(width * height2 * 4);
  const read = (x, y) => {
    const at = ((height2 - 1 - y) * width + x) * 4;
    return [bytes[at] / 255, bytes[at + 1] / 255, bytes[at + 2] / 255];
  };
  /** One pixel of the atlas, as a fraction of 255, in the same stored encoding the port samples. */
  const readAtlas = (image, x, y) => {
    const at = (Math.min(image.height - 1, Math.max(0, y)) * image.width +
      Math.min(image.width - 1, Math.max(0, x))) * 4;
    return [image.data[at] / 255, image.data[at + 1] / 255, image.data[at + 2] / 255];
  };

  // The probe quad, built from the classes the running scene already carries.
  let sampleMesh = null, standard = null;
  scene.traverse((object) => {
    if (!sampleMesh && object.isMesh && !object.isInstancedMesh && !object.isSkinnedMesh &&
      object.geometry && object.geometry.attributes && object.geometry.attributes.position &&
      object.geometry.attributes.position.isBufferAttribute && object.geometry.index) sampleMesh = object;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list)
      if (material && material.isMeshStandardMaterial && !standard) standard = material;
  });
  if (!sampleMesh || !standard) return {error: 'the scene has no plain mesh and lit material to build a probe from'};
  const Mesh = sampleMesh.constructor, Geometry = sampleMesh.geometry.constructor;
  const Attribute = sampleMesh.geometry.attributes.position.constructor;
  const Standard = standard.constructor;
  const quad = new Geometry();
  const half = 2;
  quad.setAttribute('position', new Attribute(new Float32Array(
    [-half, -half, 0, half, -half, 0, half, half, 0, -half, half, 0]), 3));
  quad.setAttribute('normal', new Attribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  quad.setAttribute('uv', new Attribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  quad.computeBoundingSphere();
  // Mid grey, so the decal's factor lands well inside the framebuffer's range in both directions.
  const surface = new Mesh(quad, new Standard({color: 0x808080, fog: true, roughness: 1, metalness: 0}));
  surface.frustumCulled = false;
  scene.add(surface);

  const saved = {position: camera.position.clone(), quaternion: camera.quaternion.clone(),
    fov: camera.fov, background: scene.background, clear: new Vector()};
  renderer.getClearColor(saved.clear);
  const savedClearAlpha = renderer.getClearAlpha();
  // The eye stays where the game put it, well above the map, so every distance has clear air.
  const eye = camera.position.clone().add(new Vector(0, height, 0));
  const forward = new Vector(0, 0, -1).applyQuaternion(camera.quaternion).setY(0).normalize();
  scene.background = null;
  renderer.setClearColor(0x000000, 1);
  camera.fov = fov;

  /** Where the wireframe the quad is drawn with sits, and where the camera looks for a sample.
   * The field of view is set per distance so a mark covers a third of the frame wherever it is,
   * which is what keeps the sampled pixel inside one texel of the sheet. */
  const place = (mark, look, degrees) => {
    surface.position.copy(eye).addScaledVector(forward, mark.distance);
    surface.quaternion.setFromUnitVectors(new Vector(0, 0, 1), forward.clone().negate());
    camera.position.copy(eye);
    camera.fov = Math.min(60, Math.max(0.05, degrees ?? fov));
    camera.lookAt(look ?? surface.position);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  };
  const shoot = () => {
    renderer.render(scene, camera);
    gl.readPixels(0, 0, width, height2, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  };
  /** The world point a mesh's own uv sits at, solved from the geometry it is drawn with. */
  const worldAtUv = (mesh, u, v) => {
    const geometry = mesh.geometry;
    const uv = geometry.attributes.uv, position = geometry.attributes.position;
    const index = geometry.index;
    const count = index ? index.count : position.count;
    const corner = (at) => ({u: uv.getX(at), v: uv.getY(at),
      p: new Vector(position.getX(at), position.getY(at), position.getZ(at))});
    for (let triangle = 0; triangle + 2 < count; triangle += 3) {
      const a = corner(index ? index.getX(triangle) : triangle);
      const b = corner(index ? index.getX(triangle + 1) : triangle + 1);
      const c = corner(index ? index.getX(triangle + 2) : triangle + 2);
      const denominator = (b.v - c.v) * (a.u - c.u) + (c.u - b.u) * (a.v - c.v);
      if (Math.abs(denominator) < 1e-12) continue;
      const wa = ((b.v - c.v) * (u - c.u) + (c.u - b.u) * (v - c.v)) / denominator;
      const wb = ((c.v - a.v) * (u - c.u) + (a.u - c.u) * (v - c.v)) / denominator;
      const wc = 1 - wa - wb;
      if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
      return mesh.localToWorld(a.p.clone().multiplyScalar(wa)
        .addScaledVector(b.p, wb).addScaledVector(c.p, wc));
    }
    return null;
  };

  const images = new Map();
  for (const sheet of sheets) {
    if (images.has(sheet.atlas)) continue;
    const url = new URL(impacts.table.atlases[sheet.atlas].url,
      new URL(impacts.table.atlasBaseUrl, location.href).href).href;
    const bitmap = await createImageBitmap(new Blob([await (await fetch(url)).arrayBuffer()],
      {type: 'image/png'}));
    const plate = document.createElement('canvas');
    plate.width = bitmap.width; plate.height = bitmap.height;
    const flat = plate.getContext('2d');
    flat.drawImage(bitmap, 0, 0);
    images.set(sheet.atlas, flat.getImageData(0, 0, bitmap.width, bitmap.height));
    bitmap.close();
  }
  /**
   * The patch inside a mark's rect to sample: the darkest one whose neighbourhood is flat to within
   * a step, so the sampled pixel reads one texel and the factor it measures is a factor the fog can
   * move. A patch near the sheet's own neutral value barely moves at all - the fade lifts a texel
   * toward that neutral and the tint toward the fog colour - so the darkest patch is the one that
   * carries the signal.
   */
  const bestPatch = (atlas, rect) => {
    const image = images.get(atlas);
    const [u0, v0, rectWidth, rectHeight] = rect;
    let best = null;
    for (let y = Math.round(v0) + patchHalf; y + patchHalf < Math.round(v0 + rectHeight); y += 2) {
      for (let x = Math.round(u0) + patchHalf; x + patchHalf < Math.round(u0 + rectWidth); x += 2) {
        const texel = readAtlas(image, x, y);
        let worst = 0;
        for (let dy = -patchHalf; dy <= patchHalf; dy++) {
          for (let dx = -patchHalf; dx <= patchHalf; dx++) {
            const neighbour = readAtlas(image, x + dx, y + dy);
            worst = Math.max(worst,
              ...neighbour.map((value, channel) => Math.abs(value - texel[channel])));
          }
        }
        if (worst > 3 / 255) continue;
        const luminance = (texel[0] + texel[1] + texel[2]) / 3;
        const candidate = {x, y, texel, worst, reach: 0.5 - luminance};
        if (!best || candidate.reach > best.reach) best = candidate;
      }
    }
    return best;
  };

  // One mark per distance and sheet, added up front so every frame draws the same scene and only
  // the measured mark's visibility changes. The mark's normal is the quad's own, so the decal faces
  // the camera that measures it.
  const added = [];
  const rows = [];
  const tried = [];
  for (const sheet of sheets) {
    for (const distance of distances) {
      const mark = {distance, sheet, normal: forward.clone().negate(),
        centre: eye.clone().addScaledVector(forward, distance)};
      place(mark);
      const known = new Set(impacts.group.children);
      let chosen = null;
      search: for (const surface of sheet.surfaces) {
        for (const draw of candidates) {
          const attempt = impacts.add({x: mark.centre.x, y: mark.centre.y, z: mark.centre.z,
            nx: mark.normal.x, ny: mark.normal.y, nz: mark.normal.z, surface,
            draw, scaleDraw: 0.5, roll: 0});
          const created = impacts.group.children.find((child) => !known.has(child)) ?? null;
          if (created) {
            added.push(created);
            known.add(created);
          }
          if (attempt.drawn && attempt.atlas === sheet.atlas && created) {
            const image = images.get(sheet.atlas);
            const face = bestPatch(sheet.atlas, attempt.atlasRect);
            tried.push({surface, draw, material: attempt.material, rect: attempt.atlasRect,
              image: [image.width, image.height], best: face ? face.worst : null});
            if (face) {
              // The sheet's own convention, as the port maps it: u across, v down from the first row.
              const u = face.x / image.width, v = face.y / image.height;
              const world = worldAtUv(created, u, v);
              const centre = worldAtUv(created,
                (attempt.atlasRect[0] + attempt.atlasRect[2] / 2) / image.width,
                (attempt.atlasRect[1] + attempt.atlasRect[3] / 2) / image.height);
              if (world && centre && centre.distanceTo(created.position) < 1e-6) {
                // The darkest patch across the whole group, not of the first decal that lands on the
                // sheet: a soft dust decal and a bullet hole carry very different signals.
                if (!chosen || face.reach > chosen.face.reach) {
                  chosen = {face, world, attempt, mesh: created, surface};
                }
                // A patch this far from the sheet's neutral value carries the signal on its own.
                if (chosen.face.reach > 0.35) break search;
              } else if (tried.length <= 6) {
                // The uv solve has to land on the mesh's own centre: if it does not, the quad's
                // corners are not paired with its rectangle the way the sheet is laid out.
                tried.push({solve: {surface, material: attempt.material, rect: attempt.atlasRect,
                  hasWorld: !!world, hasCentre: !!centre,
                  centreOffMesh: centre ? +centre.distanceTo(created.position).toFixed(6) : null}});
              }
            }
          }
          // Every mark the search draws is parked out of the way; the measurement loop shows only
          // the one it is measuring.
          if (created) created.visible = false;
        }
      }
      if (!chosen) return {error: `no ${sheet.atlas} decal with a flat patch on `
        + `${sheet.surfaces.join('/')}`, tried};
      rows.push({...mark, ...chosen});
    }
  }

  const results = [];
  for (const row of rows) {
    for (const other of added) other.visible = false;
    // A third of the frame, so the sampled pixel is well inside one texel however far the mark is.
    const degrees = 3 * Math.atan(row.attempt.sizeMetres / row.distance) * 180 / Math.PI;
    place(row, row.world, degrees);
    shoot();
    const centre = [Math.round(width / 2), Math.round(height2 / 2)];
    const before = [];
    for (let dy = -patchHalf; dy <= patchHalf; dy++) for (let dx = -patchHalf; dx <= patchHalf; dx++)
      before.push(read(centre[0] + dx, centre[1] + dy));
    const uniform = before.every((value) => Math.abs(value[0] - before[0][0]) <= 1 / 255 &&
      Math.abs(value[1] - before[0][1]) <= 1 / 255 && Math.abs(value[2] - before[0][2]) <= 1 / 255);
    row.mesh.visible = true;
    shoot();
    const after = read(centre[0], centre[1]);
    const countChanged = () => {
      let changed = 0;
      for (let y = centre[1] - 60; y <= centre[1] + 60; y++) {
        for (let x = centre[0] - 60; x <= centre[0] + 60; x++) {
          const value = read(x, y);
          if (Math.abs(value[0] - before[0][0]) > 2 / 255 || Math.abs(value[1] - before[0][1]) > 2 / 255 ||
            Math.abs(value[2] - before[0][2]) > 2 / 255) changed++;
        }
      }
      return changed;
    };
    // How much of the frame the mark covers, so the sampled pixel is known to be inside it.
    const changed = countChanged();
    // Where the fog has faded the mark out entirely the frame should not move at all - so the run
    // takes the fade off the live material and reads the frame again, which is what shows the mark
    // is still there and it is the fade that is hiding it, rather than the mark not being drawn.
    const material = Array.isArray(row.mesh.material) ? row.mesh.material[0] : row.mesh.material;
    let changedWithoutFade = changed;
    if (changed < 40) {
      const fade = material.uniforms.fade.value;
      const savedFade = fade.toArray();
      fade.set(0, 0, material.uniforms.fade.value.z, material.uniforms.fade.value.w);
      shoot();
      changedWithoutFade = countChanged();
      fade.set(...savedFade);
      shoot();
    }
    results.push({distance: row.distance, sampleDistance: row.world.distanceTo(eye),
      sheet: row.sheet.name, atlas: row.attempt.atlas, material: row.attempt.material,
      rect: row.attempt.atlasRect, patch: [row.face.x, row.face.y], texel: row.face.texel,
      texelFlatness: row.face.worst, surfaceUniform: uniform, surface: before[0], value: after,
      changed, changedWithoutFade,
      // What the live material's own uniforms were told, so the numbers are read off the object
      // that drew the mark rather than off the table.
      uniforms: {fade: material.uniforms.fade.value.toArray(),
        fogRamp: material.uniforms.fogRamp.value.toArray(),
        fogColor: material.uniforms.fogColor.value.toArray()}});
    row.mesh.visible = false;
  }

  for (const mesh of added) impacts.group.remove(mesh);
  scene.remove(surface);
  quad.dispose();
  surface.material.dispose();
  camera.position.copy(saved.position);
  camera.quaternion.copy(saved.quaternion);
  camera.fov = saved.fov;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  scene.background = saved.background;
  renderer.setClearColor(saved.clear, savedClearAlpha);
  return {eye: eye.toArray(), results};
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
  await page.getByRole('textbox', { name: '呼号', exact: true }).fill('DecalFade');
  await start.click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.waitForFunction(() => {
    const audit = window.__BREACHLINE__?.runtime?.()?.art?.sourceImpactAudit?.();
    return !!(audit && audit.fogFade && audit.fogFade.applied);
  }, null, { timeout: 180000 });
  await page.waitForTimeout(400);

  const audit = await page.evaluate(AUDIT);
  if (audit.error) throw Error(audit.error);
  const live = audit.fogFade;
  const close = (a, b, tolerance) => a.length === b.length &&
    a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
  if (!live.applied) throw Error('the decal system was never told what fog to fade in');
  if (live.nearMetres !== fog.near || live.farMetres !== fog.far || live.maxDensity !== fog.cap) {
    throw Error(`the decals fade in ${live.nearMetres}/${live.farMetres}/${live.maxDensity}, `
      + `not the map's ${fog.near}/${fog.far}/${fog.cap}`);
  }
  const expectedRamp = [-fog.near / span, 0, fog.cap, 1 / span];
  if (!close(live.ramp, expectedRamp, 1e-9)) {
    throw Error(`the ramp uniform is ${JSON.stringify(live.ramp)}, not ${JSON.stringify(expectedRamp)}`);
  }
  if (!close(live.uniformColor, fog.color, 1e-4)) {
    throw Error(`the decal fog colour is ${JSON.stringify(live.uniformColor)}, not the map's ${JSON.stringify(fog.color)}`);
  }
  if (live.neutral !== 0.5) throw Error(`the neutral texel is ${live.neutral}, not 0.5`);
  const requested = live.requested;
  const sheet = requested['decals/decals_bulletsheet'];
  if (!sheet || sheet.fadeStart !== 0 || sheet.fadeEnd !== 0.5 || sheet.scale !== 1 || sheet.exponent !== 0.4) {
    throw Error(`the bullet sheet asks for ${JSON.stringify(sheet)}`);
  }
  if (requested['decals/decals_mod2x'] !== null && requested['decals/decals_mod2x'] !== undefined) {
    throw Error(`the sheet with no fade asks for ${JSON.stringify(requested['decals/decals_mod2x'])}`);
  }
  if (!live.limitations.length) throw Error('the decal fade states no limitations');
  // The staged table and the probe's report agree about which sheet asks for what.
  const reportSheet = fadeReport.reachableAtlases['decals/decals_bulletsheet'].stated;
  if (reportSheet.fogfadeend !== sheet.fadeEnd) {
    throw Error(`the report says the sheet ends its fade at ${reportSheet.fogfadeend}`);
  }

  const distances = [20, 30, 45, 60, 90, 225];
  // The two sheets this map's impacts reach: the bullet sheet, whose own material asks for the
  // fade, and the sheet behind the computer/glass decals, whose material asks for none.
  const measured = await page.evaluate(measure, {height: 60, distances, fov: 3, patchHalf: 1,
    candidates: [0, 0.25, 0.5, 0.75, 1],
    sheets: [{name: 'fadeSheet', atlas: 'decals/decals_bulletsheet',
      surfaces: ['dirt', 'gravel', 'carpet', 'concrete'],
      ...requested['decals/decals_bulletsheet']},
    {name: 'plainSheet', atlas: 'decals/decals_mod2x', surfaces: ['plastic', 'glass']}]});
  if (measured.error) throw Error(measured.error + ' :: ' + JSON.stringify(measured.tried ?? null));
  if (measured.results.length !== distances.length * 2) {
    throw Error(`expected ${distances.length * 2} measurements, read ${measured.results.length}`);
  }

  const evidence = [];
  for (const row of measured.results) {
    if (row.texelFlatness > 3 / 255) {
      throw Error(`${row.atlas} rect ${JSON.stringify(row.rect)} is not flat anywhere: `
        + `${row.texelFlatness.toFixed(4)} of a step`);
    }
    if (!row.surfaceUniform) throw Error(`the probe quad is not uniform at ${row.distance} m`);
    const factor = row.value.map((value, channel) => value / row.surface[channel]);
    if (!row.surface.every((value) => value > 0.1 && value < 0.95))
      throw Error(`the probe quad reads ${JSON.stringify(row.surface)} at ${row.distance} m`);
    // Where the fog has faded the mark out completely the frame should not move at all, and the run
    // says so by taking the fade off the live material: the mark is then still on screen.
    if (row.changed < 40 && row.changedWithoutFade < 40) {
      throw Error(`the mark is not on screen at ${row.distance} m: ${row.changed} pixels changed with `
        + `the fade and ${row.changedWithoutFade} without it`);
    }
    // The mark's own material has to carry the numbers its sheet asked for.
    const wanted = row.sheet === 'fadeSheet'
      ? [sheet.fadeStart, sheet.fadeEnd, sheet.scale, sheet.exponent]
      : [0, 0, declared('$FOGSCALE'), declared('$FOGEXPONENT')];
    if (!row.uniforms.fade.every((value, index) => Math.abs(value - wanted[index]) <= 1e-9)) {
      throw Error(`${row.sheet} draws with ${JSON.stringify(row.uniforms.fade)}, not ${JSON.stringify(wanted)}`);
    }
    if (!close(row.uniforms.fogRamp, expectedRamp, 1e-9)) throw Error('a decal material missed the ramp');
    const sheetFade = row.sheet === 'fadeSheet' ? requested['decals/decals_bulletsheet'] : null;
    const predicted = predict(row.sampleDistance, sheetFade, row.texel);
    const asDecoded = predict(row.sampleDistance, sheetFade, row.texel.map(decoded));
    const error = Math.max(...factor.map((value, channel) => Math.abs(value - predicted[channel])));
    const decodedError = Math.max(...asDecoded.map((value, channel) => Math.abs(value - predicted[channel])));
    const decodedAgainstPixels = Math.max(...asDecoded.map((value, channel) => Math.abs(value - factor[channel])));
    if (error > 0.05) {
      throw Error(`at ${row.distance} m the ${row.sheet} applied ${JSON.stringify(factor.map((v) => +v.toFixed(4)))}, `
        + `where the shipped program's own arithmetic of ${row.sampleDistance.toFixed(3)} m gives `
        + `${JSON.stringify(predicted.map((v) => +v.toFixed(4)))} (texel ${JSON.stringify(row.texel)}, `
        + `fade ${fadeAt(row.sampleDistance, sheetFade).toFixed(4)}, tint ${tintAt(row.sampleDistance, sheetFade).toFixed(4)})`);
    }
    evidence.push({distance: row.distance, sampleDistance: row.sampleDistance, sheet: row.sheet,
      atlas: row.atlas, material: row.material, rect: row.rect, patch: row.patch, texel: row.texel,
      texelFlatness: row.texelFlatness, surface: row.surface, value: row.value, factor, predicted,
      asDecoded: asDecoded, pixelError: +error.toFixed(4),
      changedPixels: row.changed, changedPixelsWithoutFade: row.changedWithoutFade,
      decodedHypothesisGap: +decodedError.toFixed(4),
      decodedHypothesisPixelError: +decodedAgainstPixels.toFixed(4),
      fogAmount: +amountAt(row.sampleDistance).toFixed(4),
      fade: +fadeAt(row.sampleDistance, sheetFade).toFixed(4),
      tint: +tintAt(row.sampleDistance, sheetFade).toFixed(4),
      uniforms: row.uniforms});
  }

  // The two sheets have to differ where the fog is thick enough to fade one of them.
  const far = evidence.filter((row) => row.distance >= 120);
  const fadeFar = far.filter((row) => row.sheet === 'fadeSheet').map((row) => row.factor[0]);
  const plainFar = far.filter((row) => row.sheet === 'plainSheet').map((row) => row.factor[0]);
  if (!fadeFar.every((value) => value > plainFar[0] + 0.15)) {
    throw Error(`the fading sheet is not measurably lighter than the plain one in thick fog: `
      + `${JSON.stringify(fadeFar)} against ${JSON.stringify(plainFar)}`);
  }
  // And the map's cap has to hold: past `fogend` the fog amount stops rising, so the factor does too.
  const beyond = evidence.filter((row) => row.distance >= 120 && row.sheet === 'fadeSheet');
  if (Math.max(...beyond.map((row) => row.fogAmount)) !== Math.min(...beyond.map((row) => row.fogAmount))) {
    throw Error('the fog amount is still rising past the map\'s own cap');
  }

  await page.screenshot({ path: resolve(outputDir, 'source-decal-fog-fade-ingame.png') });
  const document = {scope: 'Live original decals: the shipped fog fade and tint, measured in pixels',
    staged: {fog: staged.fog, fade: {sheet, neutral: live.neutral, limitations: live.limitations},
      program: fadeReport.container.programs['0x2/0']},
    audit: {fogFade: live, drawn: audit.drawn, live: audit.live}, measurements: evidence, errors};
  if (errors.length) throw Error(errors.join('\n'));
  writeFileSync(resolve(outputDir, 'source-decal-fog-fade-ingame.json'), JSON.stringify(document, null, 1) + '\n');
  console.log(JSON.stringify({status: 'passed',
    audit: {ramp: live.ramp, colour: live.uniformColor, requested},
    measurements: evidence.map((row) => ({distance: row.distance, sheet: row.sheet,
      factor: row.factor.map((value) => +value.toFixed(4)),
      predicted: row.predicted.map((value) => +value.toFixed(4)),
      error: row.pixelError, asDecoded: row.decodedHypothesisPixelError, fade: row.fade, tint: row.tint})),
    screenshots: {ingame: 'output/playwright/source-decal-fog-fade-ingame.png'}}, null, 1));
} finally {
  await browser.close();
}
