#!/usr/bin/env node
// Real-browser LAN jump validation: two Chromium clients join one Dust2 room,
// the host performs standing and moving jumps, and both clients record the
// authoritative sourcePose.jump layer (original jump_lower 9-way) over the LAN
// snapshot path. The peer is on the opposite team, so its copy of the host is
// redacted by the anti-wallhack visibility filter (y=-100) while the pose layer
// itself is what both sides must agree on. Evidence lands in
// output/playwright/source-jump-lan-evidence.json.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.JUMP_VALIDATION_BASE || 'http://127.0.0.1:27019';
const roomName = `Dust2 R5 跳跃验证 ${Date.now() % 10000}`;
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });

const observe = (page, errors) => {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
};

const pauseToMenu = async (page) => {
  await page.bringToFront();
  if (!(await page.getByRole('button', { name: '返回主菜单', exact: true }).isVisible()))
    await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '返回主菜单', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
};

const collector = `(() => {
  window.__JUMP_SAMPLES__ = [];
  window.__JUMP_T0__ = performance.now();
  window.__JUMP_TIMER__ = setInterval(() => {
    const snap = window.__BREACHLINE__?.snapshot?.();
    const host = snap?.players?.find((p) => p.name === 'Jump Host');
    if (!host) return;
    window.__JUMP_SAMPLES__.push({
      t: (performance.now() - window.__JUMP_T0__) / 1000,
      x: host.x, y: host.y, z: host.z, vy: host.vy, grounded: host.grounded, crouch: host.crouch,
      weapon: host.weapon,
      poseState: host.sourcePose?.state ?? null,
      moveX: host.sourcePose?.parameters?.move_x ?? null,
      moveY: host.sourcePose?.parameters?.move_y ?? null,
      jump: host.sourcePose?.jump ? { ...host.sourcePose.jump } : null,
    });
  }, 50);
  return true;
})()`;

/** Audit the authoritative jump-layer lifecycle. `trustPosition` is false for
 * the peer side, where the anti-wallhack filter redacts the host coordinates. */
function auditJump(samples, label, trustPosition) {
  const issues = [];
  if (samples.length < 8) issues.push(`${label}: only ${samples.length} samples collected`);
  const liftoff = [];
  const landings = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1].grounded && !samples[i].grounded) liftoff.push(i);
    if (!samples[i - 1].grounded && samples[i].grounded) landings.push(i);
  }
  if (liftoff.length < 2) issues.push(`${label}: expected 2 liftoffs, saw ${liftoff.length}`);
  if (landings.length < 2) issues.push(`${label}: expected 2 landings, saw ${landings.length}`);
  const airborne = samples.filter((s) => !s.grounded);
  const withJump = airborne.filter((s) => s.jump && s.jump.airborne);
  if (!airborne.length) issues.push(`${label}: no airborne samples`);
  if (airborne.length && withJump.length < airborne.length * 0.5)
    issues.push(`${label}: only ${withJump.length}/${airborne.length} airborne samples carry the jump layer`);
  const maxWeight = withJump.reduce((m, s) => Math.max(m, s.jump.weight), 0);
  if (maxWeight < 0.99) issues.push(`${label}: jump weight peaked at ${maxWeight}, never fully faded in`);
  const firstJump = withJump[0];
  if (firstJump && firstJump.jump.weight > 0.75)
    issues.push(`${label}: first jump sample already at weight ${firstJump.jump.weight}; fade-in unobserved`);
  const full = withJump.find((s) => s.jump.weight >= 0.99);
  if (firstJump && full && full.t - firstJump.t > 0.45)
    issues.push(`${label}: fade-in spanned ${(full.t - firstJump.t).toFixed(3)}s, expected ~0.2s`);
  const cycles = withJump.map((s) => s.jump.cycle);
  let cycleAdvanced = false;
  for (let i = 1; i < cycles.length; i++) if (Math.abs(cycles[i] - cycles[i - 1]) > 1e-6) cycleAdvanced = true;
  if (withJump.length > 3 && !cycleAdvanced) issues.push(`${label}: jump_lower cycle never advanced while airborne`);
  const fadeOut = samples.filter((s) => s.jump && !s.jump.airborne);
  if (!fadeOut.length) issues.push(`${label}: no post-landing fade-out samples`);
  const settled = samples.slice(-5).every((s) => !s.jump);
  if (!settled) issues.push(`${label}: jump layer never disappeared after the landing fade-out`);
  const tailWeight = fadeOut[fadeOut.length - 1]?.jump?.weight ?? 0;
  if (tailWeight > 0.35) issues.push(`${label}: fade-out stalled at weight ${tailWeight}`);
  let rise = null;
  if (trustPosition) {
    const groundY = samples.filter((s) => s.grounded).map((s) => s.y);
    const minY = Math.min(...groundY), maxY = Math.max(...samples.map((s) => s.y));
    rise = +(maxY - minY).toFixed(3);
    if (maxY - minY < 0.5) issues.push(`${label}: vertical rise ${rise}m, expected a real jump arc`);
  }
  return { issues, liftoff: liftoff.length, landings: landings.length, airborne: airborne.length,
    withJump: withJump.length, maxWeight, fadeOut: fadeOut.length, tailWeight, settled, rise };
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: process.env.JUMP_VALIDATION_HEADED ? false : true,
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await context.newPage();
  observe(host, errors);
  await host.goto(`${base}/?map=de_dust2`);
  await host.waitForFunction(
    () => window.__BREACHLINE__?.assetAudit()?.character?.id?.startsWith('csgo-t-ak-12426148') &&
      window.__BREACHLINE__?.assetAudit()?.counterTerrorist?.id?.startsWith('csgo-ct-ak-12426148'),
    null, { timeout: 180000 },
  );
  await host.getByRole('textbox', { name: '呼号', exact: true }).fill('Jump Host');
  await host.getByRole('button', { name: '创建房间', exact: true }).click();
  await host.getByLabel('房间名称', { exact: true }).fill(roomName);
  await host.getByRole('button', { name: '创建并进入房间', exact: true }).click();
  await host.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.players?.some((p) => p.name === 'Jump Host'));
  await pauseToMenu(host);

  const peer = await context.newPage();
  observe(peer, errors);
  await peer.goto(`${base}/?map=de_dust2`);
  await peer.waitForFunction(
    () => window.__BREACHLINE__?.assetAudit()?.character?.id?.startsWith('csgo-t-ak-12426148') &&
      window.__BREACHLINE__?.assetAudit()?.counterTerrorist?.id?.startsWith('csgo-ct-ak-12426148'),
    null, { timeout: 180000 },
  );
  await peer.getByRole('textbox', { name: '呼号', exact: true }).fill('Jump Peer');
  await peer.getByRole('button', { name: '局域网房间', exact: true }).click();
  await peer.getByRole('listitem').filter({ hasText: roomName }).click();
  await peer.getByRole('button', { name: '加入所选房间', exact: true }).click();
  await peer.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.players?.filter((p) => !p.bot).length === 2);
  await pauseToMenu(peer);

  await host.bringToFront();
  await host.getByRole('button', { name: '继续行动', exact: true }).click();
  await host.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 15000 });
  // The round opens with the original 12s buy freeze where movement and jumps
  // are disabled server-side; wait for the live phase before jumping.
  await host.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.phase === 'live', null, { timeout: 25000 });
  await host.waitForTimeout(300);

  await host.evaluate(collector);
  await peer.evaluate(collector);

  const hostJumpGone = () => host.waitForFunction(() => {
    const me = window.__BREACHLINE__?.snapshot?.()?.players?.find((p) => p.name === 'Jump Host');
    return me && me.grounded && !me.sourcePose?.jump;
  }, null, { timeout: 8000 });

  // Standing jump: zero-vector 9-way input.
  await host.keyboard.press('Space');
  await host.waitForTimeout(400);
  await host.screenshot({ path: resolve(outputDir, 'source-jump-lan-stand-apex.png') });
  await hostJumpGone();
  await host.waitForTimeout(150);

  // Moving jump: directional 9-way input.
  await host.keyboard.down('KeyW');
  await host.waitForTimeout(350);
  await host.keyboard.press('Space');
  await host.waitForTimeout(400);
  await host.screenshot({ path: resolve(outputDir, 'source-jump-lan-moving-apex.png') });
  await hostJumpGone();
  await host.keyboard.up('KeyW');
  await host.waitForTimeout(300);
  await host.keyboard.press('Escape');
  await host.waitForTimeout(300);

  const hostSamples = await host.evaluate(() => {
    clearInterval(window.__JUMP_TIMER__);
    return window.__JUMP_SAMPLES__;
  });
  const peerSamples = await peer.evaluate(() => {
    clearInterval(window.__JUMP_TIMER__);
    return window.__JUMP_SAMPLES__;
  });
  await peer.screenshot({ path: resolve(outputDir, 'source-jump-lan-peer-view.png') });

  const hostAudit = auditJump(hostSamples, 'host', true);
  const peerAudit = auditJump(peerSamples, 'peer', false);
  // Both clients must have observed the same authoritative fade shape.
  const hostFades = hostSamples.filter((s) => s.jump).map((s) => +s.jump.weight.toFixed(3));
  const peerFades = peerSamples.filter((s) => s.jump).map((s) => +s.jump.weight.toFixed(3));
  if (hostFades.length !== peerFades.length || hostFades.some((w, i) => w !== peerFades[i]))
    hostAudit.issues.push(`host/peer jump layer observations diverge: ${hostFades.length} vs ${peerFades.length} samples`);

  const hostPoseVersion = await host.evaluate(() =>
    window.__BREACHLINE__.snapshot()?.players?.find((p) => p.name === 'Jump Host')?.sourcePoseVersion);
  const peerPoseVersion = await peer.evaluate(() =>
    window.__BREACHLINE__.snapshot()?.players?.find((p) => p.name === 'Jump Host')?.sourcePoseVersion);
  if (hostPoseVersion !== peerPoseVersion)
    hostAudit.issues.push(`host/peer pose versions differ: ${hostPoseVersion} vs ${peerPoseVersion}`);

  await pauseToMenu(peer);
  await peer.getByRole('button', { name: '返回主菜单', exact: true }).click();
  await host.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.players?.filter((p) => !p.bot).length === 1);
  await pauseToMenu(host);
  await host.getByRole('button', { name: '返回主菜单', exact: true }).click();
  await host.waitForFunction(() =>
    fetch('/api/rooms').then((r) => r.json()).then((r) => r.rooms.every((x) => x.name !== roomName)), null, { timeout: 15000 });

  if (errors.length) hostAudit.issues.push(...errors);
  const evidence = {
    scope: 'Original Dust2 two-client LAN, opposite teams. Host performs one standing '
      + '(zero-vector 9-way) and one moving (directional 9-way) jump. Both clients record the '
      + 'authoritative sourcePose.jump layer (merged original jump_lower 9-way) from the LAN '
      + 'snapshot path at 50ms intervals. Fade-in/out ~0.2s, airborne cycle advance, landing '
      + 'fade-out and layer removal are asserted on both sides; the vertical arc is asserted '
      + 'only on the host side because the anti-wallhack filter redacts enemy coordinates '
      + '(y=-100) on the peer side while the pose layer still transfers.',
    base, roomName, hostPoseVersion, peerPoseVersion,
    host: { audit: hostAudit, samples: hostSamples },
    peer: { audit: peerAudit, samples: peerSamples },
    errors,
  };
  writeFileSync(resolve(outputDir, 'source-jump-lan-evidence.json'), JSON.stringify(evidence, null, 2));

  const issues = [...hostAudit.issues, ...peerAudit.issues];
  if (issues.length) {
    console.error('JUMP VALIDATION FAILED:\n' + issues.map((i) => `  - ${i}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('JUMP VALIDATION PASSED');
    console.log(`  host: ${hostSamples.length} samples, rise ${hostAudit.rise}m, weight→${hostAudit.maxWeight}, fade-out ${hostAudit.fadeOut} samples`);
    console.log(`  peer: ${peerSamples.length} samples, weight→${peerAudit.maxWeight}, fade-out ${peerAudit.fadeOut} samples, jump layer identical`);
    console.log(`  poseVersion: ${hostPoseVersion}`);
    console.log(`  evidence: output/playwright/source-jump-lan-evidence.json`);
  }
} finally {
  await browser.close();
}
