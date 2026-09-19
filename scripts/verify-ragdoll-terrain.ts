#!/usr/bin/env node
// Real-Dust2 verification of the authoritative corpse terrain collision, driven
// through the SAME driver API the authority uses
// (createSourceRagdollPoseDriver -> ragdoll.beginRagdoll/stepRagdoll with a
// ground query built from the loaded original level).
//
// It builds the original Dust2 level collision in Rapier and asserts:
//  - a corpse killed four metres in the air, under clear headroom, falls and
//    comes to rest ON the original surface below it (never at the height it died,
//    never sunk through),
//  - a body straddling a real height discontinuity reads the surface under each
//    of its own parts, so it rests on both original levels,
//  - a part with no original surface under it (a real void) keeps the death-frame
//    plane instead of inventing support or sinking out of the world.
// Evidence lands in output/playwright/source-ragdoll-terrain-evidence.json.
import RAPIER from '@dimforge/rapier3d-compat';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCharacterCpuFixture } from './validate-source-character-actor';
import { createSourceLevel, type SourceLevelData } from '../game/source-level';
import type { SourceMapCollisionData } from '../game/source-map-collision';
import { bindSourceRagdoll, computeSourceRagdollRestFromDeath1, createSourceRagdollPoseDriver,
  parseSourceRagdollData, spawnSourceRagdoll, updateSourceRagdollGround, SOURCE_RAGDOLL_DEATH_REST_INPUT,
  type SourceRagdollGround } from '../game/source-ragdoll';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const SOURCE = resolve(root, 'public/source/csgo-12426148');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
type Actor = { x: number; y: number; z: number; yaw: number };

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -22, z: 0 });
const levelData = read(resolve(SOURCE, 'dust2/level.json')) as SourceLevelData;
const level = createSourceLevel(world, levelData, read(resolve(SOURCE, 'dust2/collision.json')) as SourceMapCollisionData);
world.step();

const fixture = await loadCharacterCpuFixture();
const ragdollData = parseSourceRagdollData(read(resolve(SOURCE, 'ragdoll/ragdoll-data.json')));
const index = bindSourceRagdoll(ragdollData, fixture.poseIndex);
const rest = computeSourceRagdollRestFromDeath1(index, fixture.poseIndex).rest;
// The base pose driver is only spread through; the ragdoll is what is under test.
const driver = createSourceRagdollPoseDriver({ id: 'terrain-verify', advance: () => SOURCE_RAGDOLL_DEATH_REST_INPUT },
  fixture.poseIndex, ragdollData).ragdoll!;
const scale = levelData.metersPerSourceUnit;
const parts = index.data.parts.length;
const TICK = 1 / 64;

const ground = (actor: Actor): SourceRagdollGround => ({ ...actor, metersPerSourceUnit: scale,
  surfaceY: (x, z, fromY) => level.groundHeight(x, z, fromY) });
/** Actor-local Source part position -> world metres, the same conversion the
 * renderer applies (verified against the rendered skeleton). */
const partWorld = (actor: Actor, positions: ArrayLike<number>, part: number) => {
  const px = positions[part * 3], py = positions[part * 3 + 1], pz = positions[part * 3 + 2];
  const c = Math.cos(actor.yaw + Math.PI / 2), sn = Math.sin(actor.yaw + Math.PI / 2);
  return { x: actor.x + scale * (c * px - sn * py), y: actor.y + scale * pz, z: actor.z + scale * (-sn * px - c * py) };
};
/** The surface a part's own sphere would rest on: probed from just under the
 * sphere, exactly as the authority's ground update does. */
const surfaceUnder = (point: { x: number; y: number; z: number }, radius: number) =>
  level.groundHeight(point.x, point.z, point.y - radius + .02);
const run = (id: string, actor: Actor) => {
  const query = ground(actor);
  let state = driver.beginRagdoll({ id }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, query), steps = 0;
  while (!state.settled && steps < 2400) { state = driver.stepRagdoll({ id }, TICK, query)!; steps++; }
  return { state, steps };
};
const quantise = (value: number) => Math.round(value * 20) / 20;

const issues: string[] = [];
const measured: Record<string, unknown> = {};

/** A flat column with clear headroom above its original ground, AND enough real
 * surface under every part of the death pose that the corpse is not starting
 * inside geometry. Candidate columns are validated with the authority's own
 * ground update, so the scenario is known-good before it is asserted on. */
function findAirColumn() {
  for (const team of ['blue', 'amber'] as const) {
    const spawn = level.spawns[team][0];
    for (let dx = -14; dx <= 14; dx += .5) for (let dz = -14; dz <= 14; dz += .5) {
      const x = spawn.x + dx, z = spawn.z + dz;
      const floor = level.groundHeight(x, z, spawn.y + 1);
      if (floor === null) continue;
      if (level.groundHeight(x, z, floor + 6.5) !== floor) continue;
      // Flat 1.5m patch: a corpse that slides during the fall cannot end up on a
      // neighbouring crate or ledge, so the drop tests the ground, not the drift.
      let flat = true;
      for (let ox = -1.5; ox <= 1.5 && flat; ox += .75) for (let oz = -1.5; oz <= 1.5 && flat; oz += .75)
        if (Math.abs((level.groundHeight(x + ox, z + oz, floor + 1) ?? Infinity) - floor) > .05) flat = false;
      if (!flat) continue;
      const actor: Actor = { x, y: floor + 4, z, yaw: spawn.yaw };
      const probe = spawnSourceRagdoll(rest, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
      updateSourceRagdollGround(index, probe, ground(actor), rest.groundZ);
      const expected = rest.groundZ - 4 / scale;
      // Every part of the death pose must stand on the real floor, not on the
      // fallback, so this is a genuine mid-air death over genuine ground.
      if (!Array.from(probe.groundZ).every((value) => Math.abs(value - expected) < .5)) continue;
      return { x, z, floor, yaw: spawn.yaw };
    }
  }
  return null;
}
const air = findAirColumn();
if (!air) issues.push('no column with clear headroom and real ground under the whole death pose was found');
else {
  const actor: Actor = { x: air.x, y: air.floor + 4, z: air.z, yaw: air.yaw };
  const { state, steps } = run('air', actor);
  const points = Array.from({ length: parts }, (_, part) => partWorld(actor, state.positions, part));
  const lowestIndex = points.reduce((best, point, at) => point.y < points[best].y ? at : best, 0);
  const lowest = points[lowestIndex].y;
  const surface = surfaceUnder(points[lowestIndex], scale * index.partRadii[lowestIndex]);
  if (!state.settled) issues.push(`air: corpse never settled (${steps} ticks)`);
  if (surface === null) issues.push('air: no original surface under the corpse after settling');
  else {
    if (lowest < surface - 1e-3) issues.push(`air: corpse sank ${(surface - lowest).toFixed(3)}m below the original surface`);
    if (lowest - surface > .45) issues.push(`air: corpse rests ${(lowest - surface).toFixed(3)}m above the original surface`);
    if (actor.y - lowest < 3) issues.push(`air: corpse only fell ${(actor.y - lowest).toFixed(3)}m of its 4m drop`);
  }
  measured.air = { at: [+air.x.toFixed(3), +air.floor.toFixed(3), +air.z.toFixed(3)], deathY: +actor.y.toFixed(3),
    settled: state.settled, ticks: steps, lowestWorldY: +lowest.toFixed(4),
    surfaceUnderLowest: surface === null ? null : +surface.toFixed(4), fell: +(actor.y - lowest).toFixed(4) };
}

/** A real walkable step near a spawn: a body spread across it must read the
 * surface under each of its own parts. The step edge is located to 5cm. */
function findEdge() {
  for (const team of ['blue', 'amber'] as const) {
    const spawn = level.spawns[team][0];
    for (let dx = -14; dx <= 14; dx += .5) for (let dz = -14; dz <= 14; dz += .5) {
      const x = spawn.x + dx, z = spawn.z + dz;
      const low = level.groundHeight(x, z, spawn.y + 4);
      const high = level.groundHeight(x + .5, z, spawn.y + 4);
      if (low === null || high === null || Math.abs(high - low) < .35 || Math.abs(high - low) > 1.5) continue;
      // Locate the edge itself between the two samples.
      let edgeX: number | null = null;
      for (let t = .05; t <= .5; t += .05)
        if ((level.groundHeight(x + t, z, spawn.y + 4) ?? low) > low + .1) { edgeX = x + t; break; }
      if (edgeX === null) continue;
      return { x: edgeX, z, y: Math.max(low, high), yaw: 0, low, high, span: Math.abs(high - low) };
    }
  }
  return null;
}
const edge = findEdge();
if (!edge) issues.push('no original step between 0.35m and 1.5m was found near a spawn');
else {
  const actor: Actor = { x: edge.x, y: edge.y, z: edge.z, yaw: edge.yaw };
  // The standing death pose is a narrow footprint, so spread the parts across
  // the step to place a body straddling it. With yaw 0 one metre of world X is
  // -1/scale of actor-local Y.
  const spread = rest.positions.slice(), metre = 1 / scale;
  for (let part = 0; part < parts; part++) spread[part * 3 + 1] += (part % 2 ? -1 : 1) * .45 * metre;
  const probe = { ...spawnSourceRagdoll(rest, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), positions: spread };
  updateSourceRagdollGround(index, probe, ground(actor), rest.groundZ);
  const grounds = Array.from(probe.groundZ);
  // Every part's ground is the original surface under that part's own position.
  const body = Array.from({ length: parts }, (_, part) => ({ part, at: partWorld(actor, spread, part),
    radius: scale * index.partRadii[part], ground: grounds[part] }));
  for (const row of body) {
    const surface = surfaceUnder(row.at, row.radius);
    const expected = surface === null ? rest.groundZ : (surface - actor.y) / scale;
    if (Math.abs(row.ground - expected) > 1e-9)
      issues.push(`edge: part ${row.part} used ground ${row.ground.toFixed(3)} instead of the surface under it (${expected.toFixed(3)})`);
  }
  // The body really spans more than one original level: on this real step the
  // parts never share one plane the way a single death-frame ground plane forced
  // them to.
  const lowSide = body.filter((row) => row.at.x < edge.x), highSide = body.filter((row) => row.at.x >= edge.x);
  const level = (row: (typeof body)[number]) => quantise(row.ground * scale + actor.y);
  const levels = [...new Set(body.map(level))].sort((a, b) => a - b);
  const levelSpread = levels[levels.length - 1] - levels[0];
  if (lowSide.length < 3 || highSide.length < 3)
    issues.push(`edge: the body did not span the step edge (${lowSide.length} parts below it, ${highSide.length} above)`);
  if (levels.length < 2 || levelSpread < .3)
    issues.push(`edge: every part read the same level (${levels.join('/')}), so the corpse is not following the terrain`);
  const { state } = run('edge', actor);
  for (let part = 0; part < parts; part++) {
    const point = partWorld(actor, state.positions, part);
    const surface = surfaceUnder(point, scale * index.partRadii[part]);
    if (surface !== null && point.y < surface - 1e-3) issues.push(`edge: part ${part} sank below its own surface`);
  }
  measured.edge = { at: [+edge.x.toFixed(3), +edge.y.toFixed(3), +edge.z.toFixed(3)], stepSampleHeight: +edge.span.toFixed(3),
    partsBelowEdge: lowSide.length, partsAboveEdge: highSide.length,
    partLevels: levels, levelSpread: +levelSpread.toFixed(3), settled: state.settled };
}

/** A real void: a column inside the original world bounds with no surface at all
 * below the sky. */
function findVoid() {
  const bounds = levelData.worldBounds;
  for (let x = bounds.min[0]; x <= bounds.max[0]; x += 5) for (let z = bounds.min[2]; z <= bounds.max[2]; z += 5) {
    if (level.groundHeight(x, z, bounds.max[1]) !== null) continue;
    return { x, z, y: bounds.max[1] - 8, yaw: 0 };
  }
  return null;
}
const hole = findVoid();
if (!hole) issues.push('no column without any original surface was found inside the world bounds');
else {
  const actor: Actor = { ...hole };
  const { state } = run('void', actor);
  const points = Array.from({ length: parts }, (_, part) => partWorld(actor, state.positions, part));
  const lowest = Math.min(...points.map((point) => point.y));
  if (points.some((point, part) => surfaceUnder(point, scale * index.partRadii[part]) !== null))
    issues.push('void: the chosen void column actually has an original surface');
  if (!state.settled) issues.push('void: corpse never settled over the void');
  // No invented support and no corpse sinking out of the world: a part with no
  // surface keeps the death-frame plane.
  if (lowest < actor.y + scale * rest.groundZ - 1e-3)
    issues.push(`void: corpse sank ${(actor.y + scale * rest.groundZ - lowest).toFixed(3)}m below the death-frame plane`);
  if (Math.max(...points.map((point) => point.y)) > actor.y + scale * rest.groundZ + 2)
    issues.push('void: corpse was propped up above the death-frame plane');
  measured.void = { at: [+actor.x.toFixed(3), +actor.y.toFixed(3), +actor.z.toFixed(3)], settled: state.settled,
    lowestWorldY: +lowest.toFixed(4), deathPlaneWorldY: +(actor.y + scale * rest.groundZ).toFixed(4) };
}

/** Evidence mode: replay a recorded LAN run's corpse frames against the real
 * Dust2 collision. Every part of every recorded frame must stay out of the
 * original map, and once the corpse has settled its lowest part must be resting
 * on the original surface under it. */
function verifyEvidence(path: string) {
  const evidence = read(path);
  const victim = evidence.victim;
  const frames = [];
  for (const sample of evidence.samples ?? []) {
    const player = (sample.players ?? []).find((row: { name: string }) => row.name === victim);
    if (player?.ragdoll?.positions?.length === parts * 3)
      frames.push({ t: sample.t, at: { x: player.x, y: player.y, z: player.z, yaw: player.yaw }, state: player.ragdoll });
  }
  if (!frames.length) { issues.push(`evidence: no frames of ${victim} carry a ragdoll`); return; }
  const plane = (at: Actor) => at.y + scale * rest.groundZ;
  let partsChecked = 0, worstSink = 0, settledFrames = 0, onSurface = 0, onDeathPlane = 0, unrested = 0;
  for (const frame of frames) {
    let lowest = null, lowestSurface = null;
    for (let part = 0; part < parts; part++) {
      const point = partWorld(frame.at, frame.state.positions, part);
      const surface = surfaceUnder(point, scale * index.partRadii[part]);
      if (!lowest || point.y < lowest.y) { lowest = point; lowestSurface = surface; }
      if (surface === null) continue;
      partsChecked++;
      const depth = surface - point.y;
      if (depth > worstSink) worstSink = depth;
      // 6cm of interpenetration is normal for a position-based solver; anything
      // deeper means a part went through the original map.
      if (depth > .06) issues.push(`evidence: part ${part} was ${depth.toFixed(3)}m inside the original map at t=${Number(frame.t).toFixed(2)}`);
    }
    if (!frame.state.settled) continue;
    if (lowest === null) continue;
    settledFrames++;
    if (lowestSurface !== null) {
      // Resting on the original surface under it.
      if (lowest.y - lowestSurface <= .45) onSurface++;
      else unrested++;
    } else {
      // The original collision has no surface under this column (some interior
      // columns of the map export none), so the part keeps the death-frame plane
      // the corpse was built from: no invented support and no free fall.
      if (Math.abs(lowest.y - plane(frame.at)) <= .45) onDeathPlane++;
      else unrested++;
    }
  }
  if (!settledFrames) issues.push('evidence: the recorded corpse never reported settled');
  if (unrested) issues.push(`evidence: ${unrested} of ${settledFrames} settled corpse frames rested on neither an original surface nor the death-frame plane`);
  measured.evidence = { victim, frames: frames.length, partsChecked, settledFrames,
    settledOnOriginalSurface: onSurface, settledOnDeathFramePlane: onDeathPlane,
    worstSinkBelowSurface: +worstSink.toFixed(4), file: path.replace(`${root}/`, '') };
}

const evidencePath = process.argv[2];
if (evidencePath) verifyEvidence(evidencePath);

const evidence = { scope: 'Original Dust2 collision, authority ragdoll driver API. A corpse killed 4m in the air under '
  + 'clear headroom must fall onto the original surface under it; a body straddling a real step must read the surface '
  + 'under each of its own parts (both original levels); a part with no surface under it keeps the death-frame plane '
  + 'instead of inventing support or sinking out of the world.',
  map: levelData.id, sourceBspSha256: levelData.sourceBspSha256, metersPerSourceUnit: scale, parts, issues, measured };
writeFileSync(resolve(outputDir, 'source-ragdoll-terrain-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
level.dispose(); world.free();

// The last line is always the machine-readable result, so a caller (the LAN
// validation) can report the same measurements it asserts on.
console.log(JSON.stringify({ issues, measured }));
if (issues.length) {
  console.error('RAGDOLL TERRAIN VERIFICATION FAILED:\n' + issues.map((issue) => `  - ${issue}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('RAGDOLL TERRAIN VERIFICATION PASSED');
  for (const [name, row] of Object.entries(measured)) console.log(`  ${name}: ${JSON.stringify(row)}`);
  console.log('  evidence: output/playwright/source-ragdoll-terrain-evidence.json');
}
