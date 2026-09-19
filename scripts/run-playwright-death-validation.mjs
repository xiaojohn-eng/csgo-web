#!/usr/bin/env node
// Real-browser LAN death validation: two Chromium clients join one Dust2 room
// on opposite teams. The host advances WITH its squad: teammates always carry
// full coordinates in the host snapshot and the bots pathfind along the real
// navmesh, so the host follows the actively-advancing teammate's breadcrumb
// (its position ~1.2s in the past, i.e. its actual footsteps) toward the
// contact point, side-steps whenever it jams against geometry, and engages
// any enemy that enters its own line of sight through the real
// mousemove/mousedown path. Whoever dies first inside the engagement becomes
// the victim: an enemy corpse in the host view (its crosshair is on the
// fight), or the host itself if the defense lands its shots first. Both
// clients record the authoritative sourcePose Death playback (merged original
// Death1 full-body fall: single non-looping run, cycle locked at the final
// frame, corpse fire layer zeroed, corpse retained until the round resets and
// the audit stops at the respawn) over the LAN snapshot path at 50ms
// intervals, and the host captures the fall mid-flight and the frozen final
// frame from its first-person view. Evidence lands in
// output/playwright/source-death-lan-evidence.json.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.DEATH_VALIDATION_BASE || 'http://127.0.0.1:27019';
const roomName = `Dust2 R6 死亡验证 ${Date.now() % 10000}`;
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

// 50ms collector: every player's alive flag + sourcePose summary, so the
// analysis can lock onto whichever player dies during the engagement.
const collector = `(() => {
  window.__DEATH_SAMPLES__ = [];
  window.__DEATH_T0__ = performance.now();
  window.__DEATH_TIMER__ = setInterval(() => {
    const snap = window.__BREACHLINE__?.snapshot?.();
    if (!snap) return;
    window.__DEATH_SAMPLES__.push({
      t: (performance.now() - window.__DEATH_T0__) / 1000,
      phase: snap.phase ?? null,
      players: snap.players.map((p) => ({
        name: p.name, team: p.team, bot: !!p.bot, alive: p.alive,
        y: p.y,
        state: p.sourcePose?.state ?? null,
        cycle: p.sourcePose?.cycle ?? null,
        upperCycle: p.sourcePose?.upperCycle ?? null,
        fireWeight: p.sourcePose?.fireWeight ?? null,
        fireCycle: p.sourcePose?.fireCycle ?? null,
        moveX: p.sourcePose?.parameters?.move_x ?? null,
        moveY: p.sourcePose?.parameters?.move_y ?? null,
      })),
    });
  }, 50);
  return true;
})()`;

// One aiming step inside a client page: pick the nearest visible enemy (real
// players before bots), turn to it through the real pointer-locked mousemove
// path, and fire a short burst once the crosshair is on target.
const makeAimStep = (meName) => `(async () => {
  const g = window.__BREACHLINE__.runtime();
  const snap = window.__BREACHLINE__.snapshot();
  const me = snap.players.find((p) => p.name === ${JSON.stringify(meName)});
  if (!me || !me.alive) return { reason: 'dead' };
  const enemies = snap.players
    .filter((p) => p.team !== me.team && p.alive && p.y > -50)
    .sort((a, b) => (a.bot - b.bot) || (Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z)));
  const target = enemies[0];
  if (!target) return { reason: 'no-visible-enemy' };
  const dx = target.x - me.x, dz = target.z - me.z, dist = Math.hypot(dx, dz);
  const desiredYaw = Math.atan2(-dx, -dz);
  const eyeY = me.y + (me.crouch ? 1.1684 : 1.6256);
  const desiredPitch = Math.atan2(target.y + 1.55 - eyeY, dist);
  const yawDelta = Math.atan2(Math.sin(desiredYaw - g.yaw), Math.cos(desiredYaw - g.yaw));
  const pitchDelta = desiredPitch - g.pitch;
  document.dispatchEvent(new MouseEvent('mousemove', {
    movementX: -yawDelta / 0.0018, movementY: -pitchDelta / 0.0018,
  }));
  await new Promise((r) => setTimeout(r, 60));
  const aligned = Math.abs(Math.atan2(Math.sin(desiredYaw - g.yaw), Math.cos(desiredYaw - g.yaw))) < 0.035
    && Math.abs(desiredPitch - g.pitch) < 0.035;
  let fired = 0;
  if (aligned && !g.paused && document.pointerLockElement) {
    const canvas = g.art.renderer.domElement;
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    await new Promise((r) => setTimeout(r, 320));
    canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    fired = 3;
  }
  return {
    reason: aligned ? 'firing' : 'aiming', fired,
    target: target.name, dist: +dist.toFixed(2),
  };
})()`;

// Approach step: face the given world position (real mousemove path) and level
// the pitch so the following KeyW walk runs straight at it.
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
  return { reason: 'approach', target: ${JSON.stringify(target.name ?? 'point')}, dist: +Math.hypot(dx, dz).toFixed(2) };
})()`;

// Audit the authoritative Death playback recorded on one client. The corpse
// persists until the round resets, so the audit window ends at the victim's
// respawn; the post-respawn living pose belongs to the next round.
function auditDeath(samples, name, label) {
  const issues = [];
  const victimRows = samples.map((s) => ({ t: s.t, p: s.players.find((p) => p.name === name) }));
  const firstDeath = victimRows.findIndex((r, i) => r.p && r.p.alive === false && i > 0 && victimRows[i - 1].p?.alive !== false);
  if (firstDeath < 0) { issues.push(`${label}: never observed ${name} dying`); return { issues }; }
  const t0 = victimRows[firstDeath].t;
  let respawn = Infinity;
  for (let i = firstDeath + 1; i < victimRows.length; i++) {
    if (victimRows[i].p?.alive === true) { respawn = victimRows[i].t; break; }
  }
  const death = victimRows
    .filter((r) => r.t >= t0 - 0.001 && r.t < respawn)
    .map((r) => ({ t: +(r.t - t0).toFixed(3), ...r.p }));
  const withPose = death.filter((r) => r.state === 'Death');
  const respawnAt = respawn === Infinity ? null : +(respawn - t0).toFixed(3);
  if (death.length < 40) issues.push(`${label}: only ${death.length} death samples`);
  if (death.some((r) => r.state !== null && r.state !== 'Death'))
    issues.push(`${label}: post-death states include non-Death entries`);
  for (const r of withPose) {
    if (r.fireWeight !== 0 || r.fireCycle !== 0) { issues.push(`${label}: corpse keeps fire layer at t=${r.t}`); break; }
  }
  for (const r of withPose) {
    if (r.moveX !== 0 || r.moveY !== 0) { issues.push(`${label}: corpse parameters not neutral at t=${r.t}`); break; }
  }
  const cycles = withPose.map((r) => r.cycle);
  for (let i = 1; i < cycles.length; i++)
    if (cycles[i] < cycles[i - 1] - 1e-9) { issues.push(`${label}: death cycle regressed at sample ${i}`); break; }
  const first = cycles[0];
  if (first === undefined || first > 0.2) issues.push(`${label}: first death sample cycle ${first}, fade-in start missing`);
  const reachOne = withPose.find((r) => r.cycle >= 0.999);
  if (!reachOne) issues.push(`${label}: death cycle never reached 1 (max ${Math.max(...cycles, -1)})`);
  else {
    const span = reachOne.t - (withPose[0]?.t ?? reachOne.t);
    // T/CT Death1 fall: fps/(frames-1) over ~3.17s (96f) or ~3.33s (101f).
    if (span < 2.5 || span > 4.2) issues.push(`${label}: fall spanned ${span.toFixed(2)}s, expected ~3.2-3.3s`);
    const locked = withPose.filter((r) => r.t > reachOne.t);
    if (locked.length < 5) issues.push(`${label}: final-frame lock not observed (${locked.length} samples after cycle 1)`);
    if (locked.some((r) => r.cycle !== 1)) issues.push(`${label}: corpse did not lock at cycle 1`);
  }
  const uppers = withPose.map((r) => r.upperCycle);
  if (uppers.some((u, i) => Math.abs((u ?? 0) - (cycles[i] ?? 0)) > 1e-9))
    issues.push(`${label}: upper body cycle diverged from the lower body fall`);
  return { issues, t0, respawnAt, samples: death, span: reachOne ? +(reachOne.t - (withPose[0]?.t ?? reachOne.t)).toFixed(3) : null };
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: process.env.DEATH_VALIDATION_HEADED ? false : true,
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
  await host.getByRole('textbox', { name: '呼号', exact: true }).fill('Death Host');
  await host.getByRole('button', { name: '创建房间', exact: true }).click();
  await host.getByLabel('房间名称', { exact: true }).fill(roomName);
  await host.getByRole('button', { name: '创建并进入房间', exact: true }).click();
  await host.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.players?.some((p) => p.name === 'Death Host'));
  await pauseToMenu(host);

  const peer = await context.newPage();
  observe(peer, errors);
  await peer.goto(`${base}/?map=de_dust2`);
  await peer.waitForFunction(
    () => window.__BREACHLINE__?.assetAudit()?.character?.id?.startsWith('csgo-t-ak-12426148') &&
      window.__BREACHLINE__?.assetAudit()?.counterTerrorist?.id?.startsWith('csgo-ct-ak-12426148'),
    null, { timeout: 180000 },
  );
  await peer.getByRole('textbox', { name: '呼号', exact: true }).fill('Death Peer');
  await peer.getByRole('button', { name: '局域网房间', exact: true }).click();
  await peer.getByRole('listitem').filter({ hasText: roomName }).click();
  await peer.getByRole('button', { name: '加入所选房间', exact: true }).click();
  await peer.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.players?.filter((p) => !p.bot).length === 2);
  await pauseToMenu(peer);

  // Only the host holds the pointer lock (a browser grants it to a single
  // focused page), exactly like the jump validation; the peer stays in the
  // menu, still collecting snapshots and scouting enemy coordinates.
  await host.bringToFront();
  await host.getByRole('button', { name: '继续行动', exact: true }).click();
  await host.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 15000 });
  // The round opens with the original 12s buy freeze where inputs are swallowed
  // server-side; wait for the live phase before moving and firing.
  await host.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.phase === 'live', null, { timeout: 25000 });
  await host.waitForTimeout(300);

  await host.evaluate(collector);
  await peer.evaluate(collector);

  // Engagement: the host advances WITH its squad. Teammates always carry full
  // coordinates in the host snapshot and the bots pathfind along the real
  // navmesh, so the host follows the actively-advancing teammate's breadcrumb
  // — its position ~1.2s in the past, i.e. its actual footsteps, which were
  // provably walkable — toward the contact point. Straight-line chasing jams
  // against spawn walls (the naive approach slid along a wall at 0.05 m/s), so
  // the breadcrumb plus a side-step turn whenever the host stalls keeps it on
  // the real route. Any enemy entering the host's line of sight switches to
  // the aim/fire path. The victim is an enemy dying INSIDE the host's view
  // (y > -50) — the crosshair is on that fight — or the host itself if the
  // defense lands its shots first.
  const hostAim = makeAimStep('Death Host'), hostApproach = makeApproach('Death Host');
  const unstickTurn = (side) => `(() => {
    const g = window.__BREACHLINE__.runtime();
    document.dispatchEvent(new MouseEvent('mousemove', {
      movementX: ${(-side * 1.15 / 0.0018).toFixed(1)}, movementY: 0,
    }));
    return { reason: 'unstick', side: ${side}, yaw: +g.yaw.toFixed(3) };
  })()`;
  let victim = null;
  const steps = [];
  const guideTrails = new Map();
  const hostTrail = [];
  const seenDeadTeammates = new Set();
  let corpseHunt = null;
  let stuckStrikes = 0;
  let unstickSide = 1;
  let arrivedStreak = 0;
  let guideName = null;
  const BREADCRUMB_LAG = 1200;
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline && !victim) {
    const snap = await host.evaluate(() => window.__BREACHLINE__?.snapshot?.());
    const me = snap.players.find((p) => p.name === 'Death Host');
    if (!me || me.alive === false) { victim = 'Death Host'; break; }
    const visibleDead = snap.players.find((p) => p.team !== me.team && p.alive === false && p.y > -50);
    if (visibleDead) { victim = visibleDead.name; break; }
    if (snap.players.some((p) => p.team !== me.team && p.alive && p.y > -50)) {
      stuckStrikes = 0;
      arrivedStreak = 0;
      steps.push(await host.evaluate(hostAim));
      continue;
    }
    const now = Date.now();
    // A freshly dead teammate marks the fight: its killer still stands there.
    const freshCorpse = snap.players.find(
      (p) => p.team === me.team && p.alive === false && p.y > -50 && !seenDeadTeammates.has(p.name),
    );
    for (const p of snap.players) {
      if (p.team === me.team && p.alive === false) seenDeadTeammates.add(p.name);
      if (!p.bot || p.team !== me.team || p.alive !== true) continue;
      const trail = guideTrails.get(p.name) ?? [];
      trail.push({ x: p.x, z: p.z, t: now });
      while (trail.length && now - trail[0].t > 2500) trail.shift();
      guideTrails.set(p.name, trail);
    }
    hostTrail.push({ x: me.x, z: me.z, t: now });
    while (hostTrail.length && now - hostTrail[0].t > 2500) hostTrail.shift();
    // Hunt the newest teammate corpse for up to 5s — the enemy that made it
    // is standing right there — before falling back to the squad breadcrumb.
    if (freshCorpse) corpseHunt = { name: freshCorpse.name, x: freshCorpse.x, z: freshCorpse.z, until: now + 5000 };
    let target = null;
    if (corpseHunt && now < corpseHunt.until) {
      const c = snap.players.find((p) => p.name === corpseHunt.name && p.team === me.team && p.alive === false);
      if (c && c.y > -50) { corpseHunt.x = c.x; corpseHunt.z = c.z; }
      target = { x: corpseHunt.x, z: corpseHunt.z, name: corpseHunt.name, hunt: true };
    } else corpseHunt = null;
    const guides = [...guideTrails.entries()]
      .map(([name, trail]) => {
        const b = trail[trail.length - 1];
        const crumb = [...trail].reverse().find((q) => now - q.t >= BREADCRUMB_LAG) ?? trail[0];
        const moved = trail.length > 1
          ? Math.hypot(b.x - trail[0].x, b.z - trail[0].z)
          : 0;
        return { name, moved, x: crumb.x, z: crumb.z, current: { x: b.x, z: b.z } };
      })
      .sort((a, b) => (b.moved - a.moved) ||
        (Math.hypot(a.current.x - me.x, a.current.z - me.z) - Math.hypot(b.current.x - me.x, b.current.z - me.z)));
    // Guide hysteresis: keep following the current guide while it still moves,
    // so two advancing bots cannot yank the host back and forth.
    const guide = (guideName && guides.find((g) => g.name === guideName && g.moved >= 0.5)) ?? guides[0];
    guideName = guide?.name ?? null;
    if (!target && guide) {
      // The guide's current position, not the breadcrumb, decides whether the
      // host has caught up with a stationary teammate (arrived at the fight).
      const guideDist = Math.hypot(guide.current.x - me.x, guide.current.z - me.z);
      if (guide.moved < 0.5 && guideDist < 3) {
        arrivedStreak++;
        // Camping escalation: after ~6s next to an idle teammate, tour the
        // FARTHEST living teammate — a different site — to hunt the defense.
        if (arrivedStreak >= 12) {
          const far = guides
            .filter((g) => Math.hypot(g.current.x - me.x, g.current.z - me.z) > 6)
            .sort((a, b) => Math.hypot(b.current.x - me.x, b.current.z - me.z) - Math.hypot(a.current.x - me.x, a.current.z - me.z))[0];
          if (far) target = { x: far.current.x, z: far.current.z, name: far.name, tour: true };
        }
        if (!target) {
          steps.push({ reason: 'arrived', target: guide.name, dist: +guideDist.toFixed(2) });
          await host.waitForTimeout(250);
          continue;
        }
      } else arrivedStreak = 0;
      if (!target) target = { x: guide.x, z: guide.z, name: guide.name };
    }
    if (!target) { await host.waitForTimeout(300); continue; }
    // Stall detection: the host covered < 0.4m over the recent 2.5s window
    // while trying to walk. Side-step turn (alternating) to break free.
    const hostMoved = hostTrail.length >= 3
      ? Math.hypot(hostTrail[hostTrail.length - 1].x - hostTrail[0].x, hostTrail[hostTrail.length - 1].z - hostTrail[0].z)
      : 1;
    if (hostMoved < 0.4) stuckStrikes++; else stuckStrikes = Math.max(0, stuckStrikes - 1);
    if (stuckStrikes >= 3) {
      steps.push(await host.evaluate(unstickTurn(unstickSide)));
      unstickSide = -unstickSide;
      stuckStrikes = 0;
    } else {
      steps.push(await host.evaluate(hostApproach(target)));
    }
    await host.keyboard.down('KeyW');
    await host.waitForTimeout(360);
    await host.keyboard.up('KeyW');
  }
  if (!victim) {
    const snap = await host.evaluate(() => window.__BREACHLINE__?.snapshot?.());
    const me = snap?.players.find((p) => p.name === 'Death Host');
    if (me && me.alive === false) victim = 'Death Host';
    else {
      console.error('ENGAGEMENT TELEMETRY (last 16 steps):');
      console.error(JSON.stringify(steps.slice(-16), null, 1));
      throw Error(`no corpse within the engagement window (last step: ${steps[steps.length - 1]?.reason ?? 'none'})`);
    }
  }

  // The victim's Death1 fall is in flight RIGHT NOW: capture it immediately
  // from the host's first-person view (the crosshair is on the fight, and the
  // host may itself be killed within seconds), then the frozen final frame
  // once the non-looping run completes (~3.3s after the kill).
  await host.screenshot({ path: resolve(outputDir, 'source-death-lan-fall-mid.png') });
  await host.waitForTimeout(3000);
  await host.screenshot({ path: resolve(outputDir, 'source-death-lan-final-frame.png') });

  const hostSamples = await host.evaluate(() => {
    clearInterval(window.__DEATH_TIMER__);
    return window.__DEATH_SAMPLES__;
  });
  const peerSamples = await peer.evaluate(() => {
    clearInterval(window.__DEATH_TIMER__);
    return window.__DEATH_SAMPLES__;
  });

  const hostAudit = auditDeath(hostSamples, victim, 'host');
  const peerAudit = auditDeath(peerSamples, victim, 'peer');

  // Cross-client agreement: same cycle at matched offsets from the first death
  // sample on each side.
  if (hostAudit.t0 !== undefined && peerAudit.t0 !== undefined) {
    const a = hostAudit.samples.filter((r) => r.state === 'Death');
    const b = peerAudit.samples.filter((r) => r.state === 'Death');
    if (!a.length || !b.length) hostAudit.issues.push('missing Death samples for cross-client comparison');
    else {
      let worst = 0, compared = 0;
      for (const s of b) {
        let best = null;
        for (const r of a) { const d = Math.abs(r.t - s.t); if (!best || d < best.d) best = { d, r }; }
        if (best.d < 0.15) { worst = Math.max(worst, Math.abs(best.r.cycle - s.cycle)); compared++; }
      }
      if (compared < b.length * 0.5) hostAudit.issues.push(`only ${compared}/${b.length} peer samples aligned with host samples`);
      if (worst > 0.06) hostAudit.issues.push(`host/peer death cycle diverged by ${worst.toFixed(4)} at matched times`);
      else hostAudit.crossClientMaxCycleDelta = +worst.toFixed(5);
    }
  }

  const hostPoseVersion = await host.evaluate(() =>
    window.__BREACHLINE__.snapshot()?.players?.find((p) => p.name === 'Death Host')?.sourcePoseVersion);
  const peerPoseVersion = await peer.evaluate(() =>
    window.__BREACHLINE__.snapshot()?.players?.find((p) => p.name === 'Death Host')?.sourcePoseVersion);
  if (hostPoseVersion !== peerPoseVersion)
    hostAudit.issues.push(`host/peer pose versions differ: ${hostPoseVersion} vs ${peerPoseVersion}`);

  // Leave the round cleanly from both clients.
  for (const page of [peer, host]) {
    await pauseToMenu(page);
    await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
  }
  await host.waitForFunction(() =>
    fetch('/api/rooms').then((r) => r.json()).then((r) => r.rooms.every((x) => x.name !== roomName)), null, { timeout: 15000 });

  if (errors.length) hostAudit.issues.push(...errors);
  const evidence = {
    scope: 'Original Dust2 two-client LAN, opposite teams. The host (the only '
      + 'pointer-locked client, as in the jump validation) advances with its '
      + 'squad: it follows the actively-advancing teammate breadcrumb (full '
      + 'coordinates are always present for teammates) along the real navmesh '
      + 'route and engages through the real mousemove/mousedown path. The '
      + 'victim is whoever dies inside the engagement — an enemy corpse in the '
      + 'host view (crosshair on the fight) or the host itself — and the fall '
      + 'plus the frozen final frame are captured from the host view. Both '
      + 'clients record every player alive/sourcePose at 50ms intervals; the '
      + 'analysis asserts the merged original Death1 playback: state Death, '
      + 'neutral parameters, zero corpse fire layer, monotonic cycle reaching 1 '
      + 'within ~3.2-3.3s, the final-frame lock afterwards, and the corpse '
      + 'retained until the round resets (the audit stops at the respawn), '
      + 'identically on both clients.',
    base, roomName, victim, hostPoseVersion, peerPoseVersion,
    engagement: { steps: steps.length, lastSteps: steps.slice(-6) },
    host: { audit: hostAudit, samples: hostSamples },
    peer: { audit: peerAudit, samples: peerSamples },
    errors,
  };
  writeFileSync(resolve(outputDir, 'source-death-lan-evidence.json'), JSON.stringify(evidence, null, 2));

  const issues = [...hostAudit.issues, ...peerAudit.issues];
  if (issues.length) {
    console.error('DEATH VALIDATION FAILED:\n' + issues.map((i) => `  - ${i}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('DEATH VALIDATION PASSED');
    console.log(`  victim: ${victim}, fall span host ${hostAudit.span}s / peer ${peerAudit.span}s`);
    console.log(`  cross-client max cycle delta: ${hostAudit.crossClientMaxCycleDelta}`);
    console.log(`  poseVersion: ${hostPoseVersion}`);
    console.log(`  evidence: output/playwright/source-death-lan-evidence.json`);
  }
} finally {
  await browser.close();
}
