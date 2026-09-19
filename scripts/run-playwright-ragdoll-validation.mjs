#!/usr/bin/env node
// Real-browser LAN ragdoll validation: two Chromium clients join one Dust2 room
// on opposite teams and the host advances with its squad exactly like the
// death validation until someone dies inside the engagement. Both clients then
// record the authoritative sourceRagdoll state (16 part positions in
// actor-local Source units + settled flag) at 50ms intervals over the LAN
// snapshot path, and the analysis asserts the original VPhysics-style corpse:
// the ragdoll spawns at the death instant, falls under gravity (pelvis drops),
// every part stays finite and above the actor-local ground, motion stops with
// settled=true and the settled positions stay frozen, the corpse survives
// until the respawn, and both clients see identical positions at matched
// times (server-authoritative simulation). The host captures the corpse
// mid-fall and at rest by rendering one frame from a temporary camera aimed at
// the corpse, so a moving host never hides the body it is meant to show.
// Evidence lands in output/playwright/source-ragdoll-lan-evidence.json.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The terrain verifier always prints its machine-readable result as the last
 * line, even when it exits non-zero. */
const parseTerrain = (text) => {
  const line = String(text ?? '').trim().split('\n').reverse().find((row) => row.startsWith('{'));
  try { return line ? JSON.parse(line) : null; } catch { return null; }
};
const base = process.env.RAGDOLL_VALIDATION_BASE || 'http://127.0.0.1:27019';
const roomName = `Dust2 R7 Ragdoll验证 ${Date.now() % 10000}`;
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

// 50ms collector: alive flag + full sourceRagdoll per player, so the analysis
// can lock onto whichever player dies during the engagement.
const collector = `(() => {
  window.__RAG_SAMPLES__ = [];
  window.__RAG_T0__ = performance.now();
  window.__RAG_TIMER__ = setInterval(() => {
    const snap = window.__BREACHLINE__?.snapshot?.();
    if (!snap) return;
    window.__RAG_SAMPLES__.push({
      t: (performance.now() - window.__RAG_T0__) / 1000,
      phase: snap.phase ?? null,
      players: snap.players.map((p) => ({
        name: p.name, team: p.team, bot: !!p.bot, alive: p.alive, x: p.x, y: p.y, z: p.z, yaw: p.yaw,
        ragdoll: p.sourceRagdoll ? { positions: p.sourceRagdoll.positions, settled: !!p.sourceRagdoll.settled } : null,
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

// Audit the authoritative ragdoll playback recorded on one client. The corpse
// persists until the round reset, so the audit window ends at the respawn.
function auditRagdoll(samples, name, label) {
  const issues = [];
  const rows = samples.map((s) => ({ t: s.t, p: s.players.find((p) => p.name === name) }));
  const firstDeath = rows.findIndex((r, i) => r.p && r.p.alive === false && i > 0 && rows[i - 1].p?.alive !== false);
  if (firstDeath < 0) { issues.push(`${label}: never observed ${name} dying`); return { issues }; }
  const t0 = rows[firstDeath].t;
  let respawn = Infinity;
  for (let i = firstDeath + 1; i < rows.length; i++) {
    if (rows[i].p?.alive === true) { respawn = rows[i].t; break; }
  }
  const death = rows.filter((r) => r.t >= t0 - 0.001 && r.t < respawn);
  const rag = death.map((r) => ({ t: +(r.t - t0).toFixed(3), rag: r.p?.ragdoll ?? null }));
  const withRag = rag.filter((r) => r.rag);
  if (withRag.length < 40) issues.push(`${label}: only ${withRag.length} ragdoll samples before respawn`);
  if (rag.length > withRag.length + 1)
    issues.push(`${label}: ${rag.length - withRag.length} dead samples carry no sourceRagdoll`);
  if (!withRag.length) return { issues, t0, respawnAt: respawn === Infinity ? null : +(respawn - t0).toFixed(3) };
  // Every sample: 48 finite part positions.
  for (const r of withRag) {
    const pos = r.rag.positions;
    if (!Array.isArray(pos) || pos.length !== 48 || !pos.every((v) => Number.isFinite(v))) {
      issues.push(`${label}: malformed ragdoll positions at t=${r.t}`); break;
    }
  }
  // The pelvis (part 0) drops along the pose frame's up axis (+Z) from the
  // standing death frame. Reporting Y here (as this audit first did) measured
  // the frame's forward axis, not gravity.
  const pelvisZ = withRag.map((r) => r.rag.positions[2]);
  const startPelvis = pelvisZ[0];
  const endPelvis = pelvisZ[pelvisZ.length - 1];
  if (startPelvis === undefined) issues.push(`${label}: no pelvis samples`);
  else {
    if (startPelvis < 0) issues.push(`${label}: ragdoll spawned at pelvis z ${startPelvis.toFixed(2)}, death frame expected near standing height`);
    if (Math.min(...pelvisZ) > endPelvis + 6) issues.push(`${label}: pelvis never settled near its minimum (${Math.min(...pelvisZ).toFixed(2)} vs end ${endPelvis?.toFixed(2)})`);
    if (endPelvis > startPelvis - 5) issues.push(`${label}: pelvis only dropped ${(startPelvis - endPelvis).toFixed(2)} units, corpse did not fall`);
  }
  // The corpse may now rest on real terrain, so a part sitting a little below
  // the death-frame plane is correct behaviour (a foot on a step or slope). This
  // only catches a part sinking or being launched: the original surface under
  // every recorded frame is checked out-of-process against the real Dust2
  // collision in verify-ragdoll-terrain.mjs.
  for (const r of withRag) {
    let lowest = Infinity;
    for (let i = 0; i < 16; i++) lowest = Math.min(lowest, r.rag.positions[i * 3 + 2]);
    if (lowest < -120) { issues.push(`${label}: part sank far below the ground plane at t=${r.t} (z ${lowest.toFixed(2)})`); break; }
  }
  // The corpse settles: settled=true arrives, and stays.
  const firstSettled = withRag.find((r) => r.rag.settled);
  if (!firstSettled) issues.push(`${label}: ragdoll never reported settled before respawn`);
  else {
    if (firstSettled.t < 0.3) issues.push(`${label}: settled suspiciously early at t=${firstSettled.t}`);
    const after = withRag.filter((r) => r.t > firstSettled.t);
    if (after.some((r) => !r.rag.settled)) issues.push(`${label}: settled flag flickered off after t=${firstSettled.t}`);
    // Once settled, positions freeze exactly.
    const frozen = after.map((r) => r.rag.positions.join(','));
    if (new Set(frozen).size > 1) issues.push(`${label}: settled positions kept changing (${new Set(frozen).size} distinct frames)`);
  }
  // Motion happens before rest: at least some early samples must move.
  if (withRag.length > 8) {
    const a = withRag[2].rag.positions, b = withRag[Math.min(8, withRag.length - 1)].rag.positions;
    let moved = 0;
    for (let i = 0; i < 48; i++) moved = Math.max(moved, Math.abs(a[i] - b[i]));
    if (moved < 2) issues.push(`${label}: corpse barely moved between samples 2 and 8 (${moved.toFixed(2)} units), no fall dynamics`);
  }
  // Horizontal travel of the pelvis from the death frame: the killing impulse is
  // a throw, not a glider, so the corpse must come to rest near where it died.
  const firstFrame = withRag[0].rag.positions, lastFrame = withRag[withRag.length - 1].rag.positions;
  const travel = Math.hypot(lastFrame[0] - firstFrame[0], lastFrame[1] - firstFrame[1]);
  if (travel > 120) issues.push(`${label}: corpse glided ${travel.toFixed(1)} units from where it died`);
  return {
    issues, t0,
    respawnAt: respawn === Infinity ? null : +(respawn - t0).toFixed(3),
    settledAt: firstSettled?.t ?? null,
    pelvisDrop: startPelvis !== undefined && endPelvis !== undefined ? +(startPelvis - endPelvis).toFixed(2) : null,
    pelvisTravel: +travel.toFixed(2),
    samples: withRag.length,
  };
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: process.env.RAGDOLL_VALIDATION_HEADED ? false : true,
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
  await host.getByRole('textbox', { name: '呼号', exact: true }).fill('Ragdoll Host');
  await host.getByRole('button', { name: '创建房间', exact: true }).click();
  await host.getByLabel('房间名称', { exact: true }).fill(roomName);
  await host.getByRole('button', { name: '创建并进入房间', exact: true }).click();
  await host.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.players?.some((p) => p.name === 'Ragdoll Host'));
  await pauseToMenu(host);

  const peer = await context.newPage();
  observe(peer, errors);
  await peer.goto(`${base}/?map=de_dust2`);
  await peer.waitForFunction(
    () => window.__BREACHLINE__?.assetAudit()?.character?.id?.startsWith('csgo-t-ak-12426148') &&
      window.__BREACHLINE__?.assetAudit()?.counterTerrorist?.id?.startsWith('csgo-ct-ak-12426148'),
    null, { timeout: 180000 },
  );
  await peer.getByRole('textbox', { name: '呼号', exact: true }).fill('Ragdoll Peer');
  await peer.getByRole('button', { name: '局域网房间', exact: true }).click();
  await peer.getByRole('listitem').filter({ hasText: roomName }).click();
  await peer.getByRole('button', { name: '加入所选房间', exact: true }).click();
  await peer.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.players?.filter((p) => !p.bot).length === 2);
  await pauseToMenu(peer);

  // Only the host holds the pointer lock (a browser grants it to a single
  // focused page), exactly like the jump/death validations; the peer stays in
  // the menu, still collecting snapshots.
  await host.bringToFront();
  await host.getByRole('button', { name: '继续行动', exact: true }).click();
  await host.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 15000 });
  // The round opens with the original 12s buy freeze where inputs are swallowed
  // server-side; wait for the live phase before moving and firing.
  await host.waitForFunction(() => window.__BREACHLINE__?.snapshot()?.phase === 'live', null, { timeout: 25000 });
  await host.waitForTimeout(300);

  await host.evaluate(collector);
  await peer.evaluate(collector);

  // Engagement: identical strategy to the death validation — the host follows
  // its advancing teammates' breadcrumbs toward the contact point, hunts fresh
  // teammate corpses, side-steps when jammed, and engages any visible enemy
  // through the real aim/fire path. The victim is whoever dies first inside the
  // engagement.
  const hostAim = makeAimStep('Ragdoll Host'), hostApproach = makeApproach('Ragdoll Host');
  const unstickTurn = (side) => `(() => {
    const g = window.__BREACHLINE__.runtime();
    document.dispatchEvent(new MouseEvent('mousemove', {
      movementX: ${(-side * 1.15 / 0.0018).toFixed(1)}, movementY: 0,
    }));
    return { reason: 'unstick', side: ${side}, yaw: +g.yaw.toFixed(3) };
  })()`;
  let victim = null;
  let victimLastPos = null;
  const steps = [];
  const guideTrails = new Map();
  const hostTrail = [];
  let stuckStrikes = 0;
  let unstickSide = 1;
  let arrivedStreak = 0;
  let guideName = null;
  const BREADCRUMB_LAG = 1200;
  // Round freezes and intermissions swallow movement inputs server-side, so
  // the engagement is budgeted in live-phase seconds, not wall-clock: a round
  // reset mid-window must not eat the whole search (observed: the prior
  // passing run found its corpse at t=140s of a 150s wall-clock window).
  const LIVE_BUDGET_MS = 240000;
  const HARD_CAP_MS = 480000;
  const hardStart = Date.now();
  let liveBudget = LIVE_BUDGET_MS;
  let iterStart = Date.now();
  // A guide that keeps moving away is chased at matched speed forever (host
  // and bot both run ~250 u/s; observed a 150s window spent at a constant
  // 85-unit gap). Track per-guide chase progress and rotate guides when a
  // chase never closes.
  const chaseState = new Map(); // guide name -> { since, minDist }
  const guideCooldown = new Map(); // guide name -> until timestamp
  while (liveBudget > 0 && Date.now() - hardStart < HARD_CAP_MS && !victim) {
    const snap = await host.evaluate(() => window.__BREACHLINE__?.snapshot?.());
    const spent = Date.now() - iterStart;
    iterStart = Date.now();
    if (snap.phase === 'live') liveBudget -= spent;
    const me = snap.players.find((p) => p.name === 'Ragdoll Host');
    if (!me || me.alive === false) { victim = 'Ragdoll Host'; break; }
    // The server desensitizes every enemy (alive or dead) that is out of the
    // recipient's sight to x=0/z=0/y=-100, while teammates always keep real
    // positions and the sourceRagdoll stream is never filtered. So any corpse
    // ends the hunt: a teammate corpse is detectable from anywhere on the map,
    // an enemy corpse only while currently witnessed (y > -50). Deaths happen
    // wherever the bots clash, usually far from this client — probing only
    // witnessed enemy corpses starved two 240s runs with zero detections.
    const corpse = snap.players.find((p) => p.alive === false && (p.team === me.team || p.y > -50));
    if (corpse) {
      victim = corpse.name;
      victimLastPos = { x: corpse.x, y: corpse.y, z: corpse.z };
      break;
    }
    if (snap.players.some((p) => p.team !== me.team && p.alive && p.y > -50)) {
      stuckStrikes = 0;
      arrivedStreak = 0;
      steps.push(await host.evaluate(hostAim));
      continue;
    }
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
    let target = null;
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
    const freshGuides = guides.filter((g) => (guideCooldown.get(g.name) ?? 0) <= now);
    const guidePool = freshGuides.length ? freshGuides : guides;
    const guide = (guideName && guidePool.find((g) => g.name === guideName && g.moved >= 0.5)) ?? guidePool[0];
    guideName = guide?.name ?? null;
    let rotateGuide = false;
    if (!target && guide) {
      const guideDist = Math.hypot(guide.current.x - me.x, guide.current.z - me.z);
      const chase = chaseState.get(guide.name);
      if (chase && now - chase.since > 12000 && chase.minDist > 15 && guideDist > chase.minDist - 5) {
        guideCooldown.set(guide.name, now + 10000);
        chaseState.delete(guide.name);
        guideName = null;
        rotateGuide = true;
        steps.push({ reason: 'rotate-guide', from: guide.name, dist: +guideDist.toFixed(2) });
      } else if (chase) chase.minDist = Math.min(chase.minDist, guideDist);
      else chaseState.set(guide.name, { since: now, minDist: guideDist });
    }
    if (!target && guide && !rotateGuide) {
      const guideDist = Math.hypot(guide.current.x - me.x, guide.current.z - me.z);
      if (guide.moved < 0.5 && guideDist < 3) {
        arrivedStreak++;
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
    const me = snap?.players.find((p) => p.name === 'Ragdoll Host');
    if (me && me.alive === false) victim = 'Ragdoll Host';
    else {
      console.error('ENGAGEMENT TELEMETRY (last 16 steps):');
      console.error(JSON.stringify(steps.slice(-16), null, 1));
      const liveUsed = Math.round((LIVE_BUDGET_MS - liveBudget) / 1000);
      throw Error(`no corpse within the engagement window (${liveUsed}s live budget of ${LIVE_BUDGET_MS / 1000}s spent; last step: ${steps[steps.length - 1]?.reason ?? 'none'})`);
    }
  }

  // The corpse is falling RIGHT NOW. The first-person view only frames a body
  // when the host happens to be looking at it, so the visual evidence is
  // rendered from a temporary camera aimed at the corpse's authoritative origin
  // and read back from the canvas: one frame mid-flight and one after the rest
  // pose freezes. The host camera is restored inside the same call, before the
  // next game frame, so the running client is untouched.
  const captureCorpse = async (file, sizeFactor, heightFactor) => {
    const url = await host.evaluate(`(() => {
      const g = window.__BREACHLINE__.runtime();
      const snap = window.__BREACHLINE__.snapshot();
      const corpse = snap.players.find((p) => p.name === ${JSON.stringify(victim)});
      const actor = corpse ? g.art.actors.get(corpse.id) : null;
      const cam = g.art.camera, renderer = g.art.renderer;
      // Frame the body from its own rendered bones: the actor origin is not the
      // body (a corpse lies away from the feet), and the camera may hang under a
      // scaled rig, so the desired world position goes back through the parent.
      const rows = [];
      if (actor) actor.traverse((o) => {
        if (!o.isSkinnedMesh || !o.skeleton) return;
        for (const bone of o.skeleton.bones)
          if (bone.name.includes('ValveBipedBip01'))
            rows.push(bone.getWorldPosition(new o.position.constructor()));
      });
      if (!rows.length) return null;
      const axis = (get) => rows.map(get);
      const centre = {
        x: (Math.min(...axis((v) => v.x)) + Math.max(...axis((v) => v.x))) / 2,
        y: (Math.min(...axis((v) => v.y)) + Math.max(...axis((v) => v.y))) / 2,
        z: (Math.min(...axis((v) => v.z)) + Math.max(...axis((v) => v.z))) / 2,
      };
      const size = Math.max(
        Math.max(...axis((v) => v.x)) - Math.min(...axis((v) => v.x)),
        Math.max(...axis((v) => v.y)) - Math.min(...axis((v) => v.y)),
        Math.max(...axis((v) => v.z)) - Math.min(...axis((v) => v.z)));
      const me = snap.players.find((p) => p.id === g.you) ?? centre;
      let ax = me.x - centre.x, az = me.z - centre.z, len = Math.hypot(ax, az);
      if (len < 0.3) { ax = 1; az = 0; len = 1; }
      const Vec3 = rows[0].constructor;
      const savedPosition = cam.position.clone(), savedRotation = cam.quaternion.clone();
      const desired = new Vec3(
        centre.x + (ax / len) * size * ${sizeFactor},
        centre.y + size * ${heightFactor},
        centre.z + (az / len) * size * ${sizeFactor});
      cam.position.copy(cam.parent ? cam.parent.worldToLocal(desired) : desired);
      cam.lookAt(centre.x, centre.y, centre.z);
      cam.updateMatrixWorld(true);
      renderer.render(g.art.scene, cam);
      const frame = renderer.domElement.toDataURL('image/png');
      cam.position.copy(savedPosition); cam.quaternion.copy(savedRotation); cam.updateMatrixWorld(true);
      return frame;
    })()`);
    if (!url) return console.log(`corpse capture skipped for ${file} (no rendered bones)`);
    if (!url.startsWith('data:image/png;base64,')) throw Error(`corpse capture failed for ${file}`);
    writeFileSync(resolve(outputDir, file), Buffer.from(url.split(',')[1], 'base64'));
  };
  await captureCorpse('source-ragdoll-lan-fall-mid.png', 2.0, 0.9);
  // Wait for the authority to report the corpse at rest before the second
  // capture and the audit, so both see the frozen pose instead of a mid-fall
  // frame; the bounded wait still lets a corpse that never settles fail loudly.
  const settledInTime = await host.waitForFunction((name) => {
    const p = window.__BREACHLINE__.snapshot()?.players?.find((x) => x.name === name);
    return !!p?.sourceRagdoll?.settled;
  }, victim, { timeout: 25000 }).then(() => true).catch(() => false);
  if (!settledInTime) console.log('corpse did not report settled within 25s of the kill');
  await captureCorpse('source-ragdoll-lan-settled.png', 1.7, 0.7);
  // Let both collectors record a couple of seconds of the frozen rest pose; the
  // cross-client comparison needs enough aligned settled frames to certify that
  // the authority's rest pose really is identical on both clients.
  await host.waitForTimeout(2000);

  // The positions being above the ground is not the same as the body lying on
  // it, so audit the RENDERED skeleton too: a corpse at rest must have a flat
  // vertical footprint (a standing or inverted body spans the full ~1.7m
  // standing height), and its head must not sit below its pelvis. The world
  // weapon rides its own merged bones, so the character skeleton is measured
  // separately from whatever else the actor carries.
  const corpseRender = await host.evaluate(`(() => {
    const g = window.__BREACHLINE__.runtime();
    const snap = window.__BREACHLINE__.snapshot();
    const corpse = snap.players.find((p) => p.name === ${JSON.stringify(victim)});
    const actor = corpse ? g.art.actors.get(corpse.id) : null;
    if (!actor) return { found: false };
    const all = [], character = [];
    actor.traverse((o) => {
      if (!o.isSkinnedMesh || !o.skeleton) return;
      for (const bone of o.skeleton.bones) {
        const p = bone.getWorldPosition(new o.position.constructor());
        const row = { mesh: o.name, name: bone.name, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) };
        all.push(row);
        // The world weapon shares merged bones and carries camera-rig helpers
        // (cam_driver / camera_*) that never follow the corpse, so the body is
        // measured on the character's own ValveBipedBip01 bones only.
        if (bone.name.includes('ValveBipedBip01')) character.push(row);
      }
    });
    if (!all.length) return { found: false };
    const spanOf = (rows, axis) => {
      const v = rows.map((r) => r[axis]);
      return +(Math.max(...v) - Math.min(...v)).toFixed(3);
    };
    const named = (rows, fragment) => rows.find((b) => b.name.includes(fragment)) ?? null;
    const body = character.length ? character : all;
    const sorted = [...body].sort((a, b) => a.y - b.y);
    return {
      found: true, allBones: all.length, characterBones: body.length,
      span: spanOf(body, 'y'),
      groundSpan: Math.max(spanOf(body, 'x'), spanOf(body, 'z')),
      minY: sorted[0].y, maxY: sorted[sorted.length - 1].y,
      lowest: [...all].sort((a, b) => a.y - b.y).slice(0, 2),
      highest: [...all].sort((a, b) => b.y - a.y).slice(0, 2),
      actorY: +actor.position.y.toFixed(3),
      head: named(body, 'Head'), pelvis: named(body, 'Pelvis'),
    };
  })()`);
  console.log('corpse render audit:', JSON.stringify(corpseRender));

  const hostSamples = await host.evaluate(() => {
    clearInterval(window.__RAG_TIMER__);
    return window.__RAG_SAMPLES__;
  });
  const peerSamples = await peer.evaluate(() => {
    clearInterval(window.__RAG_TIMER__);
    return window.__RAG_SAMPLES__;
  });

  const hostAudit = auditRagdoll(hostSamples, victim, 'host');
  const peerAudit = auditRagdoll(peerSamples, victim, 'peer');
  // A corpse at rest spans a body's thickness vertically. Standing (or a body
  // simulated in the wrong axis, which the renderer draws upright) spans the
  // full ~1.7m standing height instead, so this catches a regression the
  // numeric part positions alone cannot: they stay self-consistent either way.
  // Measured on the character bones, since the world weapon's camera-rig helper
  // bones sit at fixed offsets that ignore the corpse entirely.
  if (!corpseRender.found) hostAudit.issues.push('corpse render audit found no skinned corpse bones');
  else {
    if (corpseRender.span > 1.1)
      hostAudit.issues.push(`corpse character bones span ${corpseRender.span}m vertically, expected a flat body on the ground`);
    if (corpseRender.span > corpseRender.groundSpan)
      hostAudit.issues.push(`corpse is taller (${corpseRender.span}m) than it is wide (${corpseRender.groundSpan}m), expected it lying across the ground`);
    if (corpseRender.head && corpseRender.pelvis && corpseRender.head.y - corpseRender.pelvis.y < -0.6)
      hostAudit.issues.push(`corpse head sits ${(corpseRender.head.y - corpseRender.pelvis.y).toFixed(2)}m below its pelvis`);
  }

  // Cross-client agreement: both clients record the same server-authoritative
  // stream through independent 50ms collectors, so flight frames at matched
  // relative times sit tens of milliseconds apart in true time while the corpse
  // moves hundreds of units/s. Compare in-flight frames with a velocity-aware
  // tolerance (|v| * matched-skew + slack) and demand bit-identical positions
  // once both sides report the corpse settled.
  if (hostAudit.t0 !== undefined && peerAudit.t0 !== undefined) {
    const rowsA = hostSamples
      .map((s) => ({ t: s.t, p: s.players.find((p) => p.name === victim) }))
      .filter((r) => r.p && r.p.alive === false && r.p.ragdoll)
      .map((r) => ({ t: r.t - hostAudit.t0, pos: r.p.ragdoll.positions, settled: r.p.ragdoll.settled }));
    const rowsB = peerSamples
      .map((s) => ({ t: s.t, p: s.players.find((p) => p.name === victim) }))
      .filter((r) => r.p && r.p.alive === false && r.p.ragdoll)
      .map((r) => ({ t: r.t - peerAudit.t0, pos: r.p.ragdoll.positions, settled: r.p.ragdoll.settled }));
    if (!rowsA.length || !rowsB.length) hostAudit.issues.push('missing ragdoll samples for cross-client comparison');
    else {
      const speedsOf = (rows) => rows.map((r, i) => {
        if (!i) return 0;
        const prev = rows[i - 1], dt = r.t - prev.t;
        if (dt <= 0) return 0;
        let d = 0;
        for (let k = 0; k < 48; k++) d = Math.max(d, Math.abs(r.pos[k] - prev.pos[k]));
        return d / dt;
      });
      const speedsA = speedsOf(rowsA), speedsB = speedsOf(rowsB);
      // Impact reverses speed within a single sample, so judge each frame by
      // the fastest speed in its neighborhood, not the frame's own delta.
      const neighborhoodSpeed = (speeds, i) => Math.max(speeds[i] ?? 0, speeds[i - 1] ?? 0, speeds[i + 1] ?? 0);
      // 0.1s absorbs the worst combined anchor + sampling-phase skew between
      // the collectors (independent first-death samples + 50ms phases); 1.5
      // units covers solver curvature between 50ms samples at impact.
      const ANCHOR_SKEW = 0.1, CURVATURE_SLACK = 1.5;
      let settledCompared = 0, flightCompared = 0, worstSettled = 0, worstFlightExcess = 0, worstSettledMismatch = 0;
      for (let bi = 0; bi < rowsB.length; bi++) {
        const s = rowsB[bi];
        let best = null;
        for (let ai = 0; ai < rowsA.length; ai++) { const d = Math.abs(rowsA[ai].t - s.t); if (!best || d < best.d) best = { d, ai }; }
        if (best.d >= 0.15) continue;
        const r = rowsA[best.ai];
        let delta = 0;
        for (let i = 0; i < 48; i++) delta = Math.max(delta, Math.abs(r.pos[i] - s.pos[i]));
        if (r.settled && s.settled) {
          settledCompared++;
          worstSettled = Math.max(worstSettled, delta);
        } else {
          const speed = Math.max(neighborhoodSpeed(speedsA, best.ai), neighborhoodSpeed(speedsB, bi));
          const allowed = speed * (best.d + ANCHOR_SKEW) + CURVATURE_SLACK;
          flightCompared++;
          worstFlightExcess = Math.max(worstFlightExcess, delta - allowed);
        }
        if (r.settled !== s.settled) worstSettledMismatch++;
      }
      const compared = settledCompared + flightCompared;
      if (compared < rowsB.length * 0.5) hostAudit.issues.push(`only ${compared}/${rowsB.length} peer samples aligned with host samples`);
      if (settledCompared < 5) hostAudit.issues.push(`only ${settledCompared} settled frames matched across clients, cannot certify an identical rest pose`);
      if (worstSettled > 1e-6) hostAudit.issues.push(`host/peer settled positions diverged by ${worstSettled.toFixed(6)} units (server-authoritative rest pose must be identical)`);
      if (worstFlightExcess > 0) hostAudit.issues.push(`host/peer in-flight positions exceeded the velocity-aware tolerance by ${worstFlightExcess.toFixed(4)} units`);
      else hostAudit.crossClient = {
        compared, settledCompared, flightCompared,
        settledMaxDelta: +worstSettled.toFixed(6),
        flightMaxExcess: +worstFlightExcess.toFixed(4),
      };
      if (worstSettledMismatch > compared * 0.1)
        hostAudit.issues.push(`host/peer settled flag disagreed on ${worstSettledMismatch}/${compared} aligned samples`);
    }
  }

  const hostPoseVersion = await host.evaluate(() =>
    window.__BREACHLINE__.snapshot()?.players?.find((p) => p.name === 'Ragdoll Host')?.sourcePoseVersion);
  const peerPoseVersion = await peer.evaluate(() =>
    window.__BREACHLINE__.snapshot()?.players?.find((p) => p.name === 'Ragdoll Host')?.sourcePoseVersion);
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
    scope: 'Original Dust2 two-client LAN, opposite teams. The host advances with '
      + 'its squad and engages through the real mousemove/mousedown path; the '
      + 'victim is whoever dies inside the engagement. Both clients record every '
      + 'player alive/sourceRagdoll at 50ms intervals; the analysis asserts the '
      + 'server-authoritative original VPhysics-style ragdoll: spawns at the '
      + 'death instant, falls under gravity along the original +Z pose axis, stays '
      + 'finite, settles with frozen positions, survives until the respawn, and '
      + 'agrees across both clients: bit-identical positions once settled, '
      + 'velocity-aware tolerance during the fall. Every recorded corpse frame is '
      + 'then replayed against the real Dust2 collision out of process '
      + '(scripts/verify-ragdoll-terrain.mjs), so the corpse must rest on the '
      + 'original surface under it and never inside the map.',
    base, roomName, victim, hostPoseVersion, peerPoseVersion,
    engagement: { steps: steps.length, lastSteps: steps.slice(-6) },
    host: { audit: hostAudit },
    peer: { audit: peerAudit },
    errors,
  };
  const evidencePath = resolve(outputDir, 'source-ragdoll-lan-evidence.json');
  writeFileSync(evidencePath, JSON.stringify({ ...evidence, samples: hostSamples }, null, 2));

  // Replay the recorded corpse frames against the real Dust2 collision: the
  // browser client has no physics world, so the original surface under each part
  // is only checkable out of process.
  let terrain = { issues: [], measured: null };
  try {
    const output = execFileSync(process.execPath, ['--import', 'tsx', resolve(root, 'scripts/verify-ragdoll-terrain.ts'), evidencePath],
      { cwd: root, encoding: 'utf8' });
    terrain = parseTerrain(output) ?? terrain;
  } catch (error) {
    // A failing verifier exits non-zero, but still prints its result line.
    terrain = parseTerrain(error.stdout) ?? { issues: [`terrain replay failed: ${String(error.stdout ?? error.stderr ?? error.message).trim().split('\n').slice(-3).join(' | ').slice(-300)}`], measured: null };
  }
  hostAudit.issues.push(...terrain.issues);
  evidence.terrain = terrain.measured;
  writeFileSync(evidencePath, JSON.stringify({ ...evidence, samples: hostSamples }, null, 2));

  const issues = [...hostAudit.issues, ...peerAudit.issues];
  if (issues.length) {
    console.error('RAGDOLL VALIDATION FAILED:\n' + issues.map((i) => `  - ${i}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('RAGDOLL VALIDATION PASSED');
    console.log(`  victim: ${victim}, settled host t=${hostAudit.settledAt}s / peer t=${peerAudit.settledAt}s`);
    console.log(`  pelvis drop: host ${hostAudit.pelvisDrop} / peer ${peerAudit.pelvisDrop} Source units`);
    console.log(`  pelvis travel from the death frame: host ${hostAudit.pelvisTravel} / peer ${peerAudit.pelvisTravel} Source units`);
    console.log(`  cross-client: ${hostAudit.crossClient?.compared} frames (${hostAudit.crossClient?.settledCompared} settled@${hostAudit.crossClient?.settledMaxDelta} max delta, ${hostAudit.crossClient?.flightCompared} flight, tolerance excess ${hostAudit.crossClient?.flightMaxExcess})`);
    if (terrain.measured?.evidence)
      console.log(`  real-surface replay: ${terrain.measured.evidence.settledOnOriginalSurface} settled frames on the original surface,`
        + ` ${terrain.measured.evidence.settledOnDeathFramePlane} on the death-frame plane (columns the original collision leaves empty),`
        + ` ${terrain.measured.evidence.partsChecked} part surfaces checked, worst ${terrain.measured.evidence.worstSinkBelowSurface}m inside the map`);
    console.log(`  poseVersion: ${hostPoseVersion}`);
    console.log(`  evidence: output/playwright/source-ragdoll-lan-evidence.json`);
  }
} finally {
  await browser.close();
}
