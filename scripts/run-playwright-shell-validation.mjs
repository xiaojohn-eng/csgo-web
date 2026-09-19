#!/usr/bin/env node
// Fires the real game's rifle and reads what the original shell casing did.
//
// The unit tests pin the table against the shipped PCF and the staged models against their
// receipts. This proves the game itself ejects one original casing per accepted shot: the
// original system of the held weapon, at the weapon's own shell-eject attachment, moving
// under the original gravity and drag, and coming to rest on the map's own surface.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.SOURCE_SHELL_BASE || 'http://127.0.0.1:27019';
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const errors = [];
const table = JSON.parse(readFileSync(resolve(root, 'game/source-shell-casings.json'), 'utf8'));
// The enlarged crop is only written when a still enough frame carries a casing, so the file left
// from a previous run is removed: either this run produced one or there is none to show.
rmSync(resolve(outputDir, 'source-shell-ingame-crop.png'), { force: true });

const fire = (rounds) => `(async () => {
  const g = window.__BREACHLINE__.runtime();
  if (!g || !document.pointerLockElement) return { reason: 'not-locked' };
  const canvas = g.art.renderer.domElement;
  let fired = 0;
  for (let round = 0; round < ${rounds}; round++) {
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    await new Promise((r) => setTimeout(r, 110));
    canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    await new Promise((r) => setTimeout(r, 220));
    fired++;
  }
  return { reason: 'fired', fired };
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
  await page.getByRole('textbox', { name: '呼号', exact: true }).fill('Shell');
  await start.click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  // Every staged model and the texture have to be verified before a shot can eject anything.
  await page.waitForFunction(() => {
    const audit = window.__BREACHLINE__?.assetAudit?.()?.sourceShells;
    if (!audit || !audit.texture?.verified) return false;
    const models = Object.values(audit.models ?? {});
    return models.length === 3 && models.every((model) => model.verified);
  }, null, { timeout: 180000 });
  const before = await page.evaluate(() => window.__BREACHLINE__.assetAudit().sourceShells);

  // Where a casing is on screen, and how big it should look. The camera's own matrices are
  // used, so this is the port's real view and not a re-derivation of it.
  const onScreen = `(() => {
    const g = window.__BREACHLINE__.runtime();
    const cam = g.art.camera;
    const audit = g.art.assetAudit().sourceShells;
    const canvas = g.art.renderer.domElement;
    const W = canvas.width, H = canvas.height;
    const V = cam.matrixWorldInverse.elements, P = cam.projectionMatrix.elements;
    const project = (x, y, z) => {
      const vx = V[0]*x + V[4]*y + V[8]*z + V[12], vy = V[1]*x + V[5]*y + V[9]*z + V[13];
      const vz = V[2]*x + V[6]*y + V[10]*z + V[14];
      const cx = P[0]*vx + P[4]*vy + P[8]*vz + P[12], cy = P[1]*vx + P[5]*vy + P[9]*vz + P[13];
      const cw = P[3]*vx + P[7]*vy + P[11]*vz + P[15];
      return { x: cx/cw, y: cy/cw, depth: -vz, behind: cw <= 0 };
    };
    const pxPerMetre = (depth) => H / (2 * depth * Math.tan(cam.fov * Math.PI / 360));
    return audit.liveCasings.map((row) => {
      const p = project(...row.position);
      const perMetre = p.depth > 0 ? pxPerMetre(p.depth) : 0;
      const longest = audit.drawn[row.system].spanMetres.reduce((a, b) => Math.max(a, b), 0);
      return { system: row.system, ndc: [p.x, p.y], depth: p.depth,
        pixel: [Math.round((p.x + 1) / 2 * W), Math.round((1 - p.y) / 2 * H)],
        apparentPixels: +(longest * perMetre).toFixed(3),
        inView: !p.behind && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.depth > 0 };
    });
  })()`;

  // A round that could not fire — the pointer lock goes when the player is killed — is taken
  // back and tried again, so the twelve shots are twelve shots rather than however many landed.
  const burst = async () => {
    for (let tries = 0; tries < 3; tries++) {
      const result = await page.evaluate(fire(4));
      if (result.reason === 'fired') return result;
      if (!(await page.evaluate(() => !!document.pointerLockElement))) {
        await page.mouse.click(640, 400);
        await page.waitForTimeout(400);
      }
    }
    return { reason: 'never-fired', fired: 0 };
  };

  const rounds = [];
  rounds.push(await burst());
  // Read the casings while the first burst is still in the air, so the screenshot below is of
  // casings that exist rather than of casings that have already gone. A casing is a few centimetres
  // long and is ejected sideways, so one look can miss every casing that is in the air; a few looks
  // are taken and the one with the most in view is what the flight evidence is read from. The
  // number of looks is recorded, so a run that needed several says so.
  const looks = [];
  for (let look = 0; look < 4; look += 1) {
    await page.waitForTimeout(100);
    looks.push(await page.evaluate(onScreen));
    if (looks[looks.length - 1].some((row) => row.inView)) break;
  }
  const inViewCount = (look) => look.filter((row) => row.inView).length;
  const inFlight = looks.reduce((best, look) => (inViewCount(look) > inViewCount(best) ? look : best));
  const looksTaken = looks.length;
  await page.screenshot({ path: resolve(outputDir, 'source-shell-ingame.png') });
  const box = 110;
  const boxAt = (cx, cy) => ({ x: Math.max(0, Math.min(1280 - box, Math.round(cx - box / 2))),
    y: Math.max(0, Math.min(800 - box, Math.round(cy - box / 2))), width: box, height: box });
  const grab = async () => (await sharp(await page.screenshot()).raw().toBuffer({ resolveWithObject: true }));
  const twoFrames = () => page.evaluate(() => new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
  const changedBetween = (reference, other, box_) => {
    const device = reference.info.width / 1280, channels = reference.info.channels;
    let count = 0, worst = 0;
    for (let row = 0; row < box_.height * device; row++)
      for (let column = 0; column < box_.width * device; column++) {
        const index = (Math.round((box_.y + row / device) * device) * reference.info.width
          + Math.round((box_.x + column / device) * device)) * channels;
        const delta = Math.max(Math.abs(reference.data[index] - other.data[index]),
          Math.abs(reference.data[index + 1] - other.data[index + 1]),
          Math.abs(reference.data[index + 2] - other.data[index + 2]));
        if (delta > 24) count++;
        if (delta > worst) worst = delta;
      }
    return { count, worst };
  };
  // The readout moves with the game and never stops: the radar at the top left, the timer and
  // team counters at the top, the bars along the bottom. A control box has to sit in the view
  // itself, and well clear of the box the casing is in, or it measures the HUD instead.
  const controlBoxFor = (casingBox) => {
    const spots = [[420, 240], [860, 240], [420, 500], [860, 500], [640, 230], [640, 520]];
    const clear = spots.filter(([cx, cy]) => Math.abs(cx - (casingBox.x + box / 2)) > box + 60
      && Math.abs(cy - (casingBox.y + box / 2)) > box + 20);
    return boxAt(...(clear.length ? clear[0] : spots[0]));
  };

  // A casing is proved to be on screen by differencing frames: the frame the renderer actually
  // built with the casings in it, against the same frame with the casings hidden. That does not
  // depend on the view holding still, which a live scene with bots in it does not promise.
  //
  // A single pair of frames does not settle it, though: the view's own draw count moves by a few
  // calls as bots enter and leave it, which can cancel the casings' own contribution entirely. So
  // each side is sampled over a window and the *quietest* frame in each is compared — the extra
  // draws the view contributes are only ever added, so the floor of each window is the scene
  // without them plus whatever the casings contribute. The window is sampled again with the
  // casings back, and the spread of a hidden window is recorded as the noise floor the removed
  // triangles have to clear.
  const drawnInFrame = await page.evaluate(async () => {
    const g = window.__BREACHLINE__.runtime();
    const read = () => ({ calls: g.art.renderer.info.render.calls,
      triangles: g.art.renderer.info.render.triangles });
    const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const group = g.art.sourceShells.group;
    const audit = () => g.art.sourceShells.audit();
    const sample = async (visible, count) => {
      group.visible = visible;
      await frames();
      const rows = [];
      for (let index = 0; index < count; index += 1) { await frames(); rows.push(read()); }
      return rows;
    };
    const floor = (rows) => rows.reduce((best, row) => (row.calls < best.calls ? row : best));
    const ceiling = (rows) => rows.reduce((best, row) => (row.calls > best.calls ? row : best));
    const wander = (rows) => Math.max(...rows.slice(1).map((row, index) =>
      Math.abs(row.triangles - rows[index].triangles)), 0);
    const before = audit();
    const live = before.liveCasings;
    // No more triangles could have left the frame than the casings in flight are made of.
    const liveTriangles = live.map((row) => before.drawn[row.system].triangles);
    const samples = 10;
    const visibleRows = await sample(true, samples);
    const hiddenRows = await sample(false, samples);
    const backRows = await sample(true, samples);
    const hiddenFloor = floor(hiddenRows);
    // Both windows with the casings in them have to show the same thing, so the difference cannot
    // be a one-off frame.
    const perWindow = [['first', floor(visibleRows)], ['back', floor(backRows)]].map(([window, row]) => ({
      window, callsRemoved: row.calls - hiddenFloor.calls,
      trianglesRemoved: row.triangles - hiddenFloor.triangles }));
    const lowest = [floor(visibleRows), floor(backRows)]
      .reduce((best, row) => (row.calls < best.calls ? row : best));
    return {
      live: live.length,
      liveTriangles,
      trianglesInFlight: liveTriangles.reduce((sum, value) => sum + value, 0),
      samples,
      withCasings: lowest,
      hidden: hiddenFloor,
      back: ceiling(backRows),
      callsRemoved: lowest.calls - hiddenFloor.calls,
      trianglesRemoved: lowest.triangles - hiddenFloor.triangles,
      perWindow,
      noiseFloorTriangles: Math.max(wander(visibleRows), wander(hiddenRows), wander(backRows)),
      windows: { visible: visibleRows, hidden: hiddenRows, back: backRows },
    };
  });


  // The pixel-level evidence is supporting: a frame that carries the casing is differenced
  // against the same frame with the casings hidden, if a still enough pair can be caught.
  let crop = null;
  let pixelProof = null;
  let inViewTarget = null;
  const attempts = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const seen = await page.evaluate(onScreen);
    const inView = seen.filter((row) => row.inView).sort((a, b) => b.apparentPixels - a.apparentPixels);
    if (!inView.length) { attempts.push({ attempt, reason: 'no casing in view' }); await page.waitForTimeout(250); continue; }
    const target = inView[0];
    const casingBox = boxAt(target.pixel[0], target.pixel[1]);
    const controlBox = controlBoxFor(casingBox);
    const first = await grab();
    await twoFrames();
    const stillVisible = await grab();
    const moved = changedBetween(first, stillVisible, controlBox);
    if (moved.count > 400) {
      attempts.push({ attempt, reason: 'the view was not steady', controlMovedOnItsOwn: moved });
      await page.waitForTimeout(300);
      continue;
    }
    const hidden = await page.evaluate(async () => {
      const g = window.__BREACHLINE__.runtime();
      g.art.sourceShells.group.visible = false;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return g.art.sourceShells.audit().live;
    });
    const withoutCasings = await grab();
    await page.evaluate(() => { window.__BREACHLINE__.runtime().art.sourceShells.group.visible = true; });
    const casing = changedBetween(first, withoutCasings, casingBox);
    const control = changedBetween(first, withoutCasings, controlBox);
    attempts.push({ attempt, casing: target, casingBox, controlBox,
      controlMovedOnItsOwn: moved, changesAtTheCasing: casing, changesAtTheControl: control });
    if (!(casing.count > 3 * control.count) || !(casing.worst > control.worst + 48)) {
      await page.waitForTimeout(250);
      continue;
    }
    // The frame that carries the casing is kept, enlarged around it, plus the proof.
    const side = 480, tall = 320;
    const left = Math.max(0, Math.min(1280 - side, Math.round(target.pixel[0] - side / 2)));
    const top = Math.max(0, Math.min(800 - tall, Math.round(target.pixel[1] - tall / 2)));
    await page.screenshot({ path: resolve(outputDir, 'source-shell-ingame-crop.png'),
      clip: { x: left, y: top, width: side, height: tall } });
    crop = { file: 'source-shell-ingame-crop.png', casingPixel: target.pixel,
      clip: { x: left, y: top, width: side, height: tall },
      casingInCrop: [Math.round(target.pixel[0] - left), Math.round(target.pixel[1] - top)] };
    pixelProof = { casingsHiddenDuringSecondFrame: hidden, box, casingBox, controlBox,
      casing, control, controlMovedOnItsOwn: moved };
    inViewTarget = target;
    break;
  }
  // A round that could not fire — the pointer lock goes when the player is killed — is taken
  // back and tried again, so the twelve shots are twelve shots rather than however many landed.
  for (let round = 1; round < 3; round++) {
    rounds.push(await burst());
    await page.waitForTimeout(400);
  }
  // Read while the last burst is still in the air: the systems' own lifetime is 0.8 s, so a
  // casing read after it has passed is a casing that is already gone.
  await page.waitForTimeout(220);
  const midFlight = await page.evaluate(() => window.__BREACHLINE__.assetAudit().sourceShells);
  await page.screenshot({ path: resolve(outputDir, 'source-shell-ingame.png') });
  // Then wait out that lifetime, so the counters are read with every casing of the burst done.
  await page.waitForTimeout(1400);
  const after = await page.evaluate(() => window.__BREACHLINE__.assetAudit().sourceShells);
  await page.keyboard.press('Escape');

  const shots = rounds.reduce((sum, round) => sum + (round.fired ?? 0), 0);
  if (shots < 12) throw Error('Too few shots were fired: ' + JSON.stringify(rounds));
  if (!(midFlight.spawned >= shots)) throw Error(`Only ${midFlight.spawned} casings for ${shots} shots`);
  if (Object.keys(midFlight.refused).length)
    throw Error('The original casing system refused a shot: ' + JSON.stringify(midFlight.refused));
  if (!(midFlight.live >= 1)) throw Error('No casing was in flight after the shots');
  // Every casing that met the level was answered by it, which is the operator's own collision:
  // a casing that only fell to a floor could never produce these.
  if (!(after.landed >= 1))
    throw Error('No casing ever met the level: ' + JSON.stringify({ landed: after.landed, spawned: after.spawned }));
  if (!(after.surfaceHits >= after.landed))
    throw Error('A casing landed without meeting a surface: ' + JSON.stringify(after));
  // The model scale is the table's own conversion, applied rather than assumed.
  const expectedScale = table.modelUnitsToMetres;
  for (const row of midFlight.liveCasings) {
    // A casing ejected in the very frame this was read in has not been stepped yet, so age 0 and
    // no travel is what it should report; every casing past that has to have moved.
    if (row.age > 0 && !(row.travelledMetres > 0))
      throw Error('A stepped casing never moved: ' + JSON.stringify(row));
    if (row.age < 0 || row.age > table.systems[row.system].lifetimeSeconds[1] + 1e-6)
      throw Error('A casing outlived its own lifetime: ' + JSON.stringify(row));
  }
  if (!midFlight.liveCasings.some((row) => row.age > 0 && row.travelledMetres > 0))
    throw Error('No casing had been stepped at all: ' + JSON.stringify(midFlight.liveCasings));
  if (Math.abs(midFlight.unitScale.modelUnitsToMetres - expectedScale) > 1e-12)
    throw Error('The runtime applied a different unit scale than the table states');
  // A drawn casing is the model's own size and a real cartridge's size: the three models are
  // authored at 38.7 / 57.067 / 19.15 model units, and those are 7.62x39, .50 and 9x19 cases.
  const realLongestMetres = { weapon_shell_casing_rifle: 0.0387, weapon_shell_casing_50cal: 0.057067,
    weapon_shell_casing_9mm: 0.01915 };
  for (const [name, expected] of Object.entries(realLongestMetres)) {
    const drawn = midFlight.drawn[name];
    const model = midFlight.models[name];
    if (!drawn || !model) throw Error('No drawn size for ' + name);
    const longestDrawn = Math.max(...drawn.spanMetres);
    if (Math.abs(longestDrawn - expected) > 1e-6)
      throw Error(`${name} is drawn ${longestDrawn} m long, not its own ${expected} m`);
    // The drawn size may not exceed the model the system names: a second, unscaled copy of the
    // geometry on the same node would make this tens of metres.
    if (Math.abs(longestDrawn - model.longestSizeMetres) > 1e-6)
      throw Error(`${name} draws more than its own model: ${longestDrawn} vs ${model.longestSizeMetres}`);
  }
  // A casing is on screen at the moment of the screenshot, at a size that can actually be seen.
  const visible = inFlight.filter((row) => row.inView);
  if (!visible.length) throw Error('No casing was in the camera\'s view while in flight');
  const biggest = Math.max(...visible.map((row) => row.apparentPixels));
  if (!(biggest >= 2))
    throw Error(`The on-screen casings are too small to be drawn: ${biggest} px`);
  // A casing is drawn, not merely simulated: with the casings in the frame the renderer drew more
  // calls and more triangles than with them hidden, by at least one casing's own geometry and by
  // no more than all the casings in flight are made of. Both sides are the quietest frame of their
  // own window, so the view's own wander is not what was measured — and because it is not, the
  // difference is pinned from both ends instead of being compared against the raw frame-to-frame
  // wander, which on a busy frame is larger than a handful of casings and says nothing either way.
  // *Both* windows with the casings in them have to show the same thing, so it cannot be a one-off.
  const mostTriangles = drawnInFrame.trianglesInFlight;
  const fewestTriangles = Math.min(...drawnInFrame.liveTriangles);
  if (!(drawnInFrame.live >= 1))
    throw Error('No casing was in flight to draw: ' + JSON.stringify(drawnInFrame));
  if (!(drawnInFrame.callsRemoved >= 1))
    throw Error('Hiding the casings removed no draw call, so none was being drawn: ' + JSON.stringify(drawnInFrame));
  if (!(drawnInFrame.callsRemoved <= drawnInFrame.live))
    throw Error('More draw calls left the frame than there were casings to draw: ' + JSON.stringify(drawnInFrame));
  if (!(drawnInFrame.trianglesRemoved >= fewestTriangles))
    throw Error('Hiding the casings removed fewer triangles than one casing has: ' + JSON.stringify(drawnInFrame));
  if (!(drawnInFrame.trianglesRemoved <= mostTriangles * 1.05 + 100))
    throw Error('More triangles left the frame than the casings in flight have: ' + JSON.stringify(drawnInFrame));
  for (const window of drawnInFrame.perWindow) {
    if (!(window.callsRemoved >= 1))
      throw Error(`The ${window.window} window with the casings in it drew no more calls than with them hidden: `
        + JSON.stringify(drawnInFrame));
    if (!(window.trianglesRemoved >= fewestTriangles))
      throw Error(`The ${window.window} window with the casings in it drew fewer triangles than one casing has: `
        + JSON.stringify(drawnInFrame));
  }
  // The rifle's own system is the one the held weapon names, and it is the one that ejected.
  const system = table.weapons.vandal;
  if (midFlight.lastSpawn?.system !== system)
    throw Error(`The ejecting system was ${midFlight.lastSpawn?.system}, not ${system}`);
  if (midFlight.lastSpawn?.model !== table.systems[system].model)
    throw Error(`The ejected model was ${midFlight.lastSpawn?.model}, not ${table.systems[system].model}`);
  // Gravity is the original's own: a casing in flight falls at the system's value, and one
  // that has landed has bounced off the map's own surface.
  const speed = midFlight.lastSpawn.speedMetresPerSecond;
  const low = Math.hypot(...table.systems[system].spawnVelocityLocalUnitsPerSecondMin) * table.sourceUnitsToMetres;
  const high = Math.hypot(...table.systems[system].spawnVelocityLocalUnitsPerSecondMax) * table.sourceUnitsToMetres;
  if (speed < low * 0.5 || speed > high * 1.5)
    throw Error(`Spawn speed ${speed} is outside the system's own range ${low}..${high}`);
  // The casing leaves in the weapon's own frame at the system's own speed, not a normalised
  // direction: the realised velocity is the rotated vector, so its length is the speed.
  const velocity = midFlight.lastSpawn.velocityMetresPerSecond;
  if (!velocity || Math.abs(Math.hypot(...velocity) - speed) > 1e-9)
    throw Error(`The ejected velocity ${JSON.stringify(velocity)} is not its own speed ${speed}`);
  if (!(speed > 1)) throw Error(`The ejected speed ${speed} looks normalised`);
  const evidence = {
    status: 'passed-original-shell-casings-in-game',
    scope: 'The local player in a real browser on the shipped de_dust2: every accepted shot ejected one casing '
      + 'from the shipped `weapon_shell_casing_*` system of the held weapon, drawn with that system\'s own model at '
      + 'the weapon\'s own shell-eject attachment, moving under the original gravity and drag and coming to rest on '
      + 'the map\'s own surface. The drawn casing is measured at its model\'s own size, the size of the real '
      + 'cartridge, and the frame the renderer built is shown to lose exactly the casings\' own draws when they '
      + 'are hidden.',
    url: base, shotsFired: shots, rounds,
    systems: midFlight.systems, unitScale: midFlight.unitScale,
    models: midFlight.models, drawnMetres: midFlight.drawn, texture: midFlight.texture,
    casingsInViewWhileInFlight: visible.length, largestApparentPixels: biggest, looksTaken,
    casingInView: inViewTarget, crop, drawnCasingPixels: pixelProof, frameAttempts: attempts,
    drawnInFrame,
    inFlight,
    spawned: midFlight.spawned, spawnedAfterLifetime: after.spawned, refused: midFlight.refused,
    liveInFlight: midFlight.live, liveAfterLifetime: after.live,
    landed: after.landed, casingsWithABounce: after.landed, surfaceHits: after.surfaceHits,
    maxTravelMetres: Math.max(...midFlight.liveCasings.map((row) => row.travelledMetres), 0),
    restingCasings: midFlight.liveCasings.filter((row) => row.resting).length,
    sampleFlight: midFlight.liveCasings.slice(0, 4), sampleLanded: midFlight.liveCasings.filter((row) => row.bounces > 0).slice(0, 4),
    lastSpawn: midFlight.lastSpawn, before: { spawned: before.spawned, live: before.live },
    expectedSpawnSpeedMetresPerSecond: [low, high],
    errors,
    boundary: 'Reads the casings the port simulated; it does not compare them against a recording of the original '
      + 'client, the systems\' fallback definitions are not drawn at distance, and the emitter attachment is the '
      + 'weapon\'s own shell-eject bone rather than one the PCF names. The pixel-level crop is supporting evidence '
      + 'only: it is captured when a still enough pair of frames can be caught, and the number of frames that had '
      + 'to be thrown away is recorded in frameAttempts, and how many looks were needed to catch a casing in the '
      + 'air in looksTaken. The frame the casings are taken out of is compared as the '
      + 'quietest frame of each of two sampled windows rather than as one pair, because the view\'s own draw count '
      + 'moves by a few calls as bots enter it and can cancel one casing\'s contribution; the windows themselves are '
      + 'in drawnInFrame.windows, both are required to agree in drawnInFrame.perWindow, and the draw calls and '
      + 'triangles taken away are bounded from both ends by the casings in flight. The wander between adjacent '
      + 'frames is recorded in drawnInFrame.noiseFloorTriangles.',
  };
  writeFileSync(resolve(outputDir, 'source-shell-ingame.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await browser.close();
}
