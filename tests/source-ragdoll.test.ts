import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as T from 'three';
import { loadCharacterCpuFixture } from '../scripts/validate-source-character-actor';
import { createSourceCharacterActors, type SourceCharacterPlayer } from '../game/source-character';
import { createSourcePoseDriver } from '../game/source-player-contract';
import {
  bindSourceRagdoll, computeSourceRagdollRestFromDeath1, createSourceRagdollPoseDriver,
  parseSourceRagdollData, sampleSourceRagdollPose, serializeSourceRagdoll,
  spawnSourceRagdoll, stepSourceRagdoll, SOURCE_RAGDOLL_DEATH_REST_INPUT,
  type SourceRagdollData,
} from '../game/source-ragdoll';

const available = existsSync('public/source/csgo-12426148/character-ak/manifest.json');
const rawRagdoll = () => JSON.parse(readFileSync('public/source/csgo-12426148/ragdoll/ragdoll-data.json', 'utf8'));

describe('original ragdoll data contract', () => {
  it('parses the staged PHY extraction with the 16-part skeleton and 15 joint limits', () => {
    const data = parseSourceRagdollData(rawRagdoll());
    expect(data.format).toBe('source-ragdoll-v1'); expect(data.build).toBe(12426148);
    expect(data.parts).toHaveLength(16); expect(data.joints).toHaveLength(15);
    expect(data.parts[0].bone).toBe('ValveBiped.Bip01_Pelvis');
    expect(data.totalMass).toBeGreaterThan(240); expect(data.summedPartMass).toBeGreaterThan(240);
  });
  it('rejects wrong formats, part counts and joint chain disagreements', () => {
    const good = rawRagdoll() as Record<string, unknown>;
    expect(() => parseSourceRagdollData({ ...good, format: 'other' })).toThrow();
    expect(() => parseSourceRagdollData({ ...good, parts: (good.parts as unknown[]).slice(0, 15) })).toThrow();
    const brokenJoint = JSON.parse(JSON.stringify(good)); (brokenJoint.joints[0] as Record<string, number>).child = 15;
    expect(() => parseSourceRagdollData(brokenJoint)).toThrow();
    const badMass = JSON.parse(JSON.stringify(good)); (badMass.parts[3] as Record<string, number>).mass = 0;
    expect(() => parseSourceRagdollData(badMass)).toThrow();
  });
});

describe.runIf(available)('ragdoll bind/rest/simulation on the original character rig', () => {
  let fixture: Awaited<ReturnType<typeof loadCharacterCpuFixture>>;
  let data: SourceRagdollData;
  beforeAll(async () => { fixture = await loadCharacterCpuFixture(); data = parseSourceRagdollData(rawRagdoll()); });

  it('binds every main bone to a ragdoll part and derives finite Death1 rest state', () => {
    const index = bindSourceRagdoll(data, fixture.poseIndex);
    expect(index.partBones).toHaveLength(16);
    expect(index.partOwners).toHaveLength(fixture.poseIndex.mainBoneCount);
    expect(index.partOwners.every(owner => owner >= 0 && owner < 16)).toBe(true);
    const { rest, restFull } = computeSourceRagdollRestFromDeath1(index, fixture.poseIndex);
    expect(rest.positions.every(Number.isFinite)).toBe(true);
    expect(rest.jointLengths.every(l => l > 1e-6)).toBe(true);
    expect(restFull.length).toBe(fixture.poseIndex.mainBoneCount * 16);
  });

  it('falls under gravity, respects ground contact and settles without stretching joints', () => {
    const index = bindSourceRagdoll(data, fixture.poseIndex);
    const { rest } = computeSourceRagdollRestFromDeath1(index, fixture.poseIndex);
    const live = spawnSourceRagdoll(rest, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    const first = stepSourceRagdoll(index, live, rest, 1 / 30);
    const pelvis = 0;
    // The pose frame is Source-native, so the vertical axis (the one gravity
    // acts on) is +Z, not +Y.
    expect(first.positions[pelvis * 3 + 2]).toBeLessThan(rest.positions[pelvis * 3 + 2]);
    let state = first, steps = 0;
    while (!state.settled && steps < 900) { state = stepSourceRagdoll(index, state, rest, 1 / 30); steps++; }
    expect(state.settled).toBe(true);
    for (let j = 0; j < index.data.joints.length; j++) {
      const joint = index.data.joints[j], p = joint.parent, c = joint.child;
      const distance = Math.hypot(state.positions[c * 3] - state.positions[p * 3],
        state.positions[c * 3 + 1] - state.positions[p * 3 + 1], state.positions[c * 3 + 2] - state.positions[p * 3 + 2]);
      expect(Math.abs(distance - rest.jointLengths[j])).toBeLessThan(1.5);
    }
    for (let i = 0; i < 16; i++) expect(state.positions[i * 3 + 2]).toBeGreaterThanOrEqual(rest.groundZ - 1e-6);
  });

  it('settles even under the arm-buzz impulse that used to limit-cycle forever', () => {
    const index = bindSourceRagdoll(data, fixture.poseIndex);
    const { rest } = computeSourceRagdollRestFromDeath1(index, fixture.poseIndex);
    // A strong vertical kill impulse pins the grounded shoulder against the
    // floor while the chain locks the forearm out of its cone: the joint-limit
    // corrections used to fight the distance constraints every tick and buzz
    // the arm forever. Strain softening quiets the unreachable cone.
    const live = spawnSourceRagdoll(rest, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 40 });
    let state = live, steps = 0;
    while (!state.settled && steps < 600) { state = stepSourceRagdoll(index, state, rest, 1 / 30); steps++; }
    expect(state.settled).toBe(true);
    expect(steps).toBeLessThan(600);
    for (let j = 0; j < index.data.joints.length; j++) {
      const joint = index.data.joints[j], p = joint.parent, c = joint.child;
      const distance = Math.hypot(state.positions[c * 3] - state.positions[p * 3],
        state.positions[c * 3 + 1] - state.positions[p * 3 + 1], state.positions[c * 3 + 2] - state.positions[p * 3 + 2]);
      expect(Math.abs(distance - rest.jointLengths[j])).toBeLessThan(1.5);
    }
    // Strain stays a pure solver-internal: it never reaches the wire state.
    const wire = serializeSourceRagdoll(state);
    expect(Object.keys(wire)).toEqual(['positions', 'settled']);
  });

  it('lands and settles at the authority 1/60 tick for every kill direction', () => {
    const index = bindSourceRagdoll(data, fixture.poseIndex);
    const { rest } = computeSourceRagdollRestFromDeath1(index, fixture.poseIndex);
    // The authority ticks at 1/60. There, rewriting the recovery-phase joint
    // snap as Δposition/dt turned a dt-independent pose correction into kinetic
    // energy: the shorter the tick, the harder the corpse was launched, and a
    // teammate killed by a rifle flew thousands of units instead of falling.
    // The damage() path fans the kill impulse over every horizontal direction,
    // so all eight are covered.
    for (let k = 0; k < 8; k++) {
      const angle = k * Math.PI / 4, label = `${k * 45}deg`;
      const live = spawnSourceRagdoll(rest, { x: 0, y: 0, z: 0 },
        { x: Math.cos(angle) * 170, y: Math.sin(angle) * 170, z: 42.5 });
      let state = live, steps = 0, peak = rest.positions[2];
      while (!state.settled && steps < 900) {
        state = stepSourceRagdoll(index, state, rest, 1 / 60);
        steps++;
        peak = Math.max(peak, state.positions[2]);
      }
      expect(state.settled, `${label} corpse must settle`).toBe(true);
      expect(steps, `${label} settle time`).toBeLessThan(900);
      // A 42.5-unit/s upward impulse on an 800-unit corpse peaks about a unit
      // above where it died; anything past 80 means the solver fed it energy.
      expect(peak - rest.positions[2], `${label} corpse must not fly`).toBeLessThan(80);
      for (let i = 0; i < 16; i++)
        expect(state.positions[i * 3 + 2], `${label} part ${i} must rest on the ground`)
          .toBeGreaterThanOrEqual(rest.groundZ - 1e-6);
    }
  });

  it('comes to rest near where it died instead of gliding away', () => {
    const index = bindSourceRagdoll(data, fixture.poseIndex);
    const { rest } = computeSourceRagdollRestFromDeath1(index, fixture.poseIndex);
    const live = spawnSourceRagdoll(rest, { x: 0, y: 0, z: 0 }, { x: 170, y: 0, z: 42.5 });
    let state = live, steps = 0;
    while (!state.settled && steps < 900) { state = stepSourceRagdoll(index, state, rest, 1 / 60); steps++; }
    expect(state.settled).toBe(true);
    // The killing impulse is a ballistic throw, not a glider: the pelvis must end
    // within a couple of metres of the death frame. Air drag on the horizontal
    // axes is what keeps gravity's accumulation from turning into a long glide.
    const travel = Math.hypot(state.positions[0] - rest.positions[0], state.positions[1] - rest.positions[1]);
    expect(travel).toBeLessThan(79);
  });

  it('comes to rest lying across the ground, not standing in the up axis', () => {
    const index = bindSourceRagdoll(data, fixture.poseIndex);
    const { rest } = computeSourceRagdollRestFromDeath1(index, fixture.poseIndex);
    const live = spawnSourceRagdoll(rest, { x: 0, y: 0, z: 0 }, { x: 170, y: 0, z: 42.5 });
    let state = live, steps = 0;
    while (!state.settled && steps < 900) { state = stepSourceRagdoll(index, state, rest, 1 / 60); steps++; }
    expect(state.settled).toBe(true);
    const span = (axis: number) => {
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < 16; i++) {
        min = Math.min(min, state.positions[i * 3 + axis]);
        max = Math.max(max, state.positions[i * 3 + axis]);
      }
      return max - min;
    };
    const [x, y, z] = [span(0), span(1), span(2)];
    // The pose frame is Source-native, so +Z is up. Standing, this rig spans its
    // full height along Z (~58 units). A settled corpse must instead spread
    // across the ground: Z collapses to a body's thickness while X/Y carry the
    // length. Applying gravity along +Y left the body at standing height in Z
    // while dragging it sideways, which the renderer drew as an upright corpse
    // floating off the floor.
    expect(z).toBeLessThan(35);
    expect(z).toBeLessThan(Math.max(x, y));
  });

  it('carries the death impulse along the killing direction and round-trips serialization', () => {
    const index = bindSourceRagdoll(data, fixture.poseIndex);
    const { rest } = computeSourceRagdollRestFromDeath1(index, fixture.poseIndex);
    const live = spawnSourceRagdoll(rest, { x: 120, y: 40, z: -60 }, { x: 260, y: 0, z: 65 });
    const next = stepSourceRagdoll(index, live, rest, 1 / 30);
    expect(next.positions[0] - rest.positions[0]).toBeGreaterThan(3);
    const state = serializeSourceRagdoll(next);
    expect(state.positions).toHaveLength(48);
    expect(state.positions.every(v => Number.isFinite(v))).toBe(true);
    expect(state.settled).toBe(false);
  });

  it('produces a render-ready full skeleton sample for the corpse', () => {
    const index = bindSourceRagdoll(data, fixture.poseIndex);
    const { rest, restFull } = computeSourceRagdollRestFromDeath1(index, fixture.poseIndex);
    const sample = sampleSourceRagdollPose(index, restFull, rest, rest.positions);
    expect(sample.renderLocalPositions.length).toBe(fixture.poseIndex.mainBoneCount * 3);
    expect(sample.renderLocalQuaternions.length).toBe(fixture.poseIndex.mainBoneCount * 4);
    // Quaternions stay normalized; the first non-root bone carries the parent-local pose.
    for (let i = 0; i < fixture.poseIndex.mainBoneCount; i++) {
      const q = sample.renderLocalQuaternions, at = i * 4;
      expect(Math.hypot(q[at], q[at + 1], q[at + 2], q[at + 3])).toBeCloseTo(1, 6);
    }
    // At rest the derived matrices reproduce the sampled Death1 frame exactly.
    for (let i = 0; i < fixture.poseIndex.mainBoneCount; i++) {
      for (let k = 0; k < 16; k++)
        expect(sample.sourceWorldMatrices[i * 16 + k]).toBeCloseTo(restFull[i * 16 + k], 3);
    }
  });

  it('drives per-player corpses through one shared table across weapon drivers', () => {
    const base = createSourcePoseDriver(fixture.poseIndex, fixture.manifest.poseVersion);
    const driver = createSourceRagdollPoseDriver(base, fixture.poseIndex, data);
    const player = { id: 'corpse-1' };
    const state = driver.ragdoll!.beginRagdoll(player, { x: 0, y: 0, z: 0 }, { x: 170, y: 42, z: 0 });
    expect(state.positions).toHaveLength(48);
    const stepped = driver.ragdoll!.stepRagdoll(player, 1 / 30);
    expect(stepped).not.toBeNull(); expect(stepped!.positions).toHaveLength(48);
    driver.ragdoll!.endRagdoll(player);
    expect(driver.ragdoll!.stepRagdoll(player, 1 / 30)).toBeNull();
    expect(driver.ragdollIndex?.partBones).toHaveLength(16);
  });
});

describe.runIf(available)('ragdoll rendering through the original character actor', () => {
  let fixture: Awaited<ReturnType<typeof loadCharacterCpuFixture>>;
  let data: SourceRagdollData;
  beforeAll(async () => { fixture = await loadCharacterCpuFixture(); data = parseSourceRagdollData(rawRagdoll()); });
  const deadPlayer = (ragdoll?: { positions: number[]; settled: boolean }): SourceCharacterPlayer => ({
    x: 4, y: 1, z: -7, yaw: .8, sourceContract: 'csgo-player-12426148', sourcePoseVersion: fixture.manifest.poseVersion,
    sourcePose: { ...SOURCE_RAGDOLL_DEATH_REST_INPUT, cycle: 1 }, ...(ragdoll ? { sourceRagdoll: ragdoll } : {}),
  });

  it('renders the simulated corpse bones instead of the Death1 clamp while ragdoll data streams in', () => {
    const index = bindSourceRagdoll(data, fixture.poseIndex);
    const { rest } = computeSourceRagdollRestFromDeath1(index, fixture.poseIndex);
    const manager = createSourceCharacterActors(fixture.gltf, fixture.poseIndex, fixture.weapon, fixture.weaponBytes, fixture.manifest, index);
    const actor = manager.createActor();
    // Death1 clamp fallback: no ragdoll state yet renders the animated fall.
    expect(manager.updateActor(actor, deadPlayer())).not.toBeNull();
    const clamped = actor.characterBones.map(b => b.position.toArray());
    // A ragdoll state at rest reproduces Death1 cycle 0, not the clamped final frame.
    const positions = Array.from(rest.positions, v => Math.round(v * 1e4) / 1e4);
    manager.updateActor(actor, deadPlayer({ positions, settled: false }));
    const moved = actor.characterBones.some((b, i) => b.position.distanceTo(new T.Vector3().fromArray(clamped[i])) > 1e-6);
    expect(moved).toBe(true);
    expect(actor.root.position.x).toBe(4); expect(actor.root.visible).toBe(true);
    manager.dispose();
  });

  it('keeps the world weapon following the corpse hand through the shared merged bones', () => {
    const index = bindSourceRagdoll(data, fixture.poseIndex);
    const { rest } = computeSourceRagdollRestFromDeath1(index, fixture.poseIndex);
    const manager = createSourceCharacterActors(fixture.gltf, fixture.poseIndex, fixture.weapon, fixture.weaponBytes, fixture.manifest, index);
    const actor = manager.createActor();
    const positions = Array.from(rest.positions, v => Math.round(v * 1e4) / 1e4);
    manager.updateActor(actor, deadPlayer({ positions, settled: true }));
    const hand = fixture.poseIndex.data.mainBones.findIndex(b => b.name === 'ValveBiped.Bip01_R_Hand');
    expect(hand).toBeGreaterThanOrEqual(0);
    // The weapon merge table must reference character bones the ragdoll skeleton covers.
    for (const pair of fixture.weapon.boneMerge) expect(index.partOwners[pair.characterBone]).toBeDefined();
    expect(actor.sourceWeaponWorldMatrices.every(Number.isFinite)).toBe(true);
    manager.dispose();
  });

  it('rejects malformed ragdoll authority instead of rendering a broken corpse', () => {
    const index = bindSourceRagdoll(data, fixture.poseIndex);
    const manager = createSourceCharacterActors(fixture.gltf, fixture.poseIndex, fixture.weapon, fixture.weaponBytes, fixture.manifest, index);
    const actor = manager.createActor();
    expect(() => manager.updateActor(actor, deadPlayer({ positions: [0, 0, 0], settled: false }))).toThrow();
    expect(() => manager.updateActor(actor, deadPlayer({ positions: Array(48).fill(NaN), settled: false }))).toThrow();
    manager.dispose();
  });

  it('still renders the Death1 clamp when no ragdoll index was provided', () => {
    const manager = createSourceCharacterActors(fixture.gltf, fixture.poseIndex, fixture.weapon, fixture.weaponBytes, fixture.manifest);
    const actor = manager.createActor();
    const { rest } = computeSourceRagdollRestFromDeath1(bindSourceRagdoll(data, fixture.poseIndex), fixture.poseIndex);
    // The ragdoll field is ignored without a bound index; the actor stays on the clamp path.
    expect(manager.updateActor(actor, deadPlayer({ positions: Array.from(rest.positions), settled: true }))).not.toBeNull();
    expect(actor.status).toBe('ready');
    manager.dispose();
  });
});
