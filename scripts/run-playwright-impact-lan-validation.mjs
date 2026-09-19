#!/usr/bin/env node
// The original bullet hole, verified over the LAN.
//
// The single-client run proves the shots leave original holes and play original waves. This
// proves the authoritative half: the server resolves the surface from its own copy of the
// staged table and reports it in the `shot` event, so a second client — one that never fired
// — draws the same original holes at the same places and plays the same original waves.
//
// Room balancing puts the two humans who join first on opposite sides, so a filler client
// holds the other side and leaves the observer on the shooter's.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.IMPACT_VALIDATION_BASE || 'http://127.0.0.1:27019';
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const roomName = `Dust2 R8 弹着验证 ${Date.now() % 10000}`;
const SHOOTER = 'Impact Shooter';
const FILLER = 'Impact Filler';
const OBSERVER = 'Impact Observer';
const errors = [];

const observe = (page, label) => {
  page.on('pageerror', (error) => errors.push(`${label} pageerror: ${error}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`${label} console: ${message.text()}`); });
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
/** The marks this client drew, and the waves it played. */
const readMarks = (page) => page.evaluate(() => ({
  impact: window.__BREACHLINE__?.assetAudit?.()?.sourceImpact ?? null,
  audio: window.__BREACHLINE__?.audioAudit?.()?.impactSounds ?? null,
  you: window.__BREACHLINE__?.runtime?.()?.you ?? null,
  team: window.__BREACHLINE__?.snapshot?.()?.players?.find((p) => p.id === window.__BREACHLINE__?.runtime?.()?.you)?.team ?? null,
}));
/** Aim through the real pointer-locked mousemove path, then fire with the real canvas events. */
const aimAndFire = (yawOffset, pitch, rounds) => `(async () => {
  const g = window.__BREACHLINE__.runtime();
  if (!g || !document.pointerLockElement) return { reason: 'not-locked' };
  const desiredYaw = g.yaw + ${yawOffset};
  const yawDelta = Math.atan2(Math.sin(desiredYaw - g.yaw), Math.cos(desiredYaw - g.yaw));
  const pitchDelta = ${pitch} - g.pitch;
  document.dispatchEvent(new MouseEvent('mousemove', {
    movementX: -yawDelta / 0.0018, movementY: -pitchDelta / 0.0018,
  }));
  await new Promise((r) => setTimeout(r, 140));
  const canvas = g.art.renderer.domElement;
  let fired = 0;
  for (let round = 0; round < ${rounds}; round++) {
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    await new Promise((r) => setTimeout(r, 110));
    canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    await new Promise((r) => setTimeout(r, 200));
    fired++;
  }
  return { reason: 'fired', fired };
})()`;

const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const shooter = await boot(context, 'shooter', SHOOTER);
  const filler = await boot(context, 'filler', FILLER);
  const observer = await boot(context, 'observer', OBSERVER);

  await shooter.getByRole('button', { name: '创建房间', exact: true }).click();
  await shooter.getByLabel('房间名称', { exact: true }).fill(roomName);
  await shooter.getByRole('button', { name: '创建并进入房间', exact: true }).click();
  await shooter.waitForFunction((name) => window.__BREACHLINE__?.snapshot()?.players?.some((p) => p.name === name),
    SHOOTER, { timeout: 60000 });

  const joinRoom = async (page) => {
    await page.getByRole('button', { name: '局域网房间', exact: true }).click();
    await page.getByRole('listitem').filter({ hasText: roomName }).click();
    await page.getByRole('button', { name: '加入所选房间', exact: true }).click();
  };
  // The filler takes the other side so the observer lands on the shooter's.
  await joinRoom(filler);
  await filler.waitForFunction((name) => window.__BREACHLINE__?.snapshot()?.players?.some((p) => p.name === name),
    FILLER, { timeout: 60000 });
  await joinRoom(observer);
  await observer.waitForFunction((name) => window.__BREACHLINE__?.snapshot()?.players?.some((p) => p.name === name),
    OBSERVER, { timeout: 60000 });

  // Both clients have to go live once so their scenes run and their sheets are verified,
  // then the observer steps back to its menu: a paused client keeps rendering the world
  // (and keeps receiving the authoritative state) while the shooter keeps the pointer lock.
  await observer.bringToFront();
  await observer.getByRole('button', { name: '继续行动', exact: true }).click();
  await observer.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 30000 });
  await observer.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.phase === 'live', null, { timeout: 120000 });
  await observer.waitForTimeout(600);
  await observer.keyboard.press('Escape');
  await observer.getByRole('button', { name: '返回主菜单', exact: true }).waitFor({ state: 'visible', timeout: 30000 });

  await shooter.bringToFront();
  await shooter.getByRole('button', { name: '继续行动', exact: true }).click();
  await shooter.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 30000 });
  await shooter.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.phase === 'live', null, { timeout: 120000 });
  await shooter.waitForTimeout(600);
  // Both clients must have verified their sheets before a shot can mark anything.
  for (const page of [shooter, observer]) {
    await page.waitForFunction(() => {
      const audit = window.__BREACHLINE__?.assetAudit?.()?.sourceImpact;
      return !!audit && audit.atlases.length > 0 && audit.atlases.every((atlas) => atlas.verified);
    }, null, { timeout: 180000 });
    await page.waitForFunction(() => (window.__BREACHLINE__?.audioAudit?.()?.impactSounds?.records ?? 0) > 0,
      null, { timeout: 120000 });
  }
  const before = { shooter: await readMarks(shooter), observer: await readMarks(observer) };

  const rounds = [];
  for (const [yaw, pitch, shots] of [[0, -0.25, 4], [1.3, -0.3, 3], [2.6, -0.25, 3], [3.9, -0.3, 3],
    [5.2, -0.25, 3], [0.5, -0.7, 3], [3.0, -0.7, 3]]) {
    rounds.push(await shooter.evaluate(aimAndFire(yaw, pitch, shots)));
    await shooter.waitForTimeout(250);
  }
  // The observer's paused client renders and receives but does not need the pointer lock,
  // so give the remote timeline time to catch up with the last shot.
  await shooter.waitForTimeout(2500);
  const after = { shooter: await readMarks(shooter), observer: await readMarks(observer) };
  await shooter.screenshot({ path: resolve(outputDir, 'source-impact-lan-shooter.png') });
  // The observer never fired; bring its own camera back onto the wall so the marks it drew
  // are visible in the picture as well as counted in the readout.
  await observer.bringToFront();
  await observer.getByRole('button', { name: '继续行动', exact: true }).click();
  await observer.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 30000 });
  await observer.evaluate(`(() => {
    const g = window.__BREACHLINE__.runtime();
    const me = window.__BREACHLINE__.snapshot().players.find((player) => player.id === g.you);
    const marks = window.__BREACHLINE__.assetAudit().sourceImpact.marks;
    const at = marks.map((mark) => mark.surfacePoint).reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]], [0, 0, 0])
      .map((value) => value / marks.length);
    const eyeY = me.y + (me.crouch ? 1.1684 : 1.6256);
    const yaw = Math.atan2(-(at[0] - me.x), -(at[2] - me.z));
    const pitch = Math.atan2(at[1] - eyeY, Math.hypot(at[0] - me.x, at[2] - me.z));
    document.dispatchEvent(new MouseEvent('mousemove', {
      movementX: -Math.atan2(Math.sin(yaw - g.yaw), Math.cos(yaw - g.yaw)) / 0.0018,
      movementY: -(pitch - g.pitch) / 0.0018,
    }));
  })()`);
  await observer.waitForTimeout(900);
  await observer.screenshot({ path: resolve(outputDir, 'source-impact-lan-observer.png') });
  await shooter.keyboard.press('Escape');

  if (after.shooter.team !== after.observer.team)
    throw Error(`The two verified clients are on different sides: ${after.shooter.team} / ${after.observer.team}`);
  const shooterMarks = after.shooter.impact.marks;
  const observerMarks = after.observer.impact.marks;
  if (shooterMarks.length < 10) throw Error('The shooter drew too few original decals: ' + shooterMarks.length);
  if (observerMarks.length < 10)
    throw Error('The observer never drew the shooter\'s original decals: ' + observerMarks.length);
  // One authoritative decision per shot: the same surface, the same decal and the same mark.
  const key = (mark) => [mark.surfaceProp, mark.material, mark.position.map((value) => value.toFixed(4)).join(',')].join('|');
  const shooterKeys = new Set(shooterMarks.map(key));
  const observerKeys = new Set(observerMarks.map(key));
  const missing = [...shooterKeys].filter((entry) => !observerKeys.has(entry));
  if (missing.length)
    throw Error(`The observer is missing ${missing.length} of the shooter's ${shooterKeys.size} original decals: `
      + missing.slice(0, 3).join(' ; '));
  const playedShooter = after.shooter.audio.played;
  const playedObserver = after.observer.audio.played;
  if (!Object.keys(playedShooter).length) throw Error('The shooter played no original impact wave');
  if (!Object.keys(playedObserver).length) throw Error('The observer played no original impact wave');
  for (const event of Object.keys(playedObserver)) {
    if (!(playedShooter[event] > 0)) throw Error(`The observer heard ${event}, which the shooter never played`);
  }
  const evidence = {
    status: 'passed-original-bullet-impacts-over-lan',
    scope: 'One real browser fires on a real LAN room; a second real browser that never fires draws the same '
      + 'original bullet holes at the same points and plays the same original impact events, from the surface '
      + 'the authoritative trace resolved on its own copy of the staged table.',
    url: base, room: roomName, callsigns: { shooter: SHOOTER, filler: FILLER, observer: OBSERVER },
    identity: { shooter: after.shooter.you, observer: after.observer.you,
      shooterTeam: after.shooter.team, observerTeam: after.observer.team },
    rounds, shotsAttempted: rounds.reduce((sum, round) => sum + (round.fired ?? 0), 0),
    shooter: { marks: shooterMarks.length, drawn: after.shooter.impact.drawn,
      refused: after.shooter.impact.refused, surfaces: [...new Set(shooterMarks.map((mark) => mark.surfaceProp))].sort(),
      decals: [...new Set(shooterMarks.map((mark) => mark.material))].sort(),
      played: playedShooter, uniqueMarks: shooterKeys.size },
    observer: { marks: observerMarks.length, drawn: after.observer.impact.drawn,
      refused: after.observer.impact.refused, surfaces: [...new Set(observerMarks.map((mark) => mark.surfaceProp))].sort(),
      decals: [...new Set(observerMarks.map((mark) => mark.material))].sort(),
      played: playedObserver, uniqueMarks: observerKeys.size },
    atlases: { shooter: after.shooter.impact.atlases.map((atlas) => ({ name: atlas.name, sha256: atlas.sha256,
      width: atlas.width, height: atlas.height, verified: atlas.verified })),
      observer: after.observer.impact.atlases.map((atlas) => ({ name: atlas.name, sha256: atlas.sha256,
        verified: atlas.verified })) },
    sharedDeficit: missing.length,
    waves: { shooter: after.shooter.audio.records, observer: after.observer.audio.records,
      shooterVerified: Object.values(after.shooter.audio.hashVerified).length,
      observerVerified: Object.values(after.observer.audio.hashVerified).length },
    before: { shooter: before.shooter.impact?.marks?.length ?? null, observer: before.observer.impact?.marks?.length ?? null },
    errors,
    boundary: 'Reads the marks each client drew and the waves it played; it does not compare them against a '
      + 'recording of the original client, and the original `Subrect` depth fade, r_decals budget and '
      + 'draw inside `$decalScaleVariation` are not reproduced. The decal\'s fog fade is drawn - '
      + '`scripts/run-playwright-source-decal-fog-fade.mjs` measures it in pixels against the shipped '
      + 'program\'s own arithmetic.',
  };
  writeFileSync(resolve(outputDir, 'source-impact-lan-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await browser.close();
}
