#!/usr/bin/env node
// Walks a real player out of the map's own buy zone and reads what the authority says.
//
// The unit tests prove the volumes are read, cross-checked and enforced over a scenario that
// declares them. This proves the shipped scenario declares them: in a real browser against
// the LAN service, the shop is open where the original's `func_buyzone` is and shut where it
// is not, and it comes back when the player walks back in.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.SOURCE_BUY_ZONE_BASE || 'http://127.0.0.1:27019';
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(base + '/?map=de_dust2');
  const start = page.getByRole('button', { name: /^开始人机训练/ });
  await start.waitFor({ state: 'visible', timeout: 120000 });
  await page.getByRole('textbox', { name: '呼号', exact: true }).fill('Buy Zone');
  await start.click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  const read = () => page.evaluate(() => {
    const snapshot = window.__BREACHLINE__.snapshot();
    const own = snapshot.players.find((p) => p.id === snapshot.you) ?? snapshot.players[0];
    return { canBuy: snapshot.canBuy, phase: snapshot.phase, remaining: snapshot.remaining,
      team: own?.team, x: own?.x, y: own?.y, z: own?.z };
  });
  // The round's own spawn is inside the team's volume; the authority says so.
  await page.waitForFunction(() => window.__BREACHLINE__?.snapshot?.()?.canBuy !== undefined, null, { timeout: 60000 });
  const atSpawn = await read();
  if (atSpawn.canBuy !== true) throw Error('The authority refused buying at the original spawn: ' + JSON.stringify(atSpawn));
  if (atSpawn.phase !== 'buy' && atSpawn.phase !== 'live') throw Error('Unexpected phase: ' + atSpawn.phase);
  await page.screenshot({ path: resolve(outputDir, 'source-buy-zone-inside.png') });

  // Walk out. Which way leads out depends on where the spawn faces, so both a forward and a
  // strafe direction are tried until the authority says the volume is behind the player.
  const OPPOSITE = { KeyW: 'KeyS', KeyS: 'KeyW', KeyA: 'KeyD', KeyD: 'KeyA' };
  const walk = async (key, milliseconds, want) => {
    await page.keyboard.down(key);
    const until = Date.now() + milliseconds;
    let sample = await read();
    while (Date.now() < until && sample.canBuy !== want) {
      await page.waitForTimeout(250);
      sample = await read();
    }
    await page.keyboard.up(key);
    return sample;
  };
  const walked = [];
  let outside = await read();
  for (const key of ['KeyW', 'KeyD', 'KeyS', 'KeyA']) {
    if (outside.canBuy === false) break;
    outside = await walk(key, 5000, false);
    walked.push(key);
  }
  if (outside.canBuy !== false) throw Error('The authority still allows buying after leaving the spawn area: ' + JSON.stringify(outside));
  const moved = Math.hypot(outside.x - atSpawn.x, outside.z - atSpawn.z);
  if (moved < 5) throw Error('The player did not actually move out: ' + moved.toFixed(2) + ' m');
  await page.screenshot({ path: resolve(outputDir, 'source-buy-zone-outside.png') });

  // And back in it is open again, so the rule follows the player rather than the round. The
  // player is walked back along the same axes it left by, in reverse.
  let backInside = await read();
  for (const key of [...walked].reverse()) {
    if (backInside.canBuy === true) break;
    backInside = await walk(OPPOSITE[key], 9000, true);
  }
  if (backInside.canBuy !== true) throw Error('The authority did not reopen buying after walking back to the spawn: '
    + JSON.stringify({ backInside, walked }));
  await page.keyboard.press('Escape');

  const evidence = {
    status: 'passed-original-buy-zone-in-game',
    scope: 'The local player in a real browser against the LAN service: the authority\'s own answer to '
      + 'can-buy at the map\'s spawn, after walking out of the original func_buyzone, and after walking back.',
    url: base, spawn: atSpawn, outside, backInside, metresWalkedOut: Number(moved.toFixed(2)),
    refusedOutsideTheZone: outside.canBuy === false, allowedInsideTheZone: atSpawn.canBuy === true,
    reopenedAfterWalkingBack: backInside.canBuy === true, walkKeysUsed: walked,
    errors,
    boundary: 'Reads the authority\'s snapshot field the shop is gated by. It does not measure the original '
      + 'client\'s own shop behaviour, and the volumes themselves are covered by the unit test against the '
      + 'shipped map data.',
  };
  writeFileSync(resolve(outputDir, 'source-buy-zone-ingame.json'), JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
  if (errors.length) throw Error(errors.join('\n'));
} finally { await browser.close(); }
