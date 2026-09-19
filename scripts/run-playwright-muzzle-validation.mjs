#!/usr/bin/env node
// The original third-person muzzle flash, verified in a real browser.
//
// This build stages two original muzzle systems: the pistol family's
// `weapon_muzzle_flash_pistol` (its own main/core graph) and the rifle family's
// `weapon_muzzle_flash_assaultrifle` (its own vent sprite). Both are drawn on the
// shooter's world weapon, so the same observer has to see both.
//
// A client always renders its own team, so the observer has to be a human on the
// shooter's team; the room balances humans onto the side with fewer of them, which
// is why a filler client holds the other side. The observer is then left paused,
// because a paused client keeps rendering the world (and keeps receiving the
// authoritative state) while the shooter keeps the pointer lock it needs to fire.
//
// It asserts that the observer drew each flash with the weapon's own original
// system, that each shot is accounted for by the authoritative fire state, and that
// each flash was anchored on the shooter's own rendered world weapon.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.MUZZLE_VALIDATION_BASE || 'http://127.0.0.1:27019';
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const roomName = `Dust2 R8 枪口验证 ${Date.now() % 10000}`;
const SHOOTER = 'Muzzle Shooter';
const FILLER = 'Muzzle Filler';
const OBSERVER = 'Muzzle Observer';
const PISTOL_WEAPONS = ['glock', 'usp', 'deagle'];
const RIFLE_WEAPONS = ['vandal', 'm4a4'];
const PISTOL_SYSTEM = 'weapon_muzzle_flash_pistol';
const RIFLE_SYSTEM = 'weapon_muzzle_flash_assaultrifle';
const issues = [];
const errors = [];

const observe = (page, label) => {
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`); });
};
// A. The same three original subsystems baked at fixed clock times, so the 15 ms
//    effect can actually be looked at instead of only counted. This runs its own child
//    server on 27025 against the staged bytes the game itself fetches.
const previewUrl = 'http://127.0.0.1:27025/';
const bakePreview = async (browser) => {
  let child = null,page = null;
  const log = [],unstaged = [];
  const start = async () => {
    child = spawn(process.execPath, ['scripts/serve-source-rifle-muzzle.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (b) => log.push(String(b).trim()));
    child.stderr.on('data', (b) => errors.push(`preview: ${String(b).trim()}`));
    for (let attempt = 0; attempt < 40; attempt++) {
      try { const r = await fetch(previewUrl); if (r.ok) return; } catch { /* not up yet */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('the rifle muzzle preview server never came up');
  };
  try {
    await start();
    page = await browser.newPage();
    // The closure ships seven textures but only the ones a ported subsystem draws are
    // staged, so the page asks for four that are deliberately absent and reports them
    // as not staged. Those 404s are the expected condition, not a browser error, so
    // they are recorded by URL instead of being counted as failures.
    page.on('pageerror', (e) => errors.push(`preview pageerror: ${e}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`preview console: ${m.text()}`);
    });
    page.on('response', (r) => { if (r.status() === 404) unstaged.push(r.url().slice(previewUrl.length)); });
    await page.goto(previewUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__sourceRifleMuzzleProof?.status === 'original-assaultrifle-muzzle-renderer-ready', null, { timeout: 120000 });
    const proof = await page.evaluate(() => window.__sourceRifleMuzzleProof);
    const frames = [];
    for (const [label, deltas] of [['0 ms', [0]], ['5 ms', [0.005]], ['12 ms', [0.012]]]) {
      const readout = await page.evaluate((steps) => {
        const frames = window.__sourceRifleMuzzleControl.run(steps, 0, 740);
        const last = frames.at(-1);
        return { counts: { vent: last.count, glow: last.glowCount, flame: last.flameCount, continuousFlame: last.continuousCount, dropped: last.dropped },
          flame: last.flame.map((f) => ({ distance: +f.distance.toFixed(3), radius: +f.radius.toFixed(3), alpha: +f.alpha.toFixed(3), sequence: f.sequence, frame: f.frame })),
          continuousFlame: last.continuous.map((f) => ({ distance: +f.distance.toFixed(3), radius: +f.radius.toFixed(3), alpha: +f.alpha.toFixed(3), sequence: f.sequence, frame: f.frame })),
          readout: document.querySelector('#readout').textContent };
      }, deltas);
      await page.waitForTimeout(120);
      const file = resolve(outputDir, `source-rifle-muzzle-preview-${label.replace(/[^0-9a-z]/gi, '')}.png`);
      await page.locator('#particle-canvas').screenshot({ path: file });
      frames.push({ at: label, image: file.slice(root.length + 1), ...readout });
    }
    // The AWP's own chain: a continuous flame whose particles are born over its 7.5 ms
    // emission window, plus the flare it parents. Baking inside that window shows the
    // burst growing, which a single frame could not.
    await page.waitForFunction(() => window.__sourceAwpMuzzleProof?.status === 'original-awp-muzzle-renderer-ready', null, { timeout: 120000 });
    const awp = await page.evaluate(() => window.__sourceAwpMuzzleProof);
    const awpFrames = [];
    for (const [label, deltas] of [['4 ms', [0.004]], ['10 ms', [0.01]], ['22 ms', [0.022]]]) {
      const readout = await page.evaluate((steps) => window.__sourceAwpMuzzleControl.run(steps, 0, 740), deltas);
      await page.waitForTimeout(120);
      const file = resolve(outputDir, `source-awp-muzzle-preview-${label.replace(/[^0-9a-z]/gi, '')}.png`);
      await page.locator('#particle-canvas').screenshot({ path: file });
      awpFrames.push({ at: label, image: file.slice(root.length + 1), ...readout });
    }
    // A bake that renders nothing is still a file, so the frames are required to differ:
    // the burst grows through its own emission window and the sprites move with it.
    const distinctFrames = new Set(awpFrames.map((frame) => frame.image && readFileSync(resolve(root, frame.image)))).size;
    return { status: 'baked', previewUrl, proof, frames, awp: { proof: awp, frames: awpFrames, distinctFrames },
      unstagedTextures: [...new Set(unstaged)].sort() };
  } finally {
    await page?.close?.().catch?.(() => {});
    child?.kill?.('SIGTERM');
  }
};
const boot = async (context, label, callsign) => {
  const page = await context.newPage();
  observe(page, label);
  await page.goto(`${base}/?map=de_dust2`);
  await page.waitForFunction(
    () => window.__BREACHLINE__?.assetAudit()?.character?.id?.startsWith('csgo-t-ak-12426148') &&
      window.__BREACHLINE__?.assetAudit()?.counterTerrorist?.id?.startsWith('csgo-ct-ak-12426148'),
    null, { timeout: 240000 },
  );
  await page.getByRole('textbox', { name: '呼号', exact: true }).fill(callsign);
  return page;
};
/** What the observer's scene drew, per original system, plus the last burst detail
 * and the rendered position of the shooter it anchored on. */
const readFlash = (page) => page.evaluate(() => {
  const runtime = window.__BREACHLINE__?.runtime?.();
  const audit = runtime?.art?.assetAudit?.()?.sourceWorldMuzzle ?? null;
  if (!audit) return null;
  const shooter = [...(runtime?.art?.actors ?? [])].find(([id]) => id === audit.lastBurst?.shooter)?.[1];
  const e = shooter?.matrixWorld?.elements;
  const player = window.__BREACHLINE__?.snapshot?.()?.players?.find((p) => p.id === audit.lastBurst?.shooter) ?? null;
  return { bursts: audit.bursts, reasons: audit.reasons, systems: audit.systems, lastBurst: audit.lastBurst,
    shooterAt: e ? [e[12], e[13], e[14]] : null,
    shooter: player ? { name: player.name, bot: !!player.bot, team: player.team, weapon: player.weapon } : null };
});
const readShooter = (page) => page.evaluate((name) => {
  const p = window.__BREACHLINE__?.snapshot?.()?.players?.find((q) => q.name === name);
  return p ? { name: p.name, weapon: p.weapon, secondary: p.secondary, ammo: p.ammo, team: p.team } : null;
}, SHOOTER);
/** One trigger pull, then read the authoritative ammunition back: the flash is
 * only meaningful for a shot the authority actually booked. */
const fireShots = async (page, wanted) => {
  const before = (await readShooter(page))?.ammo ?? null;
  let fired = 0;
  for (let attempt = 0; attempt < 10 && fired < wanted; attempt++) {
    await page.mouse.down();
    await page.waitForTimeout(90);
    await page.mouse.up();
    await page.waitForTimeout(420);
    const now = await readShooter(page);
    if (typeof now?.ammo === 'number' && typeof before === 'number' && now.ammo < before) fired = before - now.ammo;
  }
  await page.waitForTimeout(700);
  return { before, after: (await readShooter(page))?.ammo ?? null, fired };
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: process.env.MUZZLE_VALIDATION_HEADED ? false : true,
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader'],
});
try {
  // The deterministic bake first: it needs no room and it is the only way to look at
  // the 15 ms effect, because a screenshot round trip cannot catch it in the game.
  const preview = await bakePreview(browser);
  preview.issues = [];
  if (!preview.frames?.length) preview.issues.push('the preview baked no frames');
  for (const frame of preview.frames ?? []) {
    if (frame.counts?.vent !== 1) preview.issues.push(`the preview's ${frame.at} frame drew ${frame.counts?.vent} vent sprites, not the original one`);
    if (frame.counts?.glow !== 1) preview.issues.push(`the preview's ${frame.at} frame drew ${frame.counts?.glow} glow sprites, not the original one`);
    if (frame.counts?.flame !== 8) preview.issues.push(`the preview's ${frame.at} frame drew ${frame.counts?.flame} flame sprites, not the original eight`);
    if (!(frame.flame?.length === 8)) preview.issues.push(`the preview's ${frame.at} flame readout is incomplete`);
  }
  // The AWP's chain is continuous, so its burst grows over its own 7.5 ms window and is
  // whole from 10 ms on: nine flame sprites and three glow sprites, swept forward.
  const awpFrames = preview.awp?.frames ?? [];
  if (awpFrames.length !== 3) preview.issues.push('the preview baked no AWP frames');
  const whole = awpFrames.find((frame) => frame.at === '10 ms');
  if (!whole) preview.issues.push('the preview baked no whole AWP burst');
  else {
    if (whole.flameCount !== 9) preview.issues.push(`the AWP preview drew ${whole.flameCount} flame sprites, not the original nine`);
    if (whole.glowCount !== 3) preview.issues.push(`the AWP preview drew ${whole.glowCount} glow sprites, not the original three`);
    if (!(whole.flame?.[8]?.distance > whole.flame?.[0]?.distance))
      preview.issues.push('the AWP preview did not sweep its flame forward along the barrel');
    if (!(whole.flame?.[8]?.radius < whole.flame?.[0]?.radius))
      preview.issues.push('the AWP preview did not thin its flame along the barrel');
  }
  if ((preview.awp?.distinctFrames ?? 0) !== 3)
    preview.issues.push(`the AWP preview baked ${preview.awp?.distinctFrames} distinct frames of 3, so a frame drew nothing`);
  const early = awpFrames.find((frame) => frame.at === '4 ms');
  if (early && !(early.flameCount > 0 && early.flameCount < 9))
    preview.issues.push(`the AWP preview's 4 ms frame drew ${early.flameCount} flame sprites, so the burst did not grow through its emission window`);
  // The dispatcher's other flame emits continuously, so its sprites appear as their
  // births pass: nothing at the shot itself, the whole batch by 12 ms, sweeping forward.
  const baked = preview.frames ?? [];
  const late = baked.find((frame) => frame.at === '12 ms');
  if (!late) preview.issues.push('the preview baked no 12 ms frame of the dispatcher\'s other flame');
  else {
    const counts = late.counts ?? {};
    if (!(counts.continuousFlame > 0))
      preview.issues.push(`the preview drew no sprites of the dispatcher's other flame (${counts.continuousFlame})`);
    if (counts.continuousFlame > 9)
      preview.issues.push(`the preview drew ${counts.continuousFlame} sprites of the dispatcher's other flame, more than the original nine`);
    const drawn = late.continuousFlame ?? [];
    if (drawn.length > 1 && !(drawn.at(-1).distance > drawn[0].distance))
      preview.issues.push('the dispatcher\'s other flame did not sweep forward as its particles were born');
    if (drawn.length > 1 && !(drawn.at(-1).radius < drawn[0].radius))
      preview.issues.push('the dispatcher\'s other flame did not thin out as its particles were born');
  }
  const first = baked.find((frame) => frame.at === '0 ms');
  if (first && (first.counts?.continuousFlame ?? 0) !== 0)
    preview.issues.push(`the dispatcher's other flame drew ${first.counts?.continuousFlame} sprites at the shot itself, but every one of its particles is born after it`);
  const rifleConfig = preview.proof?.configuration;
  for (const [key, wanted] of [['vent.count', 1], ['glow.count', 1], ['flame.count', 8], ['continuousFlame.count', 9],
    ['continuousFlame.alphaMin', 100], ['continuousFlame.alphaMax', 120],
    ['continuousFlame.radiusMinimum', 8], ['continuousFlame.radiusMaximum', 1],
    ['continuousFlame.sequenceMin', 5], ['continuousFlame.sequenceMax', 20]])
    if (rifleConfig?.[key.split('.')[0]]?.[key.split('.')[1]] !== wanted)
      preview.issues.push(`the preview reported ${key} ${rifleConfig?.[key.split('.')[0]]?.[key.split('.')[1]]}, not the original ${wanted}`);
  const awpConfig = preview.awp?.proof?.configuration;
  for (const [key, wanted] of [['flame.count', 9], ['glow.count', 3]])
    if (awpConfig?.[key.split('.')[0]]?.[key.split('.')[1]] !== wanted)
      preview.issues.push(`the AWP preview reported ${key} ${awpConfig?.[key.split('.')[0]]?.[key.split('.')[1]]}, not the original ${wanted}`);
  issues.push(...preview.issues);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const shooter = await boot(context, 'shooter', SHOOTER);
  await shooter.getByRole('button', { name: '创建房间', exact: true }).click();
  await shooter.getByLabel('房间名称', { exact: true }).fill(roomName);
  await shooter.getByRole('button', { name: '创建并进入房间', exact: true }).click();
  await shooter.waitForFunction((name) => window.__BREACHLINE__?.snapshot()?.players?.some((p) => p.name === name), SHOOTER);

  const joinRoom = async (page) => {
    await page.getByRole('button', { name: '局域网房间', exact: true }).click();
    await page.getByRole('listitem').filter({ hasText: roomName }).click();
    await page.getByRole('button', { name: '加入所选房间', exact: true }).click();
  };
  // The filler takes the other side so that the observer lands on the shooter's.
  const filler = await boot(context, 'filler', FILLER);
  await joinRoom(filler);
  await filler.waitForFunction((name) => window.__BREACHLINE__?.snapshot()?.players?.some((p) => p.name === name), FILLER);

  const observer = await boot(context, 'observer', OBSERVER);
  await joinRoom(observer);
  await observer.waitForFunction((name) => window.__BREACHLINE__?.snapshot()?.players?.some((p) => p.name === name), OBSERVER);
  const teams = await observer.evaluate(() => Object.fromEntries((window.__BREACHLINE__?.snapshot()?.players ?? [])
    .filter((p) => !p.bot).map((p) => [p.name, p.team])));
  if (teams[SHOOTER] !== teams[OBSERVER])
    issues.push(`the observer ended up on the other team (${JSON.stringify(teams)}), so it never renders the shooter`);

  // The observer has to be live once so its scene is running, then it can sit in
  // the menu: a paused client keeps rendering the world.
  await observer.bringToFront();
  await observer.getByRole('button', { name: '继续行动', exact: true }).click();
  await observer.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 15000 });
  await observer.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.phase === 'live', null, { timeout: 60000 });
  await observer.waitForTimeout(600);
  await observer.keyboard.press('Escape');
  await observer.getByRole('button', { name: '返回主菜单', exact: true }).waitFor({ state: 'visible', timeout: 15000 });

  await shooter.bringToFront();
  await shooter.getByRole('button', { name: '继续行动', exact: true }).click();
  await shooter.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 15000 });
  await shooter.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.phase === 'live', null, { timeout: 60000 });
  await shooter.waitForTimeout(600);

  const start = await readFlash(observer);
  if (!start) issues.push('the observer reported no third-person muzzle state at all');
  const shooterState = await readShooter(shooter);

  const phase = async (expected, weaponChoice, label) => {
    await shooter.keyboard.press(weaponChoice);
    await shooter.waitForTimeout(1500);             // the original deploy has to finish first
    const shots = await fireShots(shooter, 3);
    const flash = await readFlash(observer);
    const result = { shots, flash };
    result.drawn = (flash?.systems?.[expected]?.bursts ?? 0) - (start?.systems?.[expected]?.bursts ?? 0);
    // The rifle original dispatches a second subsystem, the additive flare; its sprites
    // are counted separately, so an increment is the evidence that both ran.
    result.glowDrawn = (flash?.systems?.[expected]?.glowSprites ?? 0) - (start?.systems?.[expected]?.glowSprites ?? 0);
    // The rifle original's third subsystem is the rolling flame, eight sprites per shot
    // across the dispatcher's own control point path.
    result.flameDrawn = (flash?.systems?.[expected]?.flameSprites ?? 0) - (start?.systems?.[expected]?.flameSprites ?? 0);
    // Its fourth is the dispatcher's other flame, which emits continuously rather than
    // all at once, so its running total is its own evidence.
    result.continuousFlameDrawn = (flash?.systems?.[expected]?.continuousFlameSprites ?? 0)
      - (start?.systems?.[expected]?.continuousFlameSprites ?? 0);
    if (!(shots.fired > 0)) issues.push(`the shooter never fired its ${label} (ammo ${shots.before} -> ${shots.after})`);
    if (!flash) issues.push(`the observer reported no third-person muzzle state after the ${label} shots`);
    else {
      if (!(result.drawn > 0))
        issues.push(`the observer drew no original ${label} flash (${expected} bursts `
          + `${start?.systems?.[expected]?.bursts ?? 0} -> ${flash.systems?.[expected]?.bursts ?? 0}, decisions ${JSON.stringify(flash.reasons)})`);
      if (expected === RIFLE_SYSTEM) {
        const glow = flash.systems?.[expected]?.configuration?.glow;
        if (!glow) issues.push('the observer reported no original rifle glow configuration');
        else {
          // The original flare's own flare, colour pair and colour-fade window.
          for (const [key, wanted] of [['count', 1], ['radius', 25], ['fadeStart', 0.7], ['fadeEnd', 1], ['animationRate', 30]])
            if (Math.fround(glow[key]) !== Math.fround(wanted))
              issues.push(`the rifle glow ran with ${key} ${glow[key]}, not the original ${wanted}`);
          if (JSON.stringify(glow.color1) !== '[255,188,189,128]' || JSON.stringify(glow.color2) !== '[130,92,75,128]')
            issues.push(`the rifle glow ran with colours ${JSON.stringify(glow.color1)} / ${JSON.stringify(glow.color2)}`);
          if (glow.colorFadeEased !== true) issues.push('the rifle glow did not ease its original colour fade');
        }
        if (!(result.glowDrawn > 0))
          issues.push(`the observer drew no original rifle glow sprites (${start?.systems?.[expected]?.glowSprites ?? 0} -> `
            + `${flash.systems?.[expected]?.glowSprites ?? 0})`);
        const flame = flash.systems?.[expected]?.configuration?.flame;
        if (!flame) issues.push('the observer reported no original rifle flame configuration');
        else {
          // The original flame's own emission count, path and windows.
          for (const [key, wanted] of [['count', 8], ['mapped', 8], ['pathLength', 17.5],
            ['distanceMax', 19], ['radiusMin', 12], ['radiusMax', 4], ['scalarMin', 4], ['scalarMax', 12],
            ['sequenceMin', 5], ['sequenceMax', 18], ['animationRate', 1]])
            if (Math.fround(flame[key]) !== Math.fround(wanted))
              issues.push(`the rifle flame ran with ${key} ${flame[key]}, not the original ${wanted}`);
          if (JSON.stringify(flame.endPoint) !== '[17.5,0,0]')
            issues.push(`the rifle flame ran with end control point ${JSON.stringify(flame.endPoint)}`);
          if (JSON.stringify(flame.color1) !== '[126,87,20,255]' || JSON.stringify(flame.color2) !== '[120,92,75,255]')
            issues.push(`the rifle flame ran with colours ${JSON.stringify(flame.color1)} / ${JSON.stringify(flame.color2)}`);
          // Eight sprites per shot, per the original emission count.
          if (result.flameDrawn !== 8 * shots.fired)
            issues.push(`the observer drew ${result.flameDrawn} original rifle flame sprites for ${shots.fired} shots, `
              + `not ${8 * shots.fired}`);
        }
        const continuous = flash.systems?.[expected]?.configuration?.continuousFlame;
        if (!continuous) issues.push('the observer reported no original continuous rifle flame configuration');
        else {
          // The dispatcher's other flame: its own emission, windows and colour. These are
          // its own numbers, not the rolling flame's, so a shared value would be wrong.
          for (const [key, wanted] of [['count', 9], ['rate', 1200], ['sequenceMin', 5], ['sequenceMax', 20],
            ['alphaMin', 100], ['alphaMax', 120], ['radiusMinimum', 8], ['radiusMaximum', 1],
            ['alphaMinimum', 0.5], ['alphaMaximum', 0], ['animationRate', 8]])
            if (Math.fround(continuous[key]) !== Math.fround(wanted))
              issues.push(`the continuous rifle flame ran with ${key} ${continuous[key]}, not the original ${wanted}`);
          if (JSON.stringify(continuous.positionMinimum) !== '[0,0,0]'
            || JSON.stringify(continuous.positionMaximum) !== '[29,0,0]')
            issues.push(`the continuous rifle flame ran with position ${JSON.stringify(continuous.positionMinimum)} -> ${JSON.stringify(continuous.positionMaximum)}`);
          if (JSON.stringify(continuous.colour1) !== '[254,233,216,255]')
            issues.push(`the continuous rifle flame ran with colour ${JSON.stringify(continuous.colour1)}`);
        }
        // It emits continuously, so within the same authoritative shots it must have drawn
        // more than nothing and at most its own original count per shot.
        if (!(result.continuousFlameDrawn > 0))
          issues.push(`the observer drew no sprites of the original continuous rifle flame (`
            + `${start?.systems?.[expected]?.continuousFlameSprites ?? 0} -> `
            + `${flash.systems?.[expected]?.continuousFlameSprites ?? 0})`);
      }
      if (!((flash.reasons?.ok ?? 0) > 0)) issues.push(`the ${label} flash was not accounted for by the authoritative fire state`);
      const burst = flash.lastBurst;
      if (!burst) issues.push(`the observer reported no ${label} flash detail`);
      else {
        if (burst.system !== expected) issues.push(`the ${label} flash used ${burst.system}, not ${expected}`);
        const allowed = expected === PISTOL_SYSTEM ? PISTOL_WEAPONS : RIFLE_WEAPONS;
        if (!allowed.includes(burst.weapon))
          issues.push(`the ${label} flash was drawn for ${burst.weapon}, which has no staged original system`);
        if (!flash.shooter) issues.push(`the ${label} flash was drawn for a shooter the snapshot does not know`);
        else if (flash.shooter.name !== SHOOTER)
          issues.push(`the ${label} flash was drawn for ${flash.shooter.name}, not the shooter that fired`);
        if (!flash.shooterAt) issues.push(`the observer could not locate the shooter it anchored the ${label} flash on`);
        else {
          const away = Math.hypot(burst.at[0] - flash.shooterAt[0], burst.at[1] - flash.shooterAt[1], burst.at[2] - flash.shooterAt[2]);
          result.anchorDistance = +away.toFixed(4);
          if (!(away < 2.5)) issues.push(`the ${label} flash was anchored ${away.toFixed(2)}m from the shooter's own body`);
        }
      }
    }
    return result;
  };

  // The pistol family first, then the rifle family the shooter's primary uses.
  const pistol = await phase(PISTOL_SYSTEM, 'Digit2', 'pistol');
  await observer.screenshot({ path: resolve(outputDir, 'source-muzzle-third-person.png') });
  // Grab the observer's real canvas on the first frame that drew the rifle flame: the
  // flame lives 15 ms, so only a same-frame capture can show what the other player saw.
  await observer.evaluate(() => {
    window.__RIFLE_MUZZLE_FRAME__ = null;
    const loop = () => {
      const systems = window.__BREACHLINE__?.runtime?.()?.art?.assetAudit?.()?.sourceWorldMuzzle?.systems;
      const audit = systems?.weapon_muzzle_flash_assaultrifle;
      if (audit?.flameSpritesThisFrame) {
        const canvas = document.querySelector('canvas');
        window.__RIFLE_MUZZLE_FRAME__ = { flame: audit.flameSpritesThisFrame, glow: audit.glowSpritesThisFrame,
          vent: audit.bursts, png: canvas ? canvas.toDataURL('image/png') : '' };
        return;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const rifle = await phase(RIFLE_SYSTEM, 'Digit1', 'rifle');
  const rifleFrame = await observer.evaluate(() => window.__RIFLE_MUZZLE_FRAME__ ?? null);
  let rifleImage = null;
  if (rifleFrame?.png?.startsWith('data:image/png;base64,')) {
    const bytes = Buffer.from(rifleFrame.png.slice('data:image/png;base64,'.length), 'base64');
    if (bytes.byteLength > 2048) {
      const file = resolve(outputDir, 'source-muzzle-third-person-frame.png');
      writeFileSync(file, bytes);
      rifleImage = { file: file.slice(root.length + 1), bytes: bytes.byteLength,
        flame: rifleFrame.flame, glow: rifleFrame.glow };
    }
  } else issues.push('the observer could not capture the frame that drew the original rifle flame');
  await observer.screenshot({ path: resolve(outputDir, 'source-muzzle-third-person-rifle.png') });

  const result = { start, pistol, rifle, shooterState, teams };
  result.rifleImage = rifleImage;
  const after = await readFlash(observer);
  result.after = { bursts: after?.bursts ?? null, reasons: after?.reasons ?? null, systems: after?.systems ?? null };
  if (errors.length) issues.push(`browser errors: ${errors.slice(0, 3).join(' | ')}`);

  const evidence = { scope: 'Real browser, LAN service, both staged original third-person muzzle systems on a remote shooter, '
    + 'including the rifle original\'s second and third subsystems (the additive flare and the eight-sprite rolling flame)',
    base, room: roomName, preview, ...result, errors, issues };
  writeFileSync(resolve(outputDir, 'source-muzzle-lan-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log('MUZZLE VALIDATION', issues.length ? 'FAILED' : 'PASSED');
  console.log(`  shooter: ${shooterState?.weapon ?? '?'} (secondary ${shooterState?.secondary ?? '?'}) on ${shooterState?.team ?? '?'}`);
  console.log(`  observer (${teams[OBSERVER]} vs shooter ${teams[SHOOTER]}):`);
  for (const [label, row] of [['pistol', pistol], ['rifle', rifle]]) {
    const burst = row.flash?.lastBurst;
    console.log(`    ${label}: fired ${row.shots.fired} (ammo ${row.shots.before} -> ${row.shots.after}), drew ${row.drawn ?? 0}`
      + (burst ? `, last ${burst.weapon} / ${burst.system} shot ${burst.shot} anchored ${row.anchorDistance ?? '-'}m at [${burst.at.join(', ')}]` : ''));
  }
  for (const issue of issues) console.log(`  - ${issue}`);
  if (issues.length) process.exitCode = 1;
} finally {
  await browser.close();
}
