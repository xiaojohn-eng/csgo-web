#!/usr/bin/env node
// Real-browser LAN grenade-throw validation: two Chromium clients join one
// Dust2 room. The host (the only pointer-locked client, as in the jump and
// death validations) throws all three original utilities — HE standing
// (Idle_Shoot_GREN1), smoke while sprinting (Run_Shoot_GREN1) and flash from
// a crouch (Crouch_Idle_Shoot_GREN1) — through the real keydown path (KeyG /
// KeyV / KeyQ) after the live phase starts. Both clients record every
// player's authoritative sourcePose (including the merged original
// Shoot_GREN1 overlay: cycle, weight, variant) over the LAN snapshot path at
// 50ms intervals. The analysis asserts, identically on both clients:
// - three throw segments appear in order with distinct variants matching the
//   observed locomotion state at every overlay sample,
// - the overlay cycle advances monotonically to 1 (single non-looping
//   14-frame @30fps run) and locks at the final frame,
// - the overlay weight fades in to 1 and back out to 0 afterwards,
// - host and peer observe the same cycle at matched times.
// Evidence lands in output/playwright/source-grenade-lan-evidence.json.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.GRENADE_VALIDATION_BASE || 'http://127.0.0.1:27019';
const roomName = `Dust2 R7 投掷验证 ${Date.now() % 10000}`;
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });

const HOST = 'Grenade Host';
const VARIANT_FOR_STATE = { Idle: 831, Walk: 830, Run: 829, Crouch_Idle: 832, Crouch_Walk: 833 };

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

// 50ms collector: every player's sourcePose summary including the grenade
// overlay, so the analysis can audit each throw segment.
const collector = `(() => {
  window.__GREN_SAMPLES__ = [];
  window.__GREN_T0__ = performance.now();
  window.__GREN_TIMER__ = setInterval(() => {
    const snap = window.__BREACHLINE__?.snapshot?.();
    if (!snap) return;
    window.__GREN_SAMPLES__.push({
      t: (performance.now() - window.__GREN_T0__) / 1000,
      phase: snap.phase ?? null,
      players: snap.players.map((p) => ({
        name: p.name, team: p.team, bot: !!p.bot, alive: p.alive,
        state: p.sourcePose?.state ?? null,
        cycle: p.sourcePose?.cycle ?? null,
        grenadeCycle: p.sourcePose?.grenade?.cycle ?? null,
        grenadeWeight: p.sourcePose?.grenade?.weight ?? null,
        grenadeVariant: p.sourcePose?.grenade?.variant ?? null,
        grenades: p.grenades ?? null, smokes: p.smokes ?? null, flashes: p.flashes ?? null,
      })),
    });
  }, 50);
  return true;
})()`;

// Audit the authoritative Shoot_GREN1 overlay playback recorded on one
// client for the thrower. A throw segment is a maximal run of samples whose
// grenade overlay is present (weight > 0 or cycle > 0).
function auditGrenade(samples, name, label) {
  const issues = [];
  const rows = samples.map((s) => ({ t: s.t, p: s.players.find((p) => p.name === name) }));
  const overlay = rows.filter((r) => r.p && (r.p.grenadeWeight > 0 || r.p.grenadeCycle > 0));
  if (!overlay.length) { issues.push(`${label}: never observed a grenade overlay on ${name}`); return { issues, segments: [] }; }
  const segments = [];
  let current = [overlay[0]];
  for (let i = 1; i < overlay.length; i++) {
    if (overlay[i].t - overlay[i - 1].t <= 0.4) current.push(overlay[i]);
    else { segments.push(current); current = [overlay[i]]; }
  }
  segments.push(current);
  const summary = [];
  segments.forEach((segment, i) => {
    const head = segment[0], tail = segment[segment.length - 1];
    const states = new Set(segment.map((r) => r.p.state));
    const variants = new Set(segment.map((r) => r.p.grenadeVariant));
    if (variants.size !== 1) issues.push(`${label}: segment ${i} variant changed mid-throw (${[...variants].join(',')})`);
    for (const r of segment) {
      const expected = VARIANT_FOR_STATE[r.p.state];
      if (expected !== undefined && r.p.grenadeVariant !== expected) {
        issues.push(`${label}: segment ${i} variant ${r.p.grenadeVariant} at t=${r.t.toFixed(2)} does not match state ${r.p.state}`);
        break;
      }
    }
    const cycles = segment.map((r) => r.p.grenadeCycle);
    for (let j = 1; j < cycles.length; j++)
      if (cycles[j] < cycles[j - 1] - 1e-9) { issues.push(`${label}: segment ${i} overlay cycle regressed at sample ${j}`); break; }
    // Original Shoot_GREN1 plays at fps/(frames-1) = 30/13 ≈ 2.307 cycles/s.
    // Each segment splits into an advancing phase (cycle < 1) and a locked
    // phase (cycle clamped at 1 while the weight fades out). Advancing steps
    // must run at the original rate: no stalls, at most one catch-up burst
    // per segment (the first throw hits the server's cold start, which the
    // fixed-timestep loop repays in a single burst), and the steady steps
    // average at the original rate. The final step landing on 1 is truncated
    // by the clamp and is therefore exempt.
    const steps = [];
    for (let j = 1; j < segment.length; j++) {
      const dt = segment[j].t - segment[j - 1].t;
      if (dt > 0) steps.push({ rate: (cycles[j] - cycles[j - 1]) / dt, to: cycles[j] });
    }
    const advancing = steps.filter((s) => s.to < 0.999);
    const stalls = advancing.filter((s) => s.rate < 30 / 13 * 0.2);
    if (stalls.length) issues.push(`${label}: segment ${i} overlay stalled on ${stalls.length} advancing steps`);
    const catches = advancing.filter((s) => s.rate > 30 / 13 * 4);
    if (catches.length > 1) issues.push(`${label}: segment ${i} has ${catches.length} catch-up bursts`);
    const steady = advancing.filter((s) => s.rate >= 30 / 13 * 0.2 && s.rate <= 30 / 13 * 4);
    if (!steady.length && advancing.length) issues.push(`${label}: segment ${i} overlay never played at the original rate`);
    else if (steady.length) {
      const avg = steady.reduce((n, s) => n + s.rate, 0) / steady.length;
      if (Math.abs(avg - 30 / 13) > (30 / 13) * 0.1) issues.push(`${label}: segment ${i} overlay rate ${avg.toFixed(3)}/s, expected ~2.307/s`);
    }
    const reachOne = segment.find((r) => r.p.grenadeCycle >= 0.999);
    if (!reachOne) issues.push(`${label}: segment ${i} overlay cycle never reached 1 (max ${Math.max(...cycles, -1)})`);
    else {
      const locked = segment.filter((r) => r.t > reachOne.t);
      if (locked.length && locked.some((r) => r.p.grenadeCycle !== 1))
        issues.push(`${label}: segment ${i} overlay did not lock at cycle 1`);
    }
    const weights = segment.map((r) => r.p.grenadeWeight);
    const peak = Math.max(...weights);
    if (peak < 0.99) issues.push(`${label}: segment ${i} overlay weight peaked at ${peak.toFixed(3)}, fade-in incomplete`);
    const peakIndex = weights.indexOf(peak);
    const falling = weights.slice(peakIndex);
    if (falling.some((w, j) => j > 0 && w > falling[j - 1] + 1e-9))
      issues.push(`${label}: segment ${i} overlay weight rose again after the peak`);
    const last = tail.p;
    const clearedAfter = rows.find((r) => r.t > tail.t + 0.5 && r.p && r.p.grenadeWeight === null && r.p.grenadeCycle === null);
    if (!clearedAfter) issues.push(`${label}: segment ${i} overlay never cleared after the fade-out`);
    summary.push({
      t0: +head.t.toFixed(3), t1: +tail.t.toFixed(3),
      span: +(tail.t - head.t).toFixed(3),
      states: [...states], variant: [...variants][0] ?? null,
      peakWeight: +peak.toFixed(3),
      reachedOne: !!reachOne, clearedAfter: !!clearedAfter,
      endInventory: { grenades: last.grenades, smokes: last.smokes, flashes: last.flashes },
    });
  });
  if (segments.length < 3) issues.push(`${label}: expected 3 throw segments, observed ${segments.length}`);
  else {
    const variants = summary.map((s) => s.variant);
    if (new Set(variants).size < 3) issues.push(`${label}: throw variants not distinct: ${variants.join(',')}`);
  }
  return { issues, segments: summary, t0: overlay[0].t };
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: process.env.GRENADE_VALIDATION_HEADED ? false : true,
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
  await host.getByRole('textbox', { name: '呼号', exact: true }).fill(HOST);
  await host.getByRole('button', { name: '创建房间', exact: true }).click();
  await host.getByLabel('房间名称', { exact: true }).fill(roomName);
  await host.getByRole('button', { name: '创建并进入房间', exact: true }).click();
  await host.waitForFunction((name) => window.__BREACHLINE__?.snapshot()?.players?.some((p) => p.name === name), HOST);
  await pauseToMenu(host);

  const peer = await context.newPage();
  observe(peer, errors);
  await peer.goto(`${base}/?map=de_dust2`);
  await peer.waitForFunction(
    () => window.__BREACHLINE__?.assetAudit()?.character?.id?.startsWith('csgo-t-ak-12426148') &&
      window.__BREACHLINE__?.assetAudit()?.counterTerrorist?.id?.startsWith('csgo-ct-ak-12426148'),
    null, { timeout: 180000 },
  );
  await peer.getByRole('textbox', { name: '呼号', exact: true }).fill('Grenade Peer');
  await peer.getByRole('button', { name: '局域网房间', exact: true }).click();
  await peer.getByRole('listitem').filter({ hasText: roomName }).click();
  await peer.getByRole('button', { name: '加入所选房间', exact: true }).click();
  await peer.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.players?.filter((p) => !p.bot).length === 2);
  await pauseToMenu(peer);

  // Only the host holds the pointer lock; the peer stays in the menu, still
  // collecting snapshots over the LAN path.
  await host.bringToFront();
  await host.getByRole('button', { name: '继续行动', exact: true }).click();
  await host.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 15000 });
  // The round opens with the original 12s buy freeze where inputs are swallowed
  // server-side; wait for the live phase before throwing.
  await host.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.phase === 'live', null, { timeout: 25000 });
  await host.waitForTimeout(300);

  await host.evaluate(collector);
  await peer.evaluate(collector);

  // Throw 1: standing HE (Idle_Shoot_GREN1) through the real keydown path.
  await host.keyboard.press('KeyG');
  await host.waitForTimeout(1600);
  await host.screenshot({ path: resolve(outputDir, 'source-grenade-lan-idle-throw.png') });

  // Throw 2: smoke while sprinting (Run_Shoot_GREN1) — hold the real KeyW.
  await host.keyboard.down('KeyW');
  await host.waitForTimeout(900);
  await host.keyboard.press('KeyV');
  await host.waitForTimeout(1300);
  await host.keyboard.up('KeyW');
  await host.screenshot({ path: resolve(outputDir, 'source-grenade-lan-run-throw.png') });

  // Throw 3: flash from a crouch (Crouch_Idle_Shoot_GREN1).
  await host.keyboard.down('ControlLeft');
  await host.waitForTimeout(400);
  await host.keyboard.press('KeyQ');
  await host.waitForTimeout(1600);
  await host.keyboard.up('ControlLeft');
  await host.screenshot({ path: resolve(outputDir, 'source-grenade-lan-crouch-throw.png') });

  const hostSamples = await host.evaluate(() => {
    clearInterval(window.__GREN_TIMER__);
    return window.__GREN_SAMPLES__;
  });
  const peerSamples = await peer.evaluate(() => {
    clearInterval(window.__GREN_TIMER__);
    return window.__GREN_SAMPLES__;
  });

  const hostAudit = auditGrenade(hostSamples, HOST, 'host');
  const peerAudit = auditGrenade(peerSamples, HOST, 'peer');

  // Cross-client agreement: both collectors keep their own performance.now
  // origin, so first align the two clocks on the shared throw instants (each
  // segment's first overlay sample). After the shift, matched samples may
  // still sit one 50ms sampling step apart (independent collector phases), a
  // step the original 30/13 cycles/s rate advances by ~0.115 cycles.
  {
    const rowsOf = (samples) => samples.map((s) => ({ t: s.t, p: s.players.find((p) => p.name === HOST) }))
      .filter((r) => r.p && (r.p.grenadeWeight > 0 || r.p.grenadeCycle > 0));
    const a = rowsOf(hostSamples), b = rowsOf(peerSamples);
    if (!a.length || !b.length) hostAudit.issues.push('missing overlay samples for cross-client comparison');
    else {
      const split = (rows) => {
        const segs = [[rows[0]]];
        for (let i = 1; i < rows.length; i++) {
          if (rows[i].t - rows[i - 1].t <= 0.4) segs[segs.length - 1].push(rows[i]);
          else segs.push([rows[i]]);
        }
        return segs;
      };
      const segsA = split(a), segsB = split(b);
      if (segsA.length !== segsB.length)
        hostAudit.issues.push(`host/peer overlay segment counts differ: ${segsA.length} vs ${segsB.length}`);
      else {
        const offsets = segsA.map((s, i) => s[0].t - segsB[i][0].t).sort((x, y) => x - y);
        const offset = offsets[Math.floor(offsets.length / 2)];
        const drift = Math.max(...offsets.map((o) => Math.abs(o - offset)));
        if (drift > 0.1) hostAudit.issues.push(`host/peer clock alignment drifts ${drift.toFixed(3)}s across throws`);
        let worst = 0, variantMismatch = 0, compared = 0;
        for (const s of b) {
          let best = null;
          for (const r of a) { const d = Math.abs(r.t - (s.t + offset)); if (!best || d < best.d) best = { d, r }; }
          if (best.d < 0.055) {
            worst = Math.max(worst, Math.abs((best.r.p.grenadeCycle ?? 0) - (s.p.grenadeCycle ?? 0)));
            if (best.r.p.grenadeVariant !== s.p.grenadeVariant) variantMismatch++;
            compared++;
          }
        }
        if (compared < b.length * 0.5) hostAudit.issues.push(`only ${compared}/${b.length} peer overlay samples aligned with host samples`);
        if (worst > 0.13) hostAudit.issues.push(`host/peer overlay cycle diverged by ${worst.toFixed(4)} at matched times`);
        if (variantMismatch > 0) hostAudit.issues.push(`host/peer overlay variant mismatched on ${variantMismatch} matched samples`);
        hostAudit.crossClientMaxCycleDelta = +worst.toFixed(5);
        hostAudit.crossClientCompared = compared;
        hostAudit.crossClientClockOffset = +offset.toFixed(5);
      }
    }
  }

  const hostPoseVersion = await host.evaluate((name) =>
    window.__BREACHLINE__.snapshot()?.players?.find((p) => p.name === name)?.sourcePoseVersion, HOST);
  const peerPoseVersion = await peer.evaluate((name) =>
    window.__BREACHLINE__.snapshot()?.players?.find((p) => p.name === name)?.sourcePoseVersion, HOST);
  if (hostPoseVersion !== peerPoseVersion)
    hostAudit.issues.push(`host/peer pose versions differ: ${hostPoseVersion} vs ${peerPoseVersion}`);

  // Leave the round cleanly from both clients.
  for (const page of [peer, host]) {
    await pauseToMenu(page);
    await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
  }
  await host.waitForFunction((name) =>
    fetch('/api/rooms').then((r) => r.json()).then((r) => r.rooms.every((x) => x.name !== name)), roomName, { timeout: 15000 });

  if (errors.length) hostAudit.issues.push(...errors);
  const evidence = {
    scope: 'Original Dust2 two-client LAN. The host (the only pointer-locked '
      + 'client) throws all three original utilities after the live phase '
      + 'starts — HE standing, smoke while sprinting, flash from a crouch — '
      + 'through the real keydown path. Both clients record every player '
      + 'sourcePose including the merged original Shoot_GREN1 overlay at 50ms '
      + 'intervals; the analysis asserts three distinct variants matching the '
      + 'observed locomotion state, a monotonic cycle reaching 1 (~0.43s '
      + 'single non-looping 14-frame @30fps run) with final-frame lock, the '
      + 'weight envelope fading in and back out, and identical host/peer '
      + 'playback at matched times.',
    base, roomName, hostPoseVersion, peerPoseVersion,
    host: { audit: hostAudit, samples: hostSamples },
    peer: { audit: peerAudit, samples: peerSamples },
    errors,
  };
  writeFileSync(resolve(outputDir, 'source-grenade-lan-evidence.json'), JSON.stringify(evidence, null, 2));

  const issues = [...hostAudit.issues, ...peerAudit.issues];
  if (issues.length) {
    console.error('GRENADE VALIDATION FAILED:\n' + issues.map((i) => `  - ${i}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('GRENADE VALIDATION PASSED');
    console.log(`  host segments: ${hostAudit.segments.map((s) => `${s.states.join('/')}→v${s.variant}(peak ${s.peakWeight}, span ${s.span}s)`).join(' | ')}`);
    console.log(`  peer segments: ${peerAudit.segments.length}`);
    console.log(`  cross-client max cycle delta: ${hostAudit.crossClientMaxCycleDelta} over ${hostAudit.crossClientCompared} samples`);
    console.log(`  poseVersion: ${hostPoseVersion}`);
    console.log('  evidence: output/playwright/source-grenade-lan-evidence.json');
  }
} finally {
  await browser.close();
}
