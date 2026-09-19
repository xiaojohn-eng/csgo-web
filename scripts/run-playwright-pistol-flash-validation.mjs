#!/usr/bin/env node
// The original pistol muzzle flash, tested in one pass, two ways.
//
// A. Deterministic data preview (its own child server on 27024): the same original
//    main/core graph the game draws, frozen at fixed clock times, so the 25 ms
//    flash becomes something that can actually be looked at and compared. Every
//    image is written with the readout the page itself printed.
// B. Real game, real LAN service, three browser clients on 27019:
//      first person  - the shooter's own viewmodel really emitted and drew the
//                      original main and core particles (audit frames, SHA state);
//                      a canvas capture is attempted at the first frame that has
//                      particles, and reported honestly when the browser refuses it.
//      third person  - the observer drew the flash on the shooter's world weapon,
//                      with the weapon's own original system, anchored on the
//                      shooter's rendered body.
//
// The LAN service is assumed to be up (npm run source:start); the preview server is
// started and stopped by this script.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.PISTOL_FLASH_BASE || 'http://127.0.0.1:27019';
const previewUrl = 'http://127.0.0.1:27024/';
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const roomName = `Dust2 R9 手枪枪口 ${Date.now() % 10000}`;
const SHOOTER = 'Pistol Shooter';
const FILLER = 'Pistol Filler';
const OBSERVER = 'Pistol Observer';
const PISTOL_WEAPONS = ['glock', 'usp', 'deagle'];
const PISTOL_SYSTEM = 'weapon_muzzle_flash_pistol';
const issues = [];
const errors = [];

const startPreview = async () => {
  const child = spawn(process.execPath, ['scripts/serve-source-pistol-particles.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  child.stdout.on('data', (chunk) => log.push(String(chunk)));
  child.stderr.on('data', (chunk) => log.push(String(chunk)));
  for (let attempt = 0; attempt < 90; attempt++) {
    try { const r = await fetch(previewUrl); if (r.ok) return { child, log }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGTERM');
  throw Error('pistol particle preview server did not come up: ' + log.join('').trim().slice(0, 400));
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: process.env.PISTOL_FLASH_HEADED ? false : true,
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader'],
});
let preview;
try {
  // ---------------------------------------------------------------- A. preview
  preview = await startPreview();
  const previewContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const previewPage = await previewContext.newPage();
  previewPage.on('pageerror', (e) => errors.push(`preview pageerror: ${e}`));
  previewPage.on('console', (m) => { if (m.type() === 'error') errors.push(`preview console: ${m.text()}`); });
  await previewPage.goto(previewUrl, { waitUntil: 'domcontentloaded' });
  await previewPage.waitForFunction(() => (document.querySelector('#status')?.textContent ?? '').includes('27 类原算子'), null, { timeout: 60000 });
  const status = await previewPage.textContent('#status');
  // Freeze the slow-motion loop so a captured frame is exactly the asked clock.
  await previewPage.uncheck('#playing');
  const frames = [];
  for (const [mode, time] of [['main', 2], ['both', 10], ['core', 10], ['both', 20]]) {
    await previewPage.selectOption('#mode', mode);
    await previewPage.$eval('#clock', (input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, time);
    await previewPage.waitForTimeout(400);
    const readout = (await previewPage.textContent('#readout')) ?? '';
    const file = resolve(outputDir, `source-pistol-flash-${mode}-${String(time).replace('.', '_')}ms.png`);
    await previewPage.locator('#particle-canvas').screenshot({ path: file });
    frames.push({ mode, millis: time, readout, image: file.slice(root.length + 1) });
  }
  await previewContext.close();

  // ------------------------------------------------------------- B. real game
  const observe = (page, label) => {
    page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`); });
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
  /** The shooter's own first-person state: the viewmodel attachment the original
   * chose, the staged resource receipts, and the frames the original main/core
   * actually drew inside the gun scene. */
  const readFirstPerson = (page) => page.evaluate(() => {
    const audit = window.__BREACHLINE__?.runtime?.()?.art?.assetAudit?.() ?? null;
    const fx = audit?.sourcePistolFx ?? null, particles = audit?.sourcePistolParticles ?? null;
    return {
      fx: fx ? { version: fx.version, weapon: fx.weapon, muzzleAttachment: fx.muzzleAttachment,
        muzzlePosition: fx.muzzlePosition, particleRenderer: fx.particleRenderer } : null,
      particles: particles ? { version: particles.version, bursts: particles.bursts, space: particles.space,
        hashVerified: particles.hashVerified, current: particles.current,
        frames: (particles.recentFrames ?? []).map((frame) => ({ counts: frame.counts, drawn: frame.particles.length })),
        limitations: particles.limitations } : null,
    };
  });
  const readRemote = (page) => page.evaluate(() => {
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
    return p ? { weapon: p.weapon, secondary: p.secondary, ammo: p.ammo, team: p.team, alive: p.alive } : null;
  }, SHOOTER);

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

  // A paused online client keeps rendering the world and receiving authority.
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

  await shooter.keyboard.press('Digit2');
  await shooter.waitForTimeout(1500);          // the original deploy has to finish first
  const shooterState = await readShooter(shooter);
  const before = { first: await readFirstPerson(shooter), remote: await readRemote(observer) };

  // Grab the real gun-scene canvas on the first frame that has original particles:
  // a 25 ms effect cannot be captured by a screenshot round trip.
  await shooter.evaluate(() => {
    window.__PISTOL_FLASH_FRAME__ = null;
    const loop = () => {
      const particles = window.__BREACHLINE__?.runtime?.()?.art?.assetAudit?.()?.sourcePistolParticles;
      const counts = particles?.current?.counts;
      if (counts && (counts.main || counts.core)) {
        const canvas = document.querySelector('canvas');
        window.__PISTOL_FLASH_FRAME__ = { counts, png: canvas ? canvas.toDataURL('image/png') : '' };
        return;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  const ammoBefore = shooterState?.ammo ?? null;
  let shots = 0;
  for (let attempt = 0; attempt < 10 && shots < 4; attempt++) {
    await shooter.mouse.down();
    await shooter.waitForTimeout(90);
    await shooter.mouse.up();
    await shooter.waitForTimeout(420);
    const now = await readShooter(shooter);
    if (typeof now?.ammo === 'number' && typeof ammoBefore === 'number' && now.ammo < ammoBefore) shots = ammoBefore - now.ammo;
  }
  const ammoAfter = (await readShooter(shooter))?.ammo ?? null;
  const captured = await shooter.evaluate(() => window.__PISTOL_FLASH_FRAME__ ?? null);
  await shooter.waitForTimeout(800);
  const after = { first: await readFirstPerson(shooter), remote: await readRemote(observer) };
  await shooter.screenshot({ path: resolve(outputDir, 'source-pistol-flash-first-person.png') });
  await observer.screenshot({ path: resolve(outputDir, 'source-pistol-flash-third-person.png') });

  let canvasImage = null;
  if (captured?.png?.startsWith('data:image/png;base64,')) {
    const bytes = Buffer.from(captured.png.slice('data:image/png;base64,'.length), 'base64');
    if (bytes.byteLength > 2048) {
      const file = resolve(outputDir, 'source-pistol-flash-first-person-frame.png');
      writeFileSync(file, bytes);
      canvasImage = { file: file.slice(root.length + 1), bytes: bytes.byteLength, counts: captured.counts };
    }
  }

  // ------------------------------------------------------------- assertions
  const first = after.first, particles = first.particles, delta = after.remote;
  if (!particles) issues.push('the shooter reported no first-person pistol particle state at all');
  else {
    if (particles.version !== 'csgo-pistol-main-core-12426148-r2')
      issues.push(`the first-person flash used ${particles.version}, not the staged original main/core`);
    const unverified = Object.entries(particles.hashVerified ?? {}).filter(([, ok]) => !ok).map(([name]) => name);
    if (unverified.length) issues.push(`the first-person flash did not verify: ${unverified.join(', ')}`);
    if (!(shots > 0)) issues.push(`the shooter never fired its pistol (ammo ${ammoBefore} -> ${ammoAfter})`);
    else if (!((particles.bursts ?? 0) - (before.first?.particles?.bursts ?? 0) >= shots))
      issues.push(`the first-person flash started ${(particles.bursts ?? 0) - (before.first?.particles?.bursts ?? 0)} bursts for ${shots} shots`);
    const frames = particles.frames ?? [];
    if (!frames.length) issues.push('the first-person renderer never drew a frame with original particles');
    if (!frames.some((f) => f.counts.main > 0))
      issues.push('the first-person main subsystem never drew any particle');
    if (!frames.some((f) => f.counts.core > 0))
      issues.push('the first-person core subsystem never drew any particle');
  }
  if (!first.fx) issues.push('the shooter reported no original first-person attachment state');
  else {
    if (first.fx.weapon !== 'glock') issues.push(`the shooter held ${first.fx.weapon}, not the pistol this test expects`);
    if (first.fx.particleRenderer !== 'csgo-pistol-main-core-12426148-r2')
      issues.push(`the viewmodel reports ${first.fx.particleRenderer} instead of the staged original particles`);
  }
  if (!delta) issues.push('the observer reported no third-person muzzle state');
  else {
    const drawn = (delta.systems?.[PISTOL_SYSTEM]?.bursts ?? 0) - (before.remote?.systems?.[PISTOL_SYSTEM]?.bursts ?? 0);
    if (!(drawn > 0)) issues.push(`the observer drew no original third-person pistol flash (decisions ${JSON.stringify(delta.reasons)})`);
    if (!((delta.reasons?.ok ?? 0) > 0)) issues.push('the third-person flash was not accounted for by the authoritative fire state');
    const burst = delta.lastBurst;
    if (!burst) issues.push('the observer reported no third-person flash detail');
    else {
      if (burst.system !== PISTOL_SYSTEM) issues.push(`the third-person flash used ${burst.system}, not ${PISTOL_SYSTEM}`);
      if (!PISTOL_WEAPONS.includes(burst.weapon)) issues.push(`the third-person flash was drawn for ${burst.weapon}`);
      if (delta.shooter?.name !== SHOOTER) issues.push(`the third-person flash was drawn for ${delta.shooter?.name ?? 'nobody'}`);
      if (!delta.shooterAt) issues.push('the observer could not locate the shooter it anchored the flash on');
      else {
        const away = Math.hypot(burst.at[0] - delta.shooterAt[0], burst.at[1] - delta.shooterAt[1], burst.at[2] - delta.shooterAt[2]);
        delta.anchorDistance = +away.toFixed(4);
        if (!(away < 2.5)) issues.push(`the third-person flash was anchored ${away.toFixed(2)}m from the shooter's own body`);
      }
    }
  }
  if (errors.length) issues.push(`browser errors: ${errors.slice(0, 3).join(' | ')}`);

  const evidence = { scope: 'Original pistol muzzle flash: deterministic main/core frames and both in-game perspectives',
    base, previewUrl, room: roomName, preview: { status, frames }, shooterState,
    firstPerson: first, thirdPerson: delta, shots, ammo: [ammoBefore, ammoAfter], canvasImage, teams, errors, issues };
  writeFileSync(resolve(outputDir, 'source-pistol-flash-evidence.json'), JSON.stringify(evidence, null, 2));

  console.log('PISTOL FLASH TEST', issues.length ? 'FAILED' : 'PASSED');
  console.log(`  deterministic main/core: ${frames.map((f) => `${f.mode}@${f.millis}ms ${f.readout.split(' · ').slice(0, 2).join(' ')}`).join(' | ')}`);
  console.log(`  first person: ${particles?.version ?? 'not loaded'}, ${particles?.bursts ?? 0} bursts for ${shots} shots`
    + ` (ammo ${ammoBefore} -> ${ammoAfter}), attachment ${first.fx?.muzzleAttachment ?? '?'}`
    + `, frames ${JSON.stringify((particles?.frames ?? []).slice(-3))}`);
  console.log(`  third person: drew ${(delta?.systems?.[PISTOL_SYSTEM]?.bursts ?? 0) - (before.remote?.systems?.[PISTOL_SYSTEM]?.bursts ?? 0)}`
    + `, last ${delta?.lastBurst?.weapon ?? '?'} / ${delta?.lastBurst?.system ?? '?'} anchored ${delta?.anchorDistance ?? '-'}m`);
  console.log(`  gun-scene frame capture: ${canvasImage ? `${canvasImage.bytes} bytes at ${JSON.stringify(canvasImage.counts)}` : 'browser refused the canvas readback'}`);
  for (const issue of issues) console.log(`  - ${issue}`);
  if (issues.length) process.exitCode = 1;
} finally {
  await browser.close();
  if (preview) preview.child.kill('SIGTERM');
}
