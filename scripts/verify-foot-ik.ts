#!/usr/bin/env node
// Real-Dust2 verification of the original player foot IK, driven through the same
// code the renderer runs (`applySourceFootIK` with a ground query built from the
// loaded original level).
//
// It builds the original Dust2 collision in Rapier, then asserts for every
// sampled column of the real map:
//  - the correction is exactly the original rule's windowed surface difference
//    between the planted foot's own column and the actor's column (no other term),
//    capped by the original 18-unit step height,
//  - a column where the two surfaces agree leaves the pose bit-identical, so the
//    authored animation is never disturbed where the original has nothing to fix,
//  - a real height discontinuity at least 12 cm high moves the planted foot by
//    that windowed amount, keeps its horizontal position and the original bone
//    lengths, and leaves every bone outside the planted leg untouched.
// Evidence lands in output/playwright/source-foot-ik-evidence.json.
import RAPIER from '@dimforge/rapier3d-compat';
import * as T from 'three';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCharacterCpuFixture } from './validate-source-character-actor';
import { createSourceLevel, type SourceLevelData } from '../game/source-level';
import type { SourceMapCollisionData } from '../game/source-map-collision';
import { createSourceCharacterActors, type SourceCharacterPlayer } from '../game/source-character';
import { parseSourceIKRules } from '../game/source-ik-rules';
import { applySourceFootIK, sourceFootIKChains, sourceFootIKRule, sourceFootIKTeam } from '../game/source-foot-ik';
import { sourceSequenceBlend, type SourceCharacterState } from '../game/source-character-pose';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(root, 'output/playwright');
mkdirSync(outputDir, { recursive: true });
const SOURCE = resolve(root, 'public/source/csgo-12426148');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const issues: string[] = [];
/** Rapier's ray time-of-impact is float32, so a probe from a different height
 * reads the same triangle a few 1e-8 m apart. */
const TOI_TOLERANCE = 2e-6;

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -22, z: 0 });
const levelData = read(resolve(SOURCE, 'dust2/level.json')) as SourceLevelData;
const level = createSourceLevel(world, levelData, read(resolve(SOURCE, 'dust2/collision.json')) as SourceMapCollisionData);
world.step();
const fixture = await loadCharacterCpuFixture();
const rules = parseSourceIKRules(read(resolve(SOURCE, 'ik/ik-rules.json')));
const index = fixture.poseIndex;
const scale = levelData.metersPerSourceUnit;
const team = sourceFootIKTeam(index);
const chains = sourceFootIKChains(index, rules, team);
const left = chains.find(chain => chain.chain === 3)!;
const PARAMETERS = { move_x: 1, move_y: 0 };
const PLANTED_CYCLE = .95;
const ACTOR_PROBE = .25;

const owner = createSourceCharacterActors(fixture.gltf, fixture.poseIndex, fixture.weapon, fixture.weaponBytes, fixture.manifest);
const actor = owner.createActor();
const player = (x: number, y: number, z: number, yaw: number, cycle: number, state: SourceCharacterState = 'Run'): SourceCharacterPlayer => ({
  x, y, z, yaw, sourceContract: 'csgo-player-12426148', sourcePoseVersion: fixture.manifest.poseVersion,
  sourcePose: { state, cycle, parameters: PARAMETERS, fireWeight: 0, fireTimeSeconds: 9, fireCycle: 1 } });
const position = (bone: T.Bone) => new T.Vector3().setFromMatrixPosition(bone.matrixWorld);
const poseOf = (bones: readonly T.Bone[]) => bones.map(bone => [...bone.position.toArray(), ...bone.quaternion.toArray()]);
const worstDifference = (a: number[][], b: number[][]) => Math.max(...a.map((row, i) => Math.max(...row.map((v, k) => Math.abs(v - b[i][k])))));
const ground = (x: number, z: number, fromY: number) => level.groundHeight(x, z, fromY);
const pose = (x: number, y: number, z: number, yaw: number, cycle: number) => {
  owner.updateActor(actor, player(x, y, z, yaw, cycle)); actor.root.updateMatrixWorld(true);
  return applySourceFootIK({ index, bones: actor.characterBones, rules, origin: { x, y, z },
    metersPerSourceUnit: scale, ground, state: 'Run', cycle, parameters: PARAMETERS });
};
const blend = sourceSequenceBlend(index, index.data.states.Run.lower, PLANTED_CYCLE, PARAMETERS);
const rule = sourceFootIKRule(index, rules, team, blend, left.chain, PLANTED_CYCLE);
const stepHeight = 18 * scale;

// --- sample real Dust2 columns around a real spawn ---------------------------
const spawn = levelData.spawns.find(s => s.team === 'blue') ?? levelData.spawns[0];
const samples: { x: number; z: number; y: number; yaw: number; expected: number; delta: number; moved: number;
  poseDelta: number; boneDelta: number }[] = [];
for (let dz = -4; dz <= 4; dz += .5) for (let dx = -4; dx <= 4; dx += .5) {
  const x = spawn.x + dx, z = spawn.z + dz;
  const y = ground(x, z, spawn.y + 3);
  if (y === null) continue;
  for (const yaw of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    owner.updateActor(actor, player(x, y, z, yaw, PLANTED_CYCLE)); actor.root.updateMatrixWorld(true);
    const before = poseOf(actor.characterBones);
    const footBefore = position(actor.characterBones[left.foot]);
    const hipBefore = position(actor.characterBones[left.hip]), kneeBefore = position(actor.characterBones[left.knee]);
    const upper = kneeBefore.distanceTo(hipBefore), lower = footBefore.distanceTo(kneeBefore);
    const floor = ground(x, z, y + ACTOR_PROBE);
    const under = ground(footBefore.x, footBefore.z, footBefore.y + stepHeight);
    if (floor === null || under === null) continue;
    const expected = Math.max(-stepHeight, Math.min(stepHeight, rule.envelope * (under - floor)));
    const result = pose(x, y, z, yaw, PLANTED_CYCLE);
    const measured = result.chains.find(chain => chain.chain === left.chain)!;
    const footAfter = position(actor.characterBones[left.foot]);
    const after = poseOf(actor.characterBones);
    const untouched = index.data.mainBones.map((_, i) => i).filter(i => i !== left.hip && i !== left.knee && i !== left.foot);
    // Every claim the renderer relies on, checked on the real map.
    if (Math.abs(measured.delta - expected) > TOI_TOLERANCE)
      issues.push(`(${x},${z},${yaw}): correction ${measured.delta} is not the windowed surface difference ${expected}`);
    if (Math.abs(measured.delta) > stepHeight + 1e-9) issues.push(`(${x},${z}): correction exceeded the original step height`);
    // Either the foot really moved by the corrected amount, or the chain could
    // not reach it and the authored pose is left exactly alone.
    if (result.moved === 1) {
      if (Math.abs(footAfter.y - footBefore.y - measured.delta) > TOI_TOLERANCE)
        issues.push(`(${x},${z},${yaw}): the foot did not move by the corrected amount`);
      if (Math.hypot(footAfter.x - footBefore.x, footAfter.z - footBefore.z) > 1e-6)
        issues.push(`(${x},${z},${yaw}): the foot moved horizontally`);
      if (Math.abs(position(actor.characterBones[left.knee]).distanceTo(position(actor.characterBones[left.hip])) - upper) > 1e-9)
        issues.push(`(${x},${z},${yaw}): the original bone length changed`);
      if (worstDifference(untouched.map(i => after[i]), untouched.map(i => before[i])) !== 0)
        issues.push(`(${x},${z},${yaw}): a bone outside the planted leg chain changed`);
    } else if (worstDifference(before, after) !== 0) {
      issues.push(`(${x},${z},${yaw}): an unreachable correction still changed the pose`);
    }
    samples.push({ x, z, y, yaw, expected, delta: measured.delta, moved: result.moved, poseDelta: footAfter.y - footBefore.y,
      boneDelta: worstDifference(before, after) });
  }
}
const stepColumns = samples.filter(s => Math.abs(s.expected) >= .12);
const refused = samples.filter(s => s.moved === 0);
if (!stepColumns.length) issues.push('no sampled column crossed a real height discontinuity of 12 cm');

// A perfectly flat column: the original collision reports one surface, so the
// renderer must leave the authored pose byte for byte alone. This is the same
// code path with a constant ground query rather than a synthetic rig.
const flatCheck = (() => {
  const y = ground(spawn.x, spawn.z, spawn.y + 3) ?? spawn.y;
  owner.updateActor(actor, player(spawn.x, y, spawn.z, spawn.yaw, PLANTED_CYCLE)); actor.root.updateMatrixWorld(true);
  const before = poseOf(actor.characterBones);
  const constant = () => y;
  const result = applySourceFootIK({ index, bones: actor.characterBones, rules, origin: { x: spawn.x, y, z: spawn.z },
    metersPerSourceUnit: scale, ground: constant, state: 'Run', cycle: PLANTED_CYCLE, parameters: PARAMETERS });
  return { applied: result.applied, moved: result.moved, deltas: result.chains.map(chain => chain.delta),
    boneDelta: worstDifference(before, poseOf(actor.characterBones)) };
})();
if (flatCheck.deltas.some(delta => delta !== 0) || flatCheck.moved !== 0 || flatCheck.boneDelta !== 0)
  issues.push('a column with a single unchanged surface still moved the authored pose');
const worst = samples.reduce((best, s) => (Math.abs(s.delta - s.expected) > Math.abs(best.delta - best.expected) ? s : best), samples[0]);
const strongest = stepColumns.reduce((best, s) => (Math.abs(s.delta) > Math.abs(best.delta) ? s : best), stepColumns[0] ?? samples[0]);
owner.dispose();

const evidence = { scope: 'Original Dust2 collision, original player IK rules, the renderer\'s own applySourceFootIK',
  team, chains: chains.map(chain => chain.name), plantCycle: PLANTED_CYCLE, samples: samples.length,
  stepColumns: stepColumns.length, unreachableColumns: refused.length, flatCheck,
  worstDeltaError: worst ? worst.delta - worst.expected : null,
  strongest: strongest ? { at: [strongest.x, strongest.y, strongest.z], yaw: strongest.yaw, surfaceDifference: strongest.expected,
    delta: strongest.delta, footRise: strongest.poseDelta } : null,
  solve: { envelope: rule.envelope, height: rule.height, radius: rule.radius, contact: rule.contact, stepHeight }, issues };
writeFileSync(resolve(outputDir, 'source-foot-ik-evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ issues, samples: samples.length, stepColumns: stepColumns.length, unreachableColumns: refused.length,
  flatCheck,
  worstDeltaError: evidence.worstDeltaError, strongest: evidence.strongest }));
if (issues.length) process.exitCode = 1;
