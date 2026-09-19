#!/usr/bin/env node
// Breadcrumb-follow engagement diagnostic: host follows the advancing
// teammate breadcrumb and logs a rich timeline (host pos, guide, phase,
// visible enemies) to explain why contact does or does not happen.
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.DEATH_VALIDATION_BASE || 'http://127.0.0.1:27019';
const roomName = `Dust2 跟随诊断 ${Date.now() % 10000}`;

const pauseToMenu = async (page) => {
  await page.bringToFront();
  if (!(await page.getByRole('button', { name: '返回主菜单', exact: true }).isVisible()))
    await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '返回主菜单', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
};

const makeApproach = (meName) => (target) => `(() => {
  const g = window.__BREACHLINE__.runtime();
  const snap = window.__BREACHLINE__.snapshot();
  const me = snap.players.find((p) => p.name === ${JSON.stringify(meName)});
  if (!me || !me.alive) return { reason: 'dead' };
  const dx = ${target.x} - me.x, dz = ${target.z} - me.z;
  const desiredYaw = Math.atan2(-dx, -dz);
  const yawDelta = Math.atan2(Math.sin(desiredYaw - g.yaw), Math.cos(desiredYaw - g.yaw));
  document.dispatchEvent(new MouseEvent('mousemove', {
    movementX: -yawDelta / 0.0018, movementY: g.pitch / 0.0018,
  }));
  return { reason: 'approach' };
})()`;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await context.newPage();
  await host.goto(`${base}/?map=de_dust2`);
  await host.waitForFunction(
    () => window.__BREACHLINE__?.assetAudit()?.character?.id?.startsWith('csgo-t-ak-12426148'),
    null, { timeout: 180000 },
  );
  await host.getByRole('textbox', { name: '呼号', exact: true }).fill('Diag Host');
  await host.getByRole('button', { name: '创建房间', exact: true }).click();
  await host.getByLabel('房间名称', { exact: true }).fill(roomName);
  await host.getByRole('button', { name: '创建并进入房间', exact: true }).click();
  await host.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.players?.some((p) => p.name === 'Diag Host'));
  await pauseToMenu(host);

  const peer = await context.newPage();
  await peer.goto(`${base}/?map=de_dust2`);
  await peer.waitForFunction(
    () => window.__BREACHLINE__?.assetAudit()?.character?.id?.startsWith('csgo-t-ak-12426148'),
    null, { timeout: 180000 },
  );
  await peer.getByRole('textbox', { name: '呼号', exact: true }).fill('Diag Peer');
  await peer.getByRole('button', { name: '局域网房间', exact: true }).click();
  await peer.getByRole('listitem').filter({ hasText: roomName }).click();
  await peer.getByRole('button', { name: '加入所选房间', exact: true }).click();
  await peer.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.players?.filter((p) => !p.bot).length === 2);
  await pauseToMenu(peer);

  await host.bringToFront();
  await host.getByRole('button', { name: '继续行动', exact: true }).click();
  await host.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 15000 });
  await host.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.phase === 'live', null, { timeout: 25000 });
  await host.waitForTimeout(300);

  const hostApproach = makeApproach('Diag Host');
  const guideTrails = new Map();
  const hostTrail = [];
  const rows = [];
  let stuckStrikes = 0;
  let unstickSide = 1;
  const BREADCRUMB_LAG = 1200;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const snap = await host.evaluate(() => window.__BREACHLINE__?.snapshot?.());
    const me = snap.players.find((p) => p.name === 'Diag Host');
    if (!me || me.alive === false) { rows.push({ dead: true, t: 0 }); break; }
    const visibleEnemies = snap.players.filter((p) => p.team !== me.team && p.alive && p.y > -50).length;
    const deadPlayers = snap.players.filter((p) => p.alive === false).map((p) => p.name);
    const now = Date.now();
    for (const p of snap.players) {
      if (!p.bot || p.team !== me.team || p.alive !== true) continue;
      const trail = guideTrails.get(p.name) ?? [];
      trail.push({ x: p.x, z: p.z, t: now });
      while (trail.length && now - trail[0].t > 2500) trail.shift();
      guideTrails.set(p.name, trail);
    }
    hostTrail.push({ x: me.x, z: me.z, t: now });
    while (hostTrail.length && now - hostTrail[0].t > 2500) hostTrail.shift();
    const guideStates = [...guideTrails.entries()].map(([name, trail]) => ({
      name,
      moved: trail.length > 1 ? Math.hypot(trail[trail.length - 1].x - trail[0].x, trail[trail.length - 1].z - trail[0].z) : 0,
      x: +trail[trail.length - 1].x.toFixed(0), z: +trail[trail.length - 1].z.toFixed(0),
    }));
    const guide = guideStates.sort((a, b) => b.moved - a.moved)[0];
    rows.push({
      t: +((now - deadline + 60000) / 1000).toFixed(1),
      phase: snap.phase,
      me: `(${me.x.toFixed(0)},${me.z.toFixed(0)})`,
      vis: visibleEnemies,
      dead: deadPlayers,
      guide: guide ? `${guide.name} mv${guide.moved.toFixed(1)} @(${guide.x},${guide.z})` : null,
    });
    if (visibleEnemies > 0 || deadPlayers.length) break;
    if (guide && guide.moved >= 0.5) {
      const trail = guideTrails.get(guide.name);
      const crumb = [...trail].reverse().find((q) => now - q.t >= BREADCRUMB_LAG) ?? trail[0];
      const hostMoved = hostTrail.length >= 3
        ? Math.hypot(hostTrail[hostTrail.length - 1].x - hostTrail[0].x, hostTrail[hostTrail.length - 1].z - hostTrail[0].z)
        : 1;
      if (hostMoved < 0.4) stuckStrikes++; else stuckStrikes = Math.max(0, stuckStrikes - 1);
      if (stuckStrikes >= 3) {
        await host.evaluate(`(() => {
          document.dispatchEvent(new MouseEvent('mousemove', {
            movementX: ${(-unstickSide * 1.15 / 0.0018).toFixed(1)}, movementY: 0,
          }));
          return true;
        })()`);
        unstickSide = -unstickSide;
        stuckStrikes = 0;
        rows[rows.length - 1].unstick = true;
      } else {
        await host.evaluate(hostApproach({ x: crumb.x, z: crumb.z, name: guide.name }));
      }
      await host.keyboard.down('KeyW');
      await host.waitForTimeout(360);
      await host.keyboard.up('KeyW');
    } else {
      await host.waitForTimeout(250);
    }
  }
  for (const r of rows) console.log(JSON.stringify(r));

  for (const page of [peer, host]) {
    await pauseToMenu(page);
    await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
  }
  await host.waitForFunction(() =>
    fetch('/api/rooms').then((r) => r.json()).then((r) => r.rooms.every((x) => x.name !== roomName)), null, { timeout: 15000 });
} finally {
  await browser.close();
}
