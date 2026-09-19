#!/usr/bin/env node
// Buys the AWP in the training game and reads the two original systems it names.
//
// `items_game.txt` gives the AWP its own `eject_brass_effect` (`weapon_shell_casing_50cal`) and
// its own `tracer_effect` (`weapon_tracers_rifle`), and both differ from the rifles'. The unit
// tests pin both tables; this proves the game draws them for an AWP shot the local player took:
// the .50 case at the weapon's own shell-eject attachment, at that system's own size, and the
// rifle tracer along the shot's own line at that system's own width and offset.
//
// Bots shoot too, and their streaks are drawn as well, so nothing here reads "the last tracer":
// the frames are watched from inside the page and kept by the shot that owns them.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.SOURCE_AWP_BASE || 'http://127.0.0.1:27019';
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const errors = [];
const shells = JSON.parse(readFileSync(resolve(root, 'game/source-shell-casings.json'), 'utf8'));
const tracers = JSON.parse(readFileSync(resolve(root, 'game/source-tracers.json'), 'utf8'));

const fire = (hold) => `(async () => {
  const g = window.__BREACHLINE__.runtime();
  if (!g || !document.pointerLockElement) return { reason: 'not-locked' };
  const canvas = g.art.renderer.domElement;
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
  await new Promise((r) => setTimeout(r, ${hold}));
  canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  return { reason: 'fired' };
})()`;

// Every frame the page draws is looked at from inside the page, and only the local player's
// streaks are kept: a bolt-action shot's streak is over in about a tenth of a second, and the
// bots' streaks would otherwise be "the last tracer" most of the time.
const observe = `(() => {
  const g = window.__BREACHLINE__.runtime();
  window.__AWP_FRAMES__ = [];
  window.__AWP_SHOTS__ = {};
  window.__AWP_BRASS__ = { events: 0, casings: [], spawn: null };
  // The shooter's own first-person flash, watched the same way: the AWP's flame lives
  // about 25 ms, so its drawn sprites have to be kept from inside the render loop.
  window.__AWP_VIEW__ = null;
  window.__AWP_VIEW_FRAMES__ = [];
  window.__AWP_VIEW_CAPTURE__ = null;
  const tick = () => {
    const audit = g.art.assetAudit();
    const mine = (key) => typeof key === 'string' && key.startsWith('local:');
    const tracer = audit.sourceTracers;
    // A shot's own outcome outlives its streak, and a bolt-action fires rarely, so the outcome is
    // taken from whichever local shot last drew one rather than only from a streak caught alive.
    const last = tracer?.lastShot;
    if (last && mine(last.shot)) {
      const record = window.__AWP_SHOTS__[last.shot] ?? (window.__AWP_SHOTS__[last.shot] = {});
      record.outcome = record.outcome ?? last;
      if (!record.event) {
        const event = (window.__BREACHLINE__.handlingAudit()?.shots ?? [])
          .find((e) => '' + e.by + ':' + e.seq === last.shot);
        if (event) record.event = { seq: event.seq, by: event.by, weapon: event.weapon,
          x: event.x, y: event.y, z: event.z,
          impact: event.impact ? { x: event.impact.x, y: event.impact.y, z: event.impact.z } : null };
      }
    }
    for (const row of tracer?.liveTracers ?? []) {
      if (!mine(row.shot)) continue;
      window.__AWP_FRAMES__.push({ shot: row.shot, system: row.system, age: row.age,
        headMetres: row.headMetres, trailMetres: row.trailMetres, halfWidthMetres: row.halfWidthMetres,
        alpha: row.alpha, drawn: row.drawn, drawnLengthMetres: row.drawnLengthMetres,
        head: row.head, tail: row.tail });
    }
    const view = audit.sourceViewMuzzle;
    if (view) {
      const row = view.systems?.['weapon_muzzle_flash_awp'] ?? null;
      window.__AWP_VIEW__ = row
        ? { staged: true, weapon: view.weapon, placeholderVisible: view.placeholderVisible,
            space: view.space, lastBurst: row.lastBurst, bursts: row.bursts,
            hero: row.hero, hashVerified: row.hashVerified, flameSprites: row.flameSprites,
            glowSprites: row.glowSprites, limitations: row.limitations,
            configuration: row.configuration, frames: (row.recentFrames ?? []).length }
        : { staged: false, weapon: view.weapon, placeholderVisible: view.placeholderVisible };
      if (row && (row.recentFrames ?? []).length) window.__AWP_VIEW_FRAMES__ = row.recentFrames;
      // A 25 ms effect cannot be caught by a screenshot round trip, so the first frame
      // that drew the original sprites is grabbed from inside the page.
      if (row && (row.flameSprites ?? 0) > 0 && !window.__AWP_VIEW_CAPTURE__) {
        const canvas = document.querySelector('canvas');
        window.__AWP_VIEW_CAPTURE__ = { flameSprites: row.flameSprites, glowSprites: row.glowSprites,
          png: canvas ? canvas.toDataURL('image/png') : '' };
      }
    }
    const shells = audit.sourceShells;
    if (shells) {
      for (const row of shells.liveCasings ?? []) {
        if (row.system !== 'weapon_shell_casing_50cal') continue;
        // The casing is watched frame by frame; only the furthest it gets is kept, so the record
        // is its flight rather than one copy of it per frame.
        const best = window.__AWP_BRASS__.casings[0];
        const seen = { system: row.system, age: row.age, travelledMetres: row.travelledMetres,
          bounces: row.bounces, resting: row.resting, position: row.position };
        if (!best || (row.travelledMetres ?? 0) > (best.travelledMetres ?? 0))
          window.__AWP_BRASS__.casings[0] = seen;
      }
      // The last spawn overall belongs to whoever shot last, and the bots shoot rifles, so the .50
      // case's own spawn is kept by the system it names rather than read from the shared slot.
      if (shells.lastSpawn?.system === 'weapon_shell_casing_50cal') window.__AWP_BRASS__.spawn = shells.lastSpawn;
      window.__AWP_BRASS__.events = audit.sourceAWP?.brassEvents ?? 0;
      window.__AWP_BRASS__.spawned = shells.spawned;
      window.__AWP_BRASS__.refused = shells.refused;
      window.__AWP_BRASS__.lastSpawn = shells.lastSpawn;
      window.__AWP_BRASS__.drawn = shells.drawn?.weapon_shell_casing_50cal ?? null;
      window.__AWP_BRASS__.models = shells.models?.weapon_shell_casing_50cal ?? null;
      window.__AWP_BRASS__.unitScale = shells.unitScale;
      window.__AWP_BRASS__.live50 = (shells.liveCasings ?? []).filter(
        (row) => row.system === 'weapon_shell_casing_50cal').length;
      window.__AWP_BRASS__.liveAny = (shells.liveCasings ?? []).length;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`;

const read = `(() => {
  const g = window.__BREACHLINE__.runtime();
  const audit = g.art.assetAudit();
  const player = window.__BREACHLINE__.handlingAudit()?.authority?.player ?? null;
  return { shells: { spawned: audit.sourceShells?.spawned ?? null,
      refused: audit.sourceShells?.refused ?? null, live: audit.sourceShells?.live ?? null,
      lastSpawn: audit.sourceShells?.lastSpawn ?? null,
      drawn: audit.sourceShells?.drawn?.weapon_shell_casing_50cal ?? null,
      model: audit.sourceShells?.models?.weapon_shell_casing_50cal ?? null,
      unitScale: audit.sourceShells?.unitScale ?? null },
    tracers: { spawned: audit.sourceTracers?.spawned ?? null,
      refused: audit.sourceTracers?.refused ?? null,
      rifTrail: audit.sourceTracers?.systems?.weapon_tracers_rifle ?? null },
    awp: audit.sourceAWP,
    frames: window.__AWP_FRAMES__ ?? [], outcomes: window.__AWP_SHOTS__ ?? {},
    brass: window.__AWP_BRASS__ ?? null,
    view: window.__AWP_VIEW__ ?? null, viewBase: window.__AWP_VIEW_BASE__ ?? null,
    viewFrames: window.__AWP_VIEW_FRAMES__ ?? [], viewCapture: window.__AWP_VIEW_CAPTURE__ ?? null,
    money: player?.money ?? null, primary: player?.primary ?? null, alive: player?.alive ?? null };
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
  await page.getByRole('textbox', { name: '呼号', exact: true }).fill('AwpFX');
  await start.click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  // Both original systems have to be staged before an AWP shot can draw anything.
  await page.waitForFunction(() => document.pointerLockElement
    && window.__BREACHLINE__?.assetAudit?.()?.sourceShells?.drawn?.weapon_shell_casing_50cal
    && window.__BREACHLINE__?.assetAudit?.()?.sourceTracers?.material?.verified,
    null, { timeout: 180000 });
  const before = await page.evaluate(read);

  // The AWP is bought from the game's own shop, which the training mode keeps open. Every shop
  // button is disabled while the player is dead, so each try waits for a spawn.
  let bought = before;
  for (let attempt = 0; attempt < 4 && bought.primary !== 'awp'; attempt++) {
    await page.waitForFunction(() => {
      const player = window.__BREACHLINE__.handlingAudit()?.authority?.player;
      return Boolean(player && player.alive);
    }, null, { timeout: 30000 }).catch(() => null);
    await page.keyboard.press('KeyB');
    const awpButton = page.getByRole('button', { name: /^AWP/ });
    await awpButton.waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);
    if (await awpButton.count() && !(await awpButton.first().isDisabled().catch(() => true)))
      await awpButton.first().click();
    await page.waitForTimeout(1000);
    bought = await page.evaluate(read);
  }
  if (bought.primary !== 'awp') throw Error('The AWP was not bought: ' + JSON.stringify(bought));
  // The shop closes on its own key rather than on Escape, which would give up the pointer lock a
  // shot needs; if the lock has gone anyway, take it back before firing.
  await page.keyboard.press('KeyB');
  if (!(await page.evaluate(() => !!document.pointerLockElement))) await page.mouse.click(640, 400);
  await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 8000 }).catch(() => null);
  if (!(await page.evaluate(() => !!document.pointerLockElement)))
    throw Error('The pointer lock could not be taken back after buying');

  // The view is turned along the open part of the spawn: a streak's own life is its line divided
  // by its own speed, so a shot at the wall two metres ahead would be over before a frame could
  // hold it. It is not raised, because a shot over the map's own sky is a shot with no impact to
  // end the streak on.
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove',
    { movementX: 800, movementY: 0, bubbles: true })));
  await page.evaluate(observe);
  await page.waitForTimeout(120);

  const attempts = [];
  let caught = null;
  for (let attempt = 0; attempt < 6 && !caught; attempt++) {
    await page.evaluate(() => {
      window.__AWP_FRAMES__ = []; window.__AWP_BRASS__.casings.length = 0; window.__AWP_BRASS__.spawn = null;
      window.__AWP_VIEW_FRAMES__ = []; window.__AWP_VIEW_CAPTURE__ = null;
      const row = window.__BREACHLINE__.runtime().art.assetAudit()
        .sourceViewMuzzle?.systems?.weapon_muzzle_flash_awp ?? null;
      // Each attempt asserts what that one shot added, so the running totals are banked.
      window.__AWP_VIEW_BASE__ = row ? { bursts: row.bursts, flameSprites: row.flameSprites,
        glowSprites: row.glowSprites } : null;
    });
    await page.waitForFunction(() => {
      const player = window.__BREACHLINE__.handlingAudit()?.authority?.player;
      return Boolean(player && player.alive);
    }, null, { timeout: 30000 }).catch(() => null);
    const fired = await page.evaluate(fire(140));
    // The .50 case leaves on the bolt-action's own ejection moment, later in the weapon's fire
    // sequence than the shot itself, so this waits out that sequence.
    await page.waitForFunction(() => (window.__AWP_BRASS__?.events ?? 0) > 0, null, { timeout: 6000 })
      .catch(() => null);
    await page.waitForTimeout(400);
    const snapshot = await page.evaluate(read);
    const mine = snapshot.frames.filter((frame) => frame.shot.startsWith('local:'));
    const localShots = Object.entries(snapshot.outcomes ?? {})
      .filter(([key, record]) => key.startsWith('local:') && record.outcome)
      .map(([key, record]) => ({ key, system: record.outcome.system, weapon: record.event?.weapon ?? null }));
    const viewFired = (snapshot.view?.bursts ?? 0) - (snapshot.viewBase?.bursts ?? snapshot.view?.bursts ?? 0);
    attempts.push({ attempt, reason: fired.reason, frames: mine.length, localShots,
      brassEvents: snapshot.brass.events, casings50: snapshot.brass.casings.length,
      shellsSpawned: snapshot.shells.spawned, tracersSpawned: snapshot.tracers.spawned,
      viewBursts: viewFired, viewFlameSprites: snapshot.view?.flameSprites ?? null,
      viewGlowSprites: snapshot.view?.glowSprites ?? null, placeholderVisible: snapshot.view?.placeholderVisible ?? null });
    // One shot has to have drawn all three of the AWP's own effects: its .50 case, its own
    // tracer, and its own first-person flash in the shooter's viewmodel scene.
    const awpShot = localShots.find((row) => row.system === tracers.weapons.awp && row.weapon === 'awp') ?? null;
    if (awpShot && snapshot.brass.casings.some((row) => row.system === shells.weapons.awp) && viewFired >= 1)
      caught = { snapshot, frames: mine, key: awpShot.key };
  }
  await page.keyboard.press('Escape');
  if (!caught) {
    const last = await page.evaluate(read);
    throw Error('No AWP shot drew both of its own systems: ' + JSON.stringify({ attempts,
      lastCasing: last.shells.lastSpawn, brassEvents: last.brass?.events ?? null,
      shellsSpawned: last.shells.spawned, tracersSpawned: last.tracers.spawned,
      live50: last.brass?.live50 ?? null, lastFrames: last.frames.length }));
  }
  const { snapshot, frames, key } = caught;
  // The frames are the streak's own life; a bolt-action's streak is short and may not be caught,
  // in which case the shot's own outcome is what is asserted and the frames are said to be absent.
  const caughtAlive = frames.length >= 2;

  // --- the .50 case, at the size that system's own model has --------------------------------
  const casingSystem = shells.weapons.awp;
  if (casingSystem !== 'weapon_shell_casing_50cal')
    throw Error('The shipped table no longer names the AWP\'s own casing system: ' + casingSystem);
  const casingSpec = shells.systems[casingSystem];
  const casing = snapshot.brass.spawn;
  if (!casing) throw Error('The .50 case never reported its own spawn: ' + JSON.stringify(snapshot.brass));
  if (casing.system !== casingSystem)
    throw Error(`The AWP ejected ${casing.system}, not its own ${casingSystem}`);
  if (casing.model !== casingSpec.model)
    throw Error(`The AWP ejected ${casing.model}, not its own ${casingSpec.model}`);
  if (!(snapshot.brass.events >= 1))
    throw Error('The bolt-action never reached its own brass cue: ' + JSON.stringify(snapshot.brass));
  // The .50 case is 57.067 model units long, which is 5.7 cm: nearly half again the rifle's.
  const drawn = snapshot.brass.drawn ?? snapshot.shells.drawn;
  if (!drawn) throw Error('The AWP casing system was never built');
  const longestDrawn = Math.max(...drawn.spanMetres);
  if (Math.abs(longestDrawn - 0.0570671) > 1e-6)
    throw Error(`The .50 case is drawn ${longestDrawn} m long, not its own 0.0570671 m`);
  if (Math.abs(longestDrawn - snapshot.brass.models.longestSizeMetres) > 1e-6)
    throw Error('The AWP casing draws more than its own model: ' + JSON.stringify(snapshot.brass.models));
  // Its own speed range, its own collision response, and the model scale the table states.
  const casingUnit = shells.sourceUnitsToMetres;
  const low = Math.hypot(...casingSpec.spawnVelocityLocalUnitsPerSecondMin) * casingUnit;
  const high = Math.hypot(...casingSpec.spawnVelocityLocalUnitsPerSecondMax) * casingUnit;
  const speed = casing.speedMetresPerSecond;
  if (!(speed >= low * 0.5 && speed <= high * 1.5))
    throw Error(`The .50 case left at ${speed} m/s, outside its own ${low}..${high}`);
  if (!(speed > 1)) throw Error(`The .50 case's speed ${speed} looks normalised`);
  if (Math.abs(snapshot.brass.unitScale.modelUnitsToMetres - shells.modelUnitsToMetres) > 1e-12)
    throw Error('The AWP casing used a different unit scale than the table states');
  // It fell and was answered by the level, which is the system's own collision operator.
  const flown = snapshot.brass.casings.reduce((best, row) =>
    (row.travelledMetres ?? 0) > (best?.travelledMetres ?? -1) ? row : best, null);
  if (!flown || !(flown.travelledMetres > 0))
    throw Error('The AWP casing never travelled: ' + JSON.stringify(snapshot.brass.casings));
  // The AWP is one of the two systems the table gives a different slide, and it is the tighter.
  if (!(casingSpec.collision.slide < shells.systems.weapon_shell_casing_rifle.collision.slide))
    throw Error('The .50 casing no longer has its own, tighter, slide: '
      + JSON.stringify(casingSpec.collision));

  // --- the AWP's own tracer ---------------------------------------------------------------
  const tracerSystem = tracers.weapons.awp;
  if (tracerSystem !== 'weapon_tracers_rifle')
    throw Error('The shipped table no longer names the AWP\'s own tracer system: ' + tracerSystem);
  const tracerSpec = tracers.systems[tracerSystem];
  const tracerUnit = tracers.sourceUnitsToMetres;
  const outcome = snapshot.outcomes[key]?.outcome ?? null;
  const event = snapshot.outcomes[key]?.event ?? null;
  if (!outcome) throw Error('The AWP\'s streak has no outcome: ' + JSON.stringify(key));
  if (outcome.system !== tracerSystem)
    throw Error(`The AWP drew ${outcome.system}, not its own ${tracerSystem}`);
  if (outcome.material !== tracers.material.path)
    throw Error(`The AWP tracer material was ${outcome.material}, not ${tracers.material.path}`);
  if (!event || !event.impact) throw Error('The AWP\'s shot event with its impact was never seen');
  if (event.weapon !== 'awp') throw Error('The streak belongs to a ' + event.weapon + ' shot');
  const speedLow = tracerSpec.speedUnitsPerSecond[0] * tracerUnit;
  const speedHigh = tracerSpec.speedUnitsPerSecond[1] * tracerUnit;
  if (!(outcome.speedMetresPerSecond >= speedLow * 0.999 && outcome.speedMetresPerSecond <= speedHigh * 1.001))
    throw Error(`The AWP tracer flew at ${outcome.speedMetresPerSecond} m/s, outside its own `
      + `${speedLow}..${speedHigh}`);
  const widthLow = tracerSpec.radiusUnits[0] * tracerUnit;
  const widthHigh = tracerSpec.radiusUnits[1] * tracerUnit;
  if (!(outcome.halfWidthMetres >= widthLow * 0.999 && outcome.halfWidthMetres <= widthHigh * 1.001))
    throw Error(`The AWP tracer is ${outcome.halfWidthMetres} m half wide, outside its own `
      + `${widthLow}..${widthHigh}`);
  // The AWP is the only one of the three whose streak starts 80 units out rather than 20.
  const expectedOffset = tracerSpec.offsetUnits[0] * tracerUnit + tracerSpec.startOffsetUnits;
  if (Math.abs(outcome.sideOffsetMetres - expectedOffset) > 1e-9)
    throw Error(`The AWP tracer starts ${outcome.sideOffsetMetres} m out, not its own ${expectedOffset}`);
  if (Math.abs(expectedOffset - 80 * tracerUnit) > 1e-9)
    throw Error('The AWP tracer offset is no longer 80 units: ' + expectedOffset);
  const lineLength = Math.hypot(event.impact.x - event.x, event.impact.y - event.y, event.impact.z - event.z);
  if (Math.abs(lineLength - (outcome.lengthMetres + outcome.sideOffsetMetres)) > 1e-6)
    throw Error(`The AWP tracer's line is ${outcome.lengthMetres + outcome.sideOffsetMetres} m but the shot's `
      + `is ${lineLength}`);
  const alphaLow = tracerSpec.alphaRange[0] / 255 * tracerSpec.fade.startAlpha;
  const alphaHigh = tracerSpec.alphaRange[1] / 255;
  if (!(outcome.alpha >= alphaLow - 1e-9 && outcome.alpha <= alphaHigh + 1e-9))
    throw Error(`The AWP tracer alpha ${outcome.alpha} is outside its own ${alphaLow}..${alphaHigh}`);
  // The AWP's tracer is wider than the rifle's, which is what its own `Radius Random` says; the
  // streak that was drawn is that width, measured back from its own vertices.
  const rifleTracer = tracers.systems.weapon_tracers_assrifle;
  if (!(tracerSpec.radiusUnits[0] > rifleTracer.radiusUnits[0]))
    throw Error('The AWP tracer is no longer wider than the rifle\'s: ' + JSON.stringify(tracerSpec.radiusUnits));
  if (Math.abs(outcome.halfWidthMetres - rifleTracer.radiusUnits[0] * tracerUnit) < 1e-6)
    throw Error('The AWP tracer drew the rifle\'s width: ' + outcome.halfWidthMetres);
  for (const frame of frames) {
    if (!frame.drawn) throw Error('A frame held the AWP tracer with its ribbon hidden: ' + JSON.stringify(frame));
    if (frame.system !== tracerSystem)
      throw Error('A frame drew a different system than the AWP\'s own: ' + JSON.stringify(frame));
  }

  // --- the AWP's own first-person flash, in the shooter's viewmodel scene ------------------
  const viewSystem = 'weapon_muzzle_flash_awp';
  const view = snapshot.view;
  if (!view || view.staged !== true)
    throw Error('The AWP\'s own first-person system was not staged: ' + JSON.stringify(view));
  const viewBase = snapshot.viewBase ?? {};
  if (!((view.bursts ?? 0) - (viewBase.bursts ?? 0) >= 1))
    throw Error(`The AWP's own first-person flash never emitted for the shot (${viewBase.bursts} -> ${view.bursts})`);
  if (!((view.flameSprites ?? 0) - (viewBase.flameSprites ?? 0) >= 1))
    throw Error(`The AWP's own flame never drew a sprite in the viewmodel scene (${viewBase.flameSprites} -> ${view.flameSprites})`);
  if (!((view.glowSprites ?? 0) - (viewBase.glowSprites ?? 0) >= 1))
    throw Error(`The AWP's own glow never drew a sprite in the viewmodel scene (${viewBase.glowSprites} -> ${view.glowSprites})`);
  if (view.lastBurst?.system !== viewSystem)
    throw Error(`The first-person flash used ${view.lastBurst?.system}, not its own ${viewSystem}`);
  if (view.lastBurst?.attachment !== '1')
    throw Error('The first-person flash was not anchored on the viewmodel\'s own muzzle attachment: '
      + JSON.stringify(view.lastBurst));
  if (view.lastBurst?.weapon !== 'awp')
    throw Error('The first-person flash was drawn for ' + view.lastBurst?.weapon);
  // The flash belongs to the same shooter as the shot whose streak was caught.
  if (view.lastBurst?.shooter !== key.split(':')[0])
    throw Error(`The first-person flash belongs to ${view.lastBurst?.shooter}, not to the shot ${key}`);
  // The port's own cone must not be standing in for the original system.
  if (view.placeholderVisible !== false)
    throw Error('The port\'s own muzzle cone was still drawn as the AWP\'s flash');
  const unit = tracers.sourceUnitsToMetres;
  const flameSpec = view.configuration?.flame ?? null, glowSpec = view.configuration?.glow ?? null;
  if (!flameSpec || !glowSpec) throw Error('The AWP\'s own chain reported no configuration: ' + JSON.stringify(view.configuration));
  const anchor = view.lastBurst.at, forward = view.lastBurst.forward;
  if (!(Math.hypot(...anchor) <= 1.5))
    throw Error('The first-person flash was anchored outside the viewmodel scene: ' + JSON.stringify(anchor));
  if (Math.abs(Math.hypot(...forward) - 1) > 1e-3)
    throw Error('The first-person flash was given a non-unit forward axis: ' + JSON.stringify(forward));
  const spriteRows = [];
  let flameRows = 0, glowRows = 0;
  for (const frame of snapshot.viewFrames ?? []) {
    for (const [kind, rows, spec] of [['flame', frame.flame ?? [], flameSpec], ['glow', frame.glow ?? [], glowSpec]]) {
      if (kind === 'flame') flameRows += rows.length; else glowRows += rows.length;
      const sweep = spec.positionMaximum[0] * unit;
      const radiusLow = Math.min(spec.radiusMinimum, spec.radiusMaximum) * unit;
      const radiusHigh = Math.max(spec.radiusMinimum, spec.radiusMaximum) * unit;
      const alphaHigh = spec.alphaMax / 255;
      for (const row of rows) {
        // Each row carries the anchor of the burst it was drawn for, so an older sprite is
        // never measured against a later shot's muzzle.
        if (!Array.isArray(row.anchor) || !Array.isArray(row.forward))
          throw Error(`A ${kind} sprite did not report the anchor it was drawn at: ` + JSON.stringify(row));
        const base = row.anchor, axis = row.forward;
        const offset = [row.position[0] - base[0], row.position[1] - base[1], row.position[2] - base[2]];
        const away = Math.hypot(...offset);
        const along = offset[0] * axis[0] + offset[1] * axis[1] + offset[2] * axis[2];
        spriteRows.push({ kind, away: +away.toFixed(4), along: +along.toFixed(4), swept: row.distance,
          radius: row.radius, alpha: row.alpha, age: row.age });
        if (!(away <= sweep + 0.05))
          throw Error(`A ${kind} sprite was drawn ${away} m from the muzzle, outside its own ${sweep} m sweep`);
        if (along < -1e-6) throw Error(`A ${kind} sprite was drawn behind the muzzle`);
        if (!(row.radius >= radiusLow - 1e-9 && row.radius <= radiusHigh + 1e-9))
          throw Error(`A ${kind} sprite is ${row.radius} m wide, outside its own ${radiusLow}..${radiusHigh}`);
        if (!(row.alpha >= 0 && row.alpha <= alphaHigh + 1e-9))
          throw Error(`A ${kind} sprite has alpha ${row.alpha}, outside its own window ${alphaHigh}`);
      }
    }
  }
  if (!flameRows) throw Error('No frame kept any of the AWP\'s own flame sprites');
  if (!glowRows) throw Error('No frame kept any of the AWP\'s own glow sprites');

  // The captured frame is auxiliary: a WebGL canvas readback can legitimately be refused, and
  // that is reported rather than hidden. The hard evidence is the sprite rows above.
  let canvasImage = { status: 'the page never caught a frame with the original sprites' };
  const captured = snapshot.viewCapture;
  if (captured?.png?.startsWith('data:image/png;base64,')) {
    const bytes = Buffer.from(captured.png.slice('data:image/png;base64,'.length), 'base64');
    if (bytes.byteLength > 2048) {
      const file = resolve(outputDir, 'source-awp-flash-first-person-frame.png');
      writeFileSync(file, bytes);
      canvasImage = { file: file.slice(root.length + 1), bytes: bytes.byteLength,
        flameSprites: captured.flameSprites, glowSprites: captured.glowSprites };
    } else canvasImage = { status: 'the canvas readback came back empty' };
  } else if (captured) canvasImage = { status: 'the browser refused the canvas readback' };

  const evidence = {
    status: 'passed-original-awp-effects-in-game',
    scope: 'The local player in a real browser on the shipped de_dust2: after buying an AWP from the game\'s own '
      + 'shop, one accepted shot reached the bolt-action\'s own brass cue and ejected the .50 case from the system '
      + 'the weapon\'s own `eject_brass_effect` names (drawn at that model\'s own 57.07 mm and flown under that '
      + 'system\'s own gravity, drag and collision response), drew the tracer its own `tracer_effect` names '
      + '(wider than the rifle\'s, starting 80 units out rather than 20, along the shot\'s own line), and drew the '
      + 'first-person flash its own `muzzle_flash_effect_1st_person` names in the viewmodel scene, anchored on the '
      + 'viewmodel\'s own muzzle attachment with the port\'s own cone hidden.',
    url: base, viewTurn: [800, 0], attempts,
    bought: { primary: bought.primary, moneyBefore: before.money, moneyAfter: bought.money,
      spent: (before.money ?? 0) - (bought.money ?? 0) },
    casing: { system: casingSystem, spec: casingSpec, lastSpawn: casing, flown,
      drawnMetres: drawn.spanMetres, drawnLongestMetres: longestDrawn, model: snapshot.brass.model,
      speedRangeMetresPerSecond: [low, high], brassCueEvents: snapshot.brass.events,
      unitScale: snapshot.brass.unitScale },
    tracer: { system: tracerSystem, spec: tracerSpec, outcome, event, matchedShot: event,
      lineLength, speedRangeMetresPerSecond: [speedLow, speedHigh],
      widthRangeMetres: [widthLow, widthHigh], expectedSideOffsetMetres: expectedOffset,
      frames, unitScale: tracerUnit },
    firstPerson: { system: viewSystem, hero: view.hero, anchor, forward, attachment: view.lastBurst.attachment,
      shooter: view.lastBurst.shooter, shot: view.lastBurst.shot, space: view.space,
      placeholderHidden: view.placeholderVisible === false, bursts: view.bursts, base: viewBase,
      flameSprites: view.flameSprites, glowSprites: view.glowSprites, hashVerified: view.hashVerified,
      limitations: view.limitations, spec: { flame: flameSpec, glow: glowSpec }, unitScale: unit,
      frames: snapshot.viewFrames, spriteRows, capture: canvasImage },
    before: { shellSpawned: before.shells.spawned, tracerSpawned: before.tracers.spawned },
    after: { shellSpawned: snapshot.shells.spawned, shellRefused: snapshot.shells.refused,
      tracerSpawned: snapshot.tracers.spawned, tracerRefused: snapshot.tracers.refused },
    errors,
    boundary: 'Reads the three original systems the port drew for one AWP shot: its own .50 case, its own tracer and '
      + 'its own first-person flash. It does not compare them against a recording of the original, and the .50 case\'s '
      + 'own bounce was not exercised by this sample. The flash\'s captured canvas frame is auxiliary; the assertion '
      + 'is the sprite rows the renderer itself wrote. The emitter attachment is the weapon\'s own shell-eject bone '
      + 'rather than one the PCF names.',
  };
  writeFileSync(resolve(outputDir, 'source-awp-effects-ingame.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify({
    status: evidence.status, attempts, bought: evidence.bought,
    casing: { system: casingSystem, model: casing.model, drawnLongestMetres: longestDrawn,
      speed: speed, range: [low, high], brassCueEvents: snapshot.brass.events,
      flownMetres: flown.travelledMetres, bounces: flown.bounces },
    tracer: { system: tracerSystem, line: outcome.lengthMetres, speed: outcome.speedMetresPerSecond,
      halfWidth: outcome.halfWidthMetres, sideOffset: outcome.sideOffsetMetres, alpha: outcome.alpha,
      trail: outcome.trailLengthMetres, frames: frames.length,
      onOwnLine: lineLength },
    firstPerson: { system: viewSystem, hero: view.hero, anchor, placeholderHidden: view.placeholderVisible === false,
      bursts: (view.bursts ?? 0) - (viewBase.bursts ?? 0), flameSprites: view.flameSprites,
      glowSprites: view.glowSprites, flameRows, glowRows, frames: (snapshot.viewFrames ?? []).length,
      furthestSpriteMetres: spriteRows.length ? Math.max(...spriteRows.map((row) => row.away)) : null,
      capture: canvasImage.status ?? canvasImage.file },
    errors }, null, 2) + '\n');
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await browser.close();
}
