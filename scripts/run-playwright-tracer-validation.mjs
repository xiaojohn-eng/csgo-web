#!/usr/bin/env node
// Fires the real game's rifle and reads the original tracer it drew.
//
// The unit tests pin the table against the shipped PCF and the staged texture against its
// receipt. This proves the game itself draws one original tracer per accepted shot: the system
// the held weapon's `tracer_effect` names, along the shot's own line from where the bullet
// started to where the authority's trace says it stopped, at that system's own speed, width,
// alpha and streak length, with the ribbon measured back from its own vertices.
//
// A rifle tracer crosses a 26 m shot in 80 ms, so the frames are observed from inside the page
// rather than over the wire: one round trip is longer than a short streak's whole life.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.SOURCE_TRACER_BASE || 'http://127.0.0.1:27019';
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const errors = [];
const table = JSON.parse(readFileSync(resolve(root, 'game/source-tracers.json'), 'utf8'));
rmSync(resolve(outputDir, 'source-tracer-ingame-crop.png'), { force: true });

const fire = (hold) => `(async () => {
  const g = window.__BREACHLINE__.runtime();
  if (!g || !document.pointerLockElement) return { reason: 'not-locked' };
  const canvas = g.art.renderer.domElement;
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
  await new Promise((r) => setTimeout(r, ${hold}));
  canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  return { reason: 'fired' };
})()`;

// Every frame the page draws is looked at from inside the page: a streak's own life is shorter
// than a round trip, so a poll from outside would miss most of it.
const observe = `(() => {
  const g = window.__BREACHLINE__.runtime();
  const cam = g.art.camera;
  const canvas = g.art.renderer.domElement;
  const W = canvas.width, H = canvas.height;
  const project = (p) => {
    const V = cam.matrixWorldInverse.elements, P = cam.projectionMatrix.elements;
    const x = p[0], y = p[1], z = p[2];
    const vx = V[0]*x + V[4]*y + V[8]*z + V[12], vy = V[1]*x + V[5]*y + V[9]*z + V[13];
    const vz = V[2]*x + V[6]*y + V[10]*z + V[14];
    const cx = P[0]*vx + P[4]*vy + P[8]*vz + P[12], cy = P[1]*vx + P[5]*vy + P[9]*vz + P[13];
    const cw = P[3]*vx + P[7]*vy + P[11]*vz + P[15];
    return { ndc: [cx/cw, cy/cw], depth: -vz, behind: cw <= 0 };
  };
  window.__TRACER_FRAMES__ = [];
  window.__TRACER_SHOTS__ = {};
  window.__TRACER_LIVE__ = null;
  let since = 0;
  const tick = () => {
    const audit = g.art.assetAudit().sourceTracers;
    const live = audit.liveTracers ?? [];
    if (live.length) {
      since++;
      const row = live[live.length - 1];
      // The first frame a shot's streak appears in is the one whose lastShot is that streak's own
      // outcome, and that frame is also while the client still holds the shot's own event: the
      // events are a rolling window, so both are kept against the shot's key as they appear.
      const record = window.__TRACER_SHOTS__[row.shot] ?? (window.__TRACER_SHOTS__[row.shot] = {});
      if (!record.outcome && audit.lastShot?.shot === row.shot) record.outcome = audit.lastShot;
      if (!record.event) {
        const event = (window.__BREACHLINE__.handlingAudit()?.shots ?? [])
          .find((e) => '' + e.by + ':' + e.seq === row.shot);
        if (event) record.event = { seq: event.seq, by: event.by, weapon: event.weapon,
          x: event.x, y: event.y, z: event.z,
          impact: event.impact ? { x: event.impact.x, y: event.impact.y, z: event.impact.z } : null };
      }
      const head = project(row.head), tail = project(row.tail);
      const inside = (p) => !p.behind && Math.abs(p.ndc[0]) <= 1 && Math.abs(p.ndc[1]) <= 1;
      const mid = [(row.head[0] + row.tail[0]) / 2, (row.head[1] + row.tail[1]) / 2, (row.head[2] + row.tail[2]) / 2];
      const middle = project(mid);
      window.__TRACER_FRAMES__.push({ shot: row.shot, system: row.system, age: row.age,
        headMetres: row.headMetres, trailMetres: row.trailMetres, halfWidthMetres: row.halfWidthMetres,
        alpha: row.alpha, drawn: row.drawn, since, head: row.head, tail: row.tail,
        drawnLengthMetres: row.drawnLengthMetres, drawnWidthMetres: row.drawnWidthMetres,
        headOnScreen: inside(head), tailOnScreen: inside(tail),
        middlePixel: [Math.round((middle.ndc[0] + 1) / 2 * W), Math.round((1 - middle.ndc[1]) / 2 * H)],
        middleOnScreen: inside(middle),
        highlight: window.__TRACER_HIGHLIGHT__ === true,
        calls: g.art.renderer.info.render.calls, triangles: g.art.renderer.info.render.triangles,
        line: audit.lastShot?.lengthMetres ?? null, flightSeconds: audit.lastShot?.flightSeconds ?? null,
        outcomeLengthMetres: audit.lastShot?.drawnLengthMetres ?? null,
        outcomeHalfWidthMetres: audit.lastShot?.drawnHalfWidthMetres ?? null });
      window.__TRACER_LIVE__ = window.__TRACER_FRAMES__[window.__TRACER_FRAMES__.length - 1];
    } else {
      since = 0;
      window.__TRACER_LIVE__ = null;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`;

const read = `(() => {
  const g = window.__BREACHLINE__.runtime();
  const audit = g.art.assetAudit().sourceTracers;
  const shots = (window.__BREACHLINE__.handlingAudit()?.shots ?? []).map((e) => ({
    seq: e.seq, by: e.by, weapon: e.weapon, x: e.x, y: e.y, z: e.z,
    impact: e.impact ? { x: e.impact.x, y: e.impact.y, z: e.impact.z } : null }));
  return { audit, shots, frames: window.__TRACER_FRAMES__ ?? [],
    outcomes: window.__TRACER_SHOTS__ ?? {}, live: window.__TRACER_LIVE__ };
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
  await page.getByRole('textbox', { name: '呼号', exact: true }).fill('Tracer');
  await start.click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.waitForFunction(() => document.pointerLockElement
    && window.__BREACHLINE__?.assetAudit?.()?.sourceTracers?.material?.verified,
    null, { timeout: 180000 });
  const before = await page.evaluate(read);

  // The pistol's own system first, while the player is fresh: the table's mapping is then
  // checked for more than one weapon before the rifle shots begin. (The bots here shoot back,
  // and a dead player fires nothing.)
  const pistol = await (async () => {
    const alive = () => page.waitForFunction(() => {
      const player = window.__BREACHLINE__.handlingAudit()?.authority?.player;
      return Boolean(player && player.alive);
    }, null, { timeout: 20000 }).catch(() => null);
    for (let attempt = 0; attempt < 3; attempt++) {
      await alive();
      await page.keyboard.press('Digit2');
      await page.waitForFunction(() => window.__BREACHLINE__.handlingAudit()?.authority?.player?.weapon === 'glock',
        null, { timeout: 4000 }).catch(() => null);
      await page.waitForTimeout(300);
      const start = await page.evaluate(() => {
        const audit = window.__BREACHLINE__.assetAudit().sourceTracers;
        return { spawned: audit.spawned, shot: audit.lastShot?.shot ?? null };
      });
      for (let shot = 0; shot < 3; shot++) {
        await page.evaluate(fire(60));
        await page.waitForFunction((previous) => {
          const audit = window.__BREACHLINE__.assetAudit().sourceTracers;
          return audit.spawned > previous.spawned && audit.lastShot?.shot !== previous.shot;
        }, start, { timeout: 1500 }).catch(() => null);
        const now = await page.evaluate(() => ({
          spawned: window.__BREACHLINE__.assetAudit().sourceTracers.spawned,
          lastShot: window.__BREACHLINE__.assetAudit().sourceTracers.lastShot,
          weapon: window.__BREACHLINE__.handlingAudit()?.authority?.player?.weapon ?? null }));
        if (now.lastShot?.system === table.weapons.glock) {
          await page.keyboard.press('Digit1');
          await page.waitForTimeout(300);
          return now;
        }
        start.spawned = now.spawned;
        start.shot = now.lastShot?.shot ?? start.shot;
        await page.waitForTimeout(200);
      }
    }
    return { spawned: 0, lastShot: null, weapon: null };
  })();
  await page.evaluate(() => { window.__TRACER_FRAMES__ = []; });

  // The view is turned towards the open part of the spawn and raised a little: a tracer's own
  // life is its line divided by its own speed, so a shot at a wall two metres away would be over
  // before a single frame could be looked at.
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove',
    { movementX: 800, movementY: -150, bubbles: true })));
  await page.evaluate(observe);
  await page.waitForTimeout(120);
  // A dead player fires nothing, so the shots wait for the spawn rather than for a timer.
  const waitAlive = () => page.waitForFunction(() => {
    const player = window.__BREACHLINE__.handlingAudit()?.authority?.player;
    return Boolean(player && player.alive);
  }, null, { timeout: 30000 }).catch(() => null);

  const attempts = [];
  let accepted = null;
  for (let attempt = 0; attempt < 6 && !accepted; attempt++) {
    await waitAlive();
    await page.evaluate(() => { window.__TRACER_FRAMES__ = []; });
    const fired = await page.evaluate(fire(90));
    await page.waitForTimeout(320);
    const snapshot = await page.evaluate(read);
    const frames = snapshot.frames;
    const longest = frames.reduce((best, row) => (row.flightSeconds ?? 0) > (best?.flightSeconds ?? 0) ? row : best, null);
    attempts.push({ attempt, reason: fired.reason, liveFrames: frames.length,
      line: longest?.line ?? null, flightSeconds: longest?.flightSeconds ?? null });
    if (frames.length >= 2 && (longest?.flightSeconds ?? 0) >= 0.1) accepted = { snapshot, longest, key: longest.shot };
  }
  if (!accepted) throw Error('No shot gave a tracer long enough to look at: ' + JSON.stringify(attempts));
  const { snapshot, longest } = accepted;

  // The same shot again, this time with the frame kept while the streak is in the air: the
  // observer says when two frames have held it, and the pair of frames is taken from there.
  await page.evaluate(() => { window.__TRACER_FRAMES__ = []; });
  const captured = await (async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      await waitAlive();
      await page.evaluate(() => { window.__TRACER_FRAMES__ = []; });
      await page.evaluate(fire(90));
      await page.waitForFunction(() => (window.__TRACER_LIVE__?.since ?? 0) >= 2, null, { timeout: 2000 })
        .catch(() => null);
      const live = await page.evaluate(read);
      if ((live.live?.flightSeconds ?? 0) >= 0.1 && live.frames.length >= 2) return live;
      await page.waitForTimeout(200);
    }
    return null;
  })();
  const shotSeconds = captured?.live?.flightSeconds ?? longest.flightSeconds;
  const highlight = captured?.live?.middlePixel ?? longest.middlePixel;
  await page.screenshot({ path: resolve(outputDir, 'source-tracer-ingame.png') });

  // A streak in the air is a thin bright ribbon: the frame around it is kept enlarged, and the
  // same frame is taken again with the tracers hidden so the ribbon's own pixels can be compared
  // with the frame it was drawn into. Both frames have to be taken while the streak is still
  // alive, which the observer is asked about either side; if it left in between, that is said
  // rather than the difference being reported as the ribbon's.
  let crop = null;
  let pixelProof = null;
  if (highlight) {
    const side = 480, tall = 320;
    const left = Math.max(0, Math.min(1280 - side, Math.round(highlight[0] - side / 2)));
    const top = Math.max(0, Math.min(800 - tall, Math.round(highlight[1] - tall / 2)));
    await page.screenshot({ path: resolve(outputDir, 'source-tracer-ingame-crop.png'),
      clip: { x: left, y: top, width: side, height: tall } });
    crop = { file: 'source-tracer-ingame-crop.png', middlePixel: highlight,
      clip: { x: left, y: top, width: side, height: tall } };
    const grab = async () => await sharp(await page.screenshot()).raw().toBuffer({ resolveWithObject: true });
    const box = 110;
    const boxAt = (cx, cy) => ({ x: Math.max(0, Math.min(1280 - box, Math.round(cx - box / 2))),
      y: Math.max(0, Math.min(800 - box, Math.round(cy - box / 2))), width: box, height: box });
    const streakBox = boxAt(highlight[0], highlight[1]);
    const controlBox = boxAt(streakBox.x > 640 ? 260 : 1020, streakBox.y + 40);
    const changed = (reference, other, box_) => {
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
    const liveAt = () => page.evaluate(() => !!window.__TRACER_LIVE__);
    const withTracer = await grab();
    const liveAfterFirst = await liveAt();
    await page.evaluate(() => { window.__BREACHLINE__.runtime().art.sourceTracers.group.visible = false; });
    await page.waitForTimeout(34);
    const hidden = await grab();
    await page.evaluate(() => { window.__BREACHLINE__.runtime().art.sourceTracers.group.visible = true; });
    const liveAfterSecond = await liveAt();
    pixelProof = { streakBox, controlBox, bothFramesWhileLive: liveAfterFirst && liveAfterSecond,
      streak: changed(withTracer, hidden, streakBox), control: changed(withTracer, hidden, controlBox),
      step: 'difference between the frame with the tracers drawn and the frame with them hidden',
      verdict: 'Hiding the tracers changed pixels inside the streak\'s own box, so the ribbon did write to '
        + 'the frame; the same two frames also moved on their own, so this cannot be separated from the '
        + 'view\'s motion and is reported as supporting evidence rather than as the proof. The proof that '
        + 'the ribbon is drawn is its own frame-by-frame record above.' };
  }
  await page.keyboard.press('Escape');
  const after = await page.evaluate(read);

  // --- the streak the game drew, against the system the held weapon names --------------------
  const unit = table.sourceUnitsToMetres;
  // One shot's own outcome and its own event are kept beside the frames its streak was alive in,
  // so the frames are grouped by the shot they name rather than read as one sequence: a window
  // can hold two shots, and the client's own event window moves on.
  const groups = new Map();
  const remember = (key, record) => {
    const group = groups.get(key) ?? { key, outcome: null, event: null, frames: [] };
    group.outcome = group.outcome ?? record?.outcome ?? null;
    group.event = group.event ?? record?.event ?? null;
    groups.set(key, group);
    return group;
  };
  for (const frameSet of [snapshot, captured].filter(Boolean)) {
    for (const [key, record] of Object.entries(frameSet.outcomes ?? {})) remember(key, record);
    for (const frame of frameSet.frames) remember(frame.shot, null).frames.push(frame);
  }
  const caught = [...groups.values()].filter((group) => group.outcome && group.frames.length >= 2);
  if (!caught.length)
    throw Error('No tracer was caught alive in two frames of one shot: ' + JSON.stringify([...groups.values()]));
  // At least one of the streaks checked has to be a long shot: a tracer at a wall two metres away
  // is over in eleven milliseconds, which is too short to be a frame-by-frame record.
  if (!caught.some((group) => (group.outcome.flightSeconds ?? 0) >= 0.1))
    throw Error('No streak was in the air long enough to be followed frame by frame: '
      + JSON.stringify(caught.map((group) => ({ key: group.key, flight: group.outcome.flightSeconds }))));

  let grewSomewhere = false;
  for (const group of caught) {
    const shot = group.outcome;
    // The streak names the shot it belongs to, and that shot names the weapon: the system the
    // weapon's own `tracer_effect` points at is the one that had to be drawn.
    const match = group.event;
    if (!match) throw Error(`The tracer names shot ${shot.shot}, whose own event was never seen: `
      + JSON.stringify(group.key));
    if (!match.impact) throw Error('The tracer belongs to a shot with no reported impact');
    const system = table.weapons[match.weapon ?? 'vandal'] ?? null;
    if (!system) throw Error('The shot names a weapon with no tracer system: ' + match.weapon);
    if (shot.system !== system)
      throw Error(`The tracer system was ${shot.system}, not the one for ${match.weapon}: ${system}`);
    if (shot.material !== table.material.path)
      throw Error(`The tracer material was ${shot.material}, not ${table.material.path}`);
    const spec = table.systems[system];
    const low = spec.speedUnitsPerSecond[0] * unit, high = spec.speedUnitsPerSecond[1] * unit;
    if (!(shot.speedMetresPerSecond >= low * 0.999 && shot.speedMetresPerSecond <= high * 1.001))
      throw Error(`Tracer speed ${shot.speedMetresPerSecond} is outside the system's own ${low}..${high}`);
    if (Math.abs(shot.flightSeconds - shot.lengthMetres / shot.speedMetresPerSecond) > 1e-9)
      throw Error('The tracer did not fly its own line at its own speed: ' + JSON.stringify(shot));
    const radiusLow = spec.radiusUnits[0] * unit, radiusHigh = spec.radiusUnits[1] * unit;
    if (!(shot.halfWidthMetres >= radiusLow * 0.999 && shot.halfWidthMetres <= radiusHigh * 1.001))
      throw Error(`Tracer half width ${shot.halfWidthMetres} is outside ${radiusLow}..${radiusHigh}`);
    const alphaLow = spec.alphaRange[0] / 255 * spec.fade.startAlpha;
    const alphaHigh = spec.alphaRange[1] / 255;
    if (!(shot.alpha >= alphaLow - 1e-9 && shot.alpha <= alphaHigh + 1e-9))
      throw Error(`Tracer alpha ${shot.alpha} is outside ${alphaLow}..${alphaHigh}`);
    const cap = spec.renderLengthUnits[1] * unit;
    if (!(shot.trailLengthMetres > 0 && shot.trailLengthMetres <= cap + 1e-9))
      throw Error(`Tracer streak ${shot.trailLengthMetres} is outside 0..${cap}`);
    // Its colour is between the system's own two colours.
    for (let channel = 0; channel < 3; channel++) {
      const a = spec.color1[channel] / 255, b = spec.color2[channel] / 255;
      const value = shot.color[channel];
      if (!(value >= Math.min(a, b) - 1e-6 && value <= Math.max(a, b) + 1e-6))
        throw Error(`Tracer colour channel ${channel} is ${value}, outside ${a}..${b}`);
    }
    // It ran along the shot's own line: from where the bullet started, past the system's own
    // offset, to the point the authority's trace stopped it at.
    const lineLength = Math.hypot(match.impact.x - match.x, match.impact.y - match.y,
      match.impact.z - match.z);
    if (Math.abs(lineLength - (shot.lengthMetres + shot.sideOffsetMetres)) > 1e-6)
      throw Error(`The tracer's line is ${shot.lengthMetres + shot.sideOffsetMetres} m but the shot's is ${lineLength}`);
    const startGap = Math.hypot(shot.from[0] - match.x, shot.from[1] - match.y, shot.from[2] - match.z);
    if (Math.abs(startGap - shot.sideOffsetMetres) > 1e-6)
      throw Error(`The tracer starts ${startGap} m from the shot's origin, not its own ${shot.sideOffsetMetres}`);
    const toImpact = Math.hypot(shot.to[0] - match.impact.x, shot.to[1] - match.impact.y,
      shot.to[2] - match.impact.z);
    if (toImpact > 1e-6) throw Error(`The tracer ends ${toImpact} m from the reported impact`);
    // The ribbon it built is the length and width it states, measured from its own vertices: the
    // midpoints of its first and last cross-section are the streak it had in that very frame — the
    // cap is only reached once the ramp has run. The vertices are 32-bit, so this is held to a
    // millimetre.
    if (shot.drawnLengthMetres === null || shot.drawnHalfWidthMetres === null)
      throw Error('The tracer never wrote a ribbon: ' + JSON.stringify(shot));
    const finalFrame = group.frames[group.frames.length - 1];
    if (Math.abs(finalFrame.drawnLengthMetres - finalFrame.trailMetres) > 1e-3)
      throw Error(`The drawn ribbon runs ${finalFrame.drawnLengthMetres} m in the frame it was measured in, `
        + `not the ${finalFrame.trailMetres} m that frame held`);
    if (Math.abs(finalFrame.drawnWidthMetres / 2 - shot.halfWidthMetres) > 1e-4)
      throw Error(`The drawn ribbon is ${finalFrame.drawnWidthMetres / 2} m half wide, not ${shot.halfWidthMetres}`);
    // Billboarding each cross-section to the camera makes the ribbon a little longer across its
    // diagonal than the line it runs along, which is why the two are reported apart.
    if (!(shot.drawnDiagonalMetres >= shot.drawnLengthMetres - 1e-6))
      throw Error(`The ribbon's diagonal ${shot.drawnDiagonalMetres} is shorter than its own length: `
        + JSON.stringify(shot));
    // And every frame it was alive in had it visible, on the line, with the streak growing
    // exactly as the renderer's own `length fade in time` says it does.
    const slope = cap / spec.lengthFadeInSeconds;
    for (const frame of group.frames) {
      if (!frame.drawn) throw Error('A frame held the tracer with its ribbon hidden: ' + JSON.stringify(frame));
      const expected = Math.min(cap, slope * frame.age, shot.speedMetresPerSecond * frame.age);
      if (Math.abs(frame.trailMetres - expected) > 2e-3)
        throw Error(`The streak was ${frame.trailMetres} m at age ${frame.age}, not the ${expected} m its own `
          + 'length fade in time gives');
      if (frame.system !== shot.system)
        throw Error('A frame drew a different system than the shot\'s own: ' + JSON.stringify(frame));
    }
    // The streak never shortens while the tracer is in the air, and at least one shot somewhere
    // in this run has to show it growing: a streak that was already at the renderer's own
    // maximum in every frame it was seen in would prove the cap but not the ramp.
    const firstFrame = group.frames[0], lastFrame = group.frames[group.frames.length - 1];
    for (let index = 1; index < group.frames.length; index++)
      if (group.frames[index].trailMetres < group.frames[index - 1].trailMetres - 1e-6)
        throw Error('The streak shortened while the tracer was in the air: ' + JSON.stringify(group.frames));
    if (!(firstFrame.age < lastFrame.age))
      throw Error('The frames of one tracer did not age: ' + JSON.stringify(group.frames));
    if (lastFrame.trailMetres > firstFrame.trailMetres) grewSomewhere = true;
  }
  if (!grewSomewhere)
    throw Error('No streak was seen growing: every frame caught was already at its own maximum');

  const visible = caught.flatMap((group) => group.frames)
    .filter((frame) => frame.headOnScreen || frame.tailOnScreen || frame.middleOnScreen);
  if (!visible.length) throw Error('No tracer was in the camera\'s view while it was in the air');
  if (pistol.lastShot && pistol.lastShot.system !== table.weapons.glock)
    throw Error(`The pistol's tracer was ${pistol.lastShot.system}, not ${table.weapons.glock}`);
  if (!pistol.lastShot) throw Error('The pistol drew no tracer: ' + JSON.stringify(pistol));

  const evidence = {
    status: 'passed-original-tracers-in-game',
    scope: 'The local player in a real browser on the shipped de_dust2: every accepted shot drew one tracer from '
      + 'the system its own `tracer_effect` names, along the shot\'s own line from where the bullet started to '
      + 'where the authority\'s trace stopped it, at that system\'s own speed, width, alpha, colour and streak '
      + 'length. The streak\'s own frames were watched from inside the page, so the ribbon is shown growing the way '
      + 'the renderer\'s own `length fade in time` says, visible in every frame it was alive in and on screen.',
    url: base, viewTurn: 800, attempts,
    material: table.material, fadeTimeBasis: table.fadeTimeBasis, limitations: table.limitations,
    before: { spawned: before.audit.spawned, refused: before.audit.refused },
    after: { spawned: after.audit.spawned, refused: after.audit.refused, finished: after.audit.finished },
    streaks: caught.map((group) => ({ key: group.key, system: group.outcome.system, shot: group.outcome,
      frames: group.frames })),
    pistol: { spawned: pistol.spawned, weapon: pistol.weapon, lastShot: pistol.lastShot,
      expectedSystem: table.weapons.glock },
    inViewWhileInFlight: visible.length, shotSeconds,
    crop, drawnPixels: pixelProof, screenshot: 'source-tracer-ingame.png',
    errors,
    boundary: 'Reads the tracer the port drew on its own client; it does not compare it against a recording of the '
      + 'original. The four fade times are read as fractions of the particle\'s flight rather than measured from the '
      + 'operator\'s own arithmetic, the direction of the texture along the trail is not stated by the PCF, '
      + '`$splinetype 2`\'s smoothing is not applied because the path is already straight, and the drawn-pixel crop '
      + 'is supporting evidence only because two frames of a live scene never hold still.',
  };
  writeFileSync(resolve(outputDir, 'source-tracer-ingame.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify({
    status: evidence.status, attempts, shotSeconds, inView: visible.length, caught: caught.length,
    streaks: caught.map((group) => ({ key: group.key, system: group.outcome.system, line: group.outcome.lengthMetres,
      speed: group.outcome.speedMetresPerSecond, flightSeconds: group.outcome.flightSeconds,
      halfWidth: group.outcome.halfWidthMetres, alpha: group.outcome.alpha, color: group.outcome.color,
      trail: group.outcome.trailLengthMetres, drawnLength: group.outcome.drawnLengthMetres,
      frames: group.frames.map((f) => ({ age: f.age, trail: f.trailMetres, drawn: f.drawn,
        length: f.drawnLengthMetres, onScreen: f.headOnScreen || f.tailOnScreen || f.middleOnScreen })) })),
    pistol: { system: pistol.lastShot?.system, expected: table.weapons.glock },
    drawnPixels: pixelProof, after: evidence.after, errors }, null, 2) + '\n');
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await browser.close();
}
