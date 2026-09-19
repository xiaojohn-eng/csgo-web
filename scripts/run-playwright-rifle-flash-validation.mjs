#!/usr/bin/env node
// The rifle family's own first-person muzzle flash, in the shooter's own viewmodel scene.
//
// `items_game.txt` gives AK-47 and M4A4 `muzzle_flash_effect_1st_person =
// weapon_muzzle_flash_assaultrifle`, the same shipped name their third-person column gives.
// The port draws it in the viewmodel scene, on the viewmodel's own muzzle attachment, by a
// second instance of the same program the world instance draws: the `_vent` sprite flash,
// the `_main` flame, its glow and the continuous flame.
//
// The whole flash is about 25 ms, so nothing here reads "the last frame": the page watches
// its own render loop and keeps the sprite rows the renderer itself wrote.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.SOURCE_RIFLE_FLASH_BASE || 'http://127.0.0.1:27019';
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const errors = [];
const RIFLE_SYSTEM = 'weapon_muzzle_flash_assaultrifle';
const RIFLE_WEAPONS = ['vandal', 'm4a4'];

const fire = (hold) => `(async () => {
  const g = window.__BREACHLINE__.runtime();
  if (!g || !document.pointerLockElement) return { reason: 'not-locked' };
  const canvas = g.art.renderer.domElement;
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
  await new Promise((r) => setTimeout(r, ${hold}));
  canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  return { reason: 'fired' };
})()`;

const observe = `(() => {
  const g = window.__BREACHLINE__.runtime();
  window.__RIFLE_VIEW__ = null;
  window.__RIFLE_VIEW_FRAMES__ = [];
  window.__RIFLE_VIEW_CAPTURE__ = null;
  window.__RIFLE_SHOTS__ = 0;
  const tick = () => {
    const audit = g.art.assetAudit();
    const view = audit.sourceViewMuzzle;
    const row = view?.systems?.['weapon_muzzle_flash_assaultrifle'] ?? null;
    window.__RIFLE_VIEW__ = row
      ? { staged: true, weapon: view.weapon, placeholderVisible: view.placeholderVisible, space: view.space,
          lastBurst: row.lastBurst, bursts: row.bursts, programVersion: row.programVersion,
          hashVerified: row.hashVerified, sprites: row.sprites, limitations: row.limitations,
          configuration: row.configuration, frames: (row.recentFrames ?? []).length }
      : { staged: false, weapon: view?.weapon ?? null, placeholderVisible: view?.placeholderVisible ?? null };
    if (row && (row.recentFrames ?? []).length) window.__RIFLE_VIEW_FRAMES__ = row.recentFrames;
    if (row && (row.sprites?.vent ?? 0) > 0 && !window.__RIFLE_VIEW_CAPTURE__) {
      const canvas = document.querySelector('canvas');
      window.__RIFLE_VIEW_CAPTURE__ = { vent: row.sprites?.vent ?? 0, glow: row.sprites?.glow ?? 0,
        flame: row.sprites?.flame ?? 0, continuous: row.sprites?.continuous ?? 0,
        png: canvas ? canvas.toDataURL('image/png') : '' };
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
  return { view: window.__RIFLE_VIEW__ ?? null, frames: window.__RIFLE_VIEW_FRAMES__ ?? [],
    capture: window.__RIFLE_VIEW_CAPTURE__ ?? null, base: window.__RIFLE_VIEW_BASE__ ?? null,
    money: player?.money ?? null, primary: player?.primary ?? null, secondary: player?.secondary ?? null,
    ammo: window.__BREACHLINE__?.snapshot?.()?.players?.find((p) => p.name === 'RifleFX')?.ammo ?? null,
    awp: audit.sourceAWP ?? null };
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
  await page.getByRole('textbox', { name: '呼号', exact: true }).fill('RifleFX');
  await start.click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  // The shooter's own rifle system has to be staged before a shot can draw anything.
  await page.waitForFunction(() => window.__BREACHLINE__?.assetAudit?.()?.sourceViewMuzzle?.systems
    ?.weapon_muzzle_flash_assaultrifle?.programVersion === 'csgo-assaultrifle-muzzle-12426148-r1',
  null, { timeout: 180000 });
  const before = await page.evaluate(read);
  if (!RIFLE_WEAPONS.includes(before.primary))
    throw Error('The training loadout no longer starts with an assault rifle: ' + before.primary);

  // The view is turned along the open part of the spawn: the flash is anchored on the
  // viewmodel's muzzle, so the shot only has to be accepted, but a shot into the wall two
  // metres ahead gives the shot itself no room to be sampled either.
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove',
    { movementX: 800, movementY: 0, bubbles: true })));
  await page.evaluate(observe);
  await page.waitForTimeout(120);

  const attempts = [];
  let caught = null;
  for (let attempt = 0; attempt < 6 && !caught; attempt++) {
    await page.evaluate(() => {
      window.__RIFLE_VIEW_FRAMES__ = []; window.__RIFLE_VIEW_CAPTURE__ = null;
      window.__RIFLE_VIEW_BASE__ = window.__RIFLE_VIEW__?.bursts ?? 0;
    });
    await page.waitForFunction(() => {
      const player = window.__BREACHLINE__.handlingAudit()?.authority?.player;
      return Boolean(player && player.alive);
    }, null, { timeout: 30000 }).catch(() => null);
    const fired = await page.evaluate(fire(90));
    await page.waitForFunction(() => (window.__RIFLE_VIEW__?.bursts ?? 0) > (window.__RIFLE_VIEW_BASE__ ?? 0),
      null, { timeout: 4000 }).catch(() => null);
    await page.waitForTimeout(250);
    const snapshot = await page.evaluate(read);
    const drawn = (snapshot.view?.bursts ?? 0) - (snapshot.base ?? 0);
    attempts.push({ attempt, reason: fired.reason, bursts: drawn, sprites: snapshot.view?.sprites ?? null,
      frames: (snapshot.frames ?? []).length, placeholderVisible: snapshot.view?.placeholderVisible ?? null,
      ammo: snapshot.ammo });
    if (drawn >= 1 && (snapshot.frames ?? []).length) caught = { snapshot, drawn };
  }
  await page.keyboard.press('Escape');
  if (!caught) {
    const last = await page.evaluate(read);
    throw Error('No rifle shot drew the rifle\'s own first-person flash: '
      + JSON.stringify({ attempts, lastView: last.view, frames: (last.frames ?? []).length }));
  }
  const snapshot = caught.snapshot, view = snapshot.view;
  const frames = snapshot.frames ?? [];
  const unit = 0.0254;

  // --- the weapon's own system, on the viewmodel's own muzzle ------------------------------
  if (view.weapon !== before.primary)
    throw Error(`The viewmodel reported ${view.weapon}, not the held ${before.primary}`);
  if (view.lastBurst?.system !== RIFLE_SYSTEM)
    throw Error(`The first-person flash used ${view.lastBurst?.system}, not its own ${RIFLE_SYSTEM}`);
  if (!RIFLE_WEAPONS.includes(view.lastBurst?.weapon))
    throw Error('The first-person flash was drawn for ' + view.lastBurst?.weapon);
  if (view.lastBurst?.attachment !== 'muzzle')
    throw Error('The first-person flash was not anchored on the viewmodel\'s own muzzle attachment: '
      + JSON.stringify(view.lastBurst));
  if (view.placeholderVisible !== false)
    throw Error('The port\'s own muzzle cone was still drawn as the rifle\'s flash');
  const unverified = Object.entries(view.hashVerified ?? {}).filter(([, ok]) => !ok).map(([name]) => name);
  if (unverified.length) throw Error('The rifle flash did not verify its staged bytes: ' + unverified.join(', '));

  const anchor = view.lastBurst.at, forward = view.lastBurst.forward;
  if (!(Math.hypot(...anchor) <= 1.5))
    throw Error('The first-person flash was anchored outside the viewmodel scene: ' + JSON.stringify(anchor));
  if (Math.abs(Math.hypot(...forward) - 1) > 1e-3)
    throw Error('The first-person flash was given a non-unit forward axis: ' + JSON.stringify(forward));

  // --- each of the four original subsystems, at its own parameters -------------------------
  const spec = view.configuration ?? {};
  const vent = spec.vent, glow = spec.glow, flame = spec.flame, continuous = spec.continuous;
  for (const [name, part] of [['vent', vent], ['glow', glow], ['flame', flame], ['continuous', continuous]])
    if (!part) throw Error(`The rifle's own chain no longer reports its ${name} parameters: ` + JSON.stringify(Object.keys(spec)));
  for (const [name, key] of [['vent', 'distanceMax'], ['flame', 'distanceMax'], ['flame', 'radiusMin'],
    ['flame', 'radiusMax'], ['glow', 'radius'], ['continuous', 'positionMaximum']])
    if ((name === 'vent' ? vent : name === 'glow' ? glow : name === 'flame' ? flame : continuous)[key] === undefined)
      throw Error(`The rifle's own ${name} no longer reports ${key}: ` + JSON.stringify(spec[name]));

  const rows = { vent: [], glow: [], flame: [], continuous: [] };
  for (const frame of frames)
    for (const kind of Object.keys(rows)) for (const row of frame[kind] ?? []) rows[kind].push(row);
  const peaks = {};
  for (const frame of frames)
    for (const kind of Object.keys(rows)) peaks[kind] = Math.max(peaks[kind] ?? 0, (frame[kind] ?? []).length);
  // Each subsystem has to have drawn its own whole emission in some frame: one vent sprite,
  // one glow, the flame's own eight and the continuous flame's own nine.
  const expected = { vent: vent.count, glow: glow.count, flame: flame.count, continuous: continuous.count };
  for (const [kind, count] of Object.entries(expected))
    if (!((peaks[kind] ?? 0) >= count))
      throw Error(`The rifle's own ${kind} drew ${peaks[kind] ?? 0} sprites at most, not its own ${count}`
        + ` (totals ${JSON.stringify(view.sprites)})`);
  const spriteRows = [];
  const check = (kind, row, spec0) => {
    // Each row carries the anchor of the burst it was drawn for: a second shot moves the
    // viewmodel's muzzle, so measuring an older sprite against the latest anchor would be
    // measuring it against the wrong muzzle.
    if (!Array.isArray(row.anchor) || !Array.isArray(row.forward))
      throw Error(`A ${kind} sprite did not report the anchor it was drawn at: ` + JSON.stringify(row));
    const base = row.anchor, axis = row.forward;
    const offset = [row.position[0] - base[0], row.position[1] - base[1], row.position[2] - base[2]];
    const away = Math.hypot(...offset);
    const along = offset[0] * axis[0] + offset[1] * axis[1] + offset[2] * axis[2];
    spriteRows.push({ kind, away: +away.toFixed(5), along: +along.toFixed(5), radius: row.radius,
      alpha: row.alpha, age: row.age, distance: row.distance ?? null });
    // The two swept subsystems leave forward from the muzzle; the vent is spawned inside a
    // 0.1 unit sphere centred on it, so one of its sprites may legitimately sit marginally
    // behind, and it is held to that sphere instead.
    if ((kind === 'flame' || kind === 'continuous') && along < -1e-6)
      throw Error(`The rifle's own ${kind} was drawn behind the muzzle`);
    if (kind === 'glow' && !(away <= 1e-6))
      throw Error(`The rifle's own glow was drawn ${away} m from the muzzle, not on it`);
    if (kind === 'vent' && !(away <= spec0.distanceMax * unit + 1e-6))
      throw Error(`The rifle's own vent sprite was drawn ${away} m from the muzzle, outside its own `
        + `${spec0.distanceMax * unit} m spawn sphere`);
    if (kind === 'flame' && !(away <= spec0.distanceMax * unit + 1e-6))
      throw Error(`The rifle's own flame was drawn ${away} m from the muzzle, outside its own `
        + `${spec0.distanceMax * unit} m path`);
    if (kind === 'continuous' && !(away <= (spec0.positionMaximum[0] + (spec0.offsetMax ?? 0)) * unit + 1e-6))
      throw Error(`The rifle's own continuous flame was drawn ${away} m from the muzzle, outside its own sweep`);
    const radiusLow = spec0.radiusMin !== undefined ? Math.min(spec0.radiusMin, spec0.radiusMax) * unit
      : spec0.radius !== undefined ? spec0.radius * unit : null;
    const radiusHigh = spec0.radiusMin !== undefined ? Math.max(spec0.radiusMin, spec0.radiusMax) * unit
      : spec0.radius !== undefined ? spec0.radius * unit : null;
    if (radiusLow !== null && !(row.radius >= radiusLow - 1e-9 && row.radius <= radiusHigh + 1e-9))
      throw Error(`A ${kind} sprite is ${row.radius} m wide, outside its own ${radiusLow}..${radiusHigh}`);
    if (spec0.alphaMin !== undefined || spec0.alphaMax !== undefined) {
      const high = (spec0.alphaMax ?? spec0.alphaMin) / 255;
      if (!(row.alpha >= 0 && row.alpha <= high + 1e-9))
        throw Error(`A ${kind} sprite has alpha ${row.alpha}, outside its own window ${high}`);
    }
  };
  for (const kind of Object.keys(rows)) for (const row of rows[kind])
    check(kind, row, kind === 'vent' ? vent : kind === 'glow' ? glow : kind === 'flame' ? flame : continuous);

  // The captured frame is auxiliary: a WebGL canvas readback can legitimately be refused.
  let canvasImage = { status: 'the page never caught a frame with the original sprites' };
  if (snapshot.capture?.png?.startsWith('data:image/png;base64,')) {
    const bytes = Buffer.from(snapshot.capture.png.slice('data:image/png;base64,'.length), 'base64');
    if (bytes.byteLength > 2048) {
      const file = resolve(outputDir, 'source-rifle-flash-first-person-frame.png');
      writeFileSync(file, bytes);
      canvasImage = { file: file.slice(root.length + 1), bytes: bytes.byteLength,
        sprites: { vent: snapshot.capture.vent, glow: snapshot.capture.glow,
          flame: snapshot.capture.flame, continuous: snapshot.capture.continuous } };
    } else canvasImage = { status: 'the canvas readback came back empty' };
  } else if (snapshot.capture) canvasImage = { status: 'the browser refused the canvas readback' };

  const evidence = {
    status: 'passed-original-rifle-first-person-flash-in-game',
    scope: 'The local player in a real browser on the shipped de_dust2, holding the training loadout\'s own assault '
      + 'rifle: a shot drew the weapon\'s own `muzzle_flash_effect_1st_person` in the viewmodel scene, on the '
      + 'viewmodel\'s own muzzle attachment, as its own `_vent` sprite, `_main` flame, glow and continuous flame, '
      + 'with the port\'s own cone hidden.',
    url: base, viewTurn: [800, 0], attempts,
    held: { primary: before.primary, secondary: before.secondary, money: before.money },
    firstPerson: { system: RIFLE_SYSTEM, programVersion: view.programVersion, weapon: view.lastBurst.weapon,
      shooter: view.lastBurst.shooter, shot: view.lastBurst.shot, attachment: view.lastBurst.attachment,
      anchor, forward, space: view.space, spaceUnitMetres: unit,
      placeholderHidden: view.placeholderVisible === false, bursts: view.bursts, base: snapshot.base,
      sprites: view.sprites, peaks, expected, spriteRows, frames, limitations: view.limitations,
      spec: { vent, glow, flame, continuous }, hashVerified: view.hashVerified, capture: canvasImage },
    errors,
    boundary: 'Reads the original systems the port drew for the shooter\'s own rifle shot; it does not compare them '
      + 'against a recording of the original. The captured canvas frame is auxiliary; the assertion is the sprite '
      + 'rows the renderer itself wrote. The original\'s one unsimulated child of the vent is reported by the '
      + 'program rather than drawn.',
  };
  writeFileSync(resolve(outputDir, 'source-rifle-flash-ingame.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify({
    status: evidence.status, attempts,
    held: evidence.held,
    firstPerson: { system: RIFLE_SYSTEM, weapon: view.lastBurst.weapon, anchor, forward,
      placeholderHidden: view.placeholderVisible === false, peaks, expected, sprites: view.sprites,
      spriteRows: spriteRows.length, capture: canvasImage.file ?? canvasImage.status },
    errors }, null, 2) + '\n');
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await browser.close();
}
