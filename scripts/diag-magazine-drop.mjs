#!/usr/bin/env node
// Single-client diagnostic for the dropped original magazine: reports what the
// host's own world actor, its authoritative pose and the prop pool look like
// while a real KeyR reload runs.
import { chromium } from 'playwright';

const base = process.env.MAGAZINE_DIAG_BASE || 'http://127.0.0.1:27019';
const HOST = 'Mag Diag';
const roomName = `Dust2 R7 弹匣诊断 ${Date.now() % 10000}`;

const probe = `(() => {
  const g = window.__BREACHLINE__.runtime?.(); if (!g) return { error: 'no runtime' };
  const own = g.snapshot?.players?.find((p) => p.id === g.you) ?? null;
  const actor = g.art.actors.get(g.you) ?? null;
  const characters = actor?.userData?.sourceCharacter ?? null;
  const mag = characters?.magazine ?? null;
  let joints = null, share = null;
  if (mag?.geometry?.getAttribute?.('skinIndex') && mag.geometry.getAttribute('skinWeight')) {
    const si = mag.geometry.getAttribute('skinIndex'), sw = mag.geometry.getAttribute('skinWeight');
    const weight = new Map(); let total = 0;
    for (let i = 0; i < si.count; i++) for (let c = 0; c < 4; c++) {
      const w = sw.getComponent(i, c); if (!(w > 0)) continue;
      const joint = si.getComponent(i, c); weight.set(joint, (weight.get(joint) ?? 0) + w); total += w;
    }
    joints = weight.size; share = total > 0 ? Math.max(...weight.values()) / total : 0;
  }
  return {
    you: g.you, online: g.online, paused: g.paused,
    snapshotPoseVersion: own?.sourcePoseVersion ?? null,
    snapshotReload: own?.sourcePose?.reload ?? null,
    predictedPoseVersion: g.predicted?.sourcePoseVersion ?? null,
    predictedReload: g.predicted?.sourcePose?.reload ?? null,
    actorFound: !!actor,
    actorWeapon: actor?.userData?.sourceWeaponId ?? null,
    actorStatus: characters?.status ?? null,
    actorVisible: actor?.visible ?? null,
    actorMagazineVisible: characters?.magazineVisible ?? null,
    actorPendingDrop: !!characters?.pendingMagazineDrop,
    actorMagazineGroundY: characters?.magazineGroundY ?? null,
    actorMagazineSeed: characters?.magazineSeed ?? null,
    magName: mag?.name ?? null,
    magSkinned: !!mag?.isSkinnedMesh,
    magMaterialIsArray: Array.isArray(mag?.material),
    magMaterialName: Array.isArray(mag?.material) ? mag.material.map((m) => m.name) : (mag?.material?.name ?? null),
    magJointsUsed: joints, magDominantShare: share,
    sourceActors: g.art.assets.sourceActors?.size ?? null,
    dropActive: g.art.magazineDrops?.active ?? null,
    dropAudit: g.art.magazineDrops?.audit?.() ?? null,
  };
})()`;

const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await context.newPage();
  host.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  host.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await host.goto(`${base}/?map=de_dust2`);
  await host.waitForFunction(() => window.__BREACHLINE__?.assetAudit()?.character?.id?.startsWith('csgo-t-ak-12426148'), null, { timeout: 180000 });
  await host.getByRole('textbox', { name: '呼号', exact: true }).fill(HOST);
  await host.getByRole('button', { name: '创建房间', exact: true }).click();
  await host.getByLabel('房间名称', { exact: true }).fill(roomName);
  await host.getByRole('button', { name: '创建并进入房间', exact: true }).click();
  await host.waitForFunction((name) => window.__BREACHLINE__?.snapshot()?.players?.some((p) => p.name === name), HOST);
  await host.getByRole('button', { name: '返回主菜单', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  await host.getByRole('button', { name: '继续行动', exact: true }).click();
  await host.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 15000 });
  await host.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.phase === 'live', null, { timeout: 25000 });
  await host.waitForTimeout(400);

  console.log('before reload:', JSON.stringify(await host.evaluate(probe), null, 1));

  // Count what the pool actually receives, without touching production code.
  await host.evaluate(() => {
    const pool = window.__BREACHLINE__.runtime().art.magazineDrops;
    window.__POOL__ = { spawns: 0, updates: 0, clears: 0, last: null, thrown: null };
    const spawn = pool.spawn.bind(pool), update = pool.update.bind(pool), clear = pool.clear.bind(pool);
    pool.spawn = (source) => { window.__POOL__.spawns++;
      window.__POOL__.last = { key: source.key, floorY: source.floorY, seed: source.seed,
        forward: Array.from(source.forward), origin: Array.from(source.matrix.elements).slice(12, 15),
        vertices: source.geometry.getAttribute('position').count };
      try { return spawn(source); } catch (error) { window.__POOL__.thrown = String(error); throw error; } };
    pool.update = (dt) => { window.__POOL__.updates++; return update(dt); };
    pool.clear = () => { window.__POOL__.clears++; return clear(); };
    return true;
  });

  await host.mouse.down(); await host.waitForTimeout(420); await host.mouse.up();
  await host.waitForTimeout(600);
  await host.keyboard.down('KeyR');
  for (const at of [150, 400, 600, 900, 1300, 1800, 2300, 2700]) {
    await host.waitForTimeout(at === 150 ? 150 : 250);
    const row = await host.evaluate(probe);
    const pool = await host.evaluate(() => JSON.stringify(window.__POOL__));
    console.log(`t+${at}ms reload=${JSON.stringify(row.snapshotReload)} status=${row.actorStatus} magVis=${row.actorMagazineVisible} drops=${row.dropActive} pool=${pool}`);
  }
  await host.keyboard.up('KeyR');
  await host.waitForTimeout(2500);
  console.log('after reload:', JSON.stringify(await host.evaluate(probe), null, 1));
  console.log('pool after:', await host.evaluate(() => JSON.stringify(window.__POOL__)));
  if (errors.length) console.log('errors:', errors.slice(0, 10));
} finally {
  await browser.close();
}
