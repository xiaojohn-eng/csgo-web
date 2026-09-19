/** Source character ragdoll adapter. Production r3 records the exact living
 * main-bone pose and transmits all 16 rigid-body rotations as well as positions.
 * Rapier handles contact with the authority's original map and body volumes;
 * original PHY mass, damping and angular limits are kept. This is not VPhysics
 * engine parity. The positions-only r2 functions remain for archived replays.
 * All wire transforms use actor-local Source units and +Z up. */
import { accumulateSourceSequence, sampleSourceCharacterPose, type SourceCharacterPoseInput, type SourceCharacterPoseIndex } from './source-character-pose.js';
import { Matrix4, Quaternion, Vector3 } from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import {createSourceRigidRagdoll,type SourceRigidRagdoll} from './source-ragdoll-rigid.js';
export {sourceRagdollVelocityFromWorld} from './source-ragdoll-rigid.js';
import type { SourcePoseDriver } from './source-player-contract.js';

export type SourceRagdollPart = { index: number; bone: string; mass: number; damping: number; rotdamping: number;
  inertia: number; volume: number; parentBone?: string; massBias?: number };
export type SourceRagdollJointDef = { parent: number; child: number; x: [number, number]; y: [number, number]; z: [number, number] };
export type SourceRagdollData = {
  format: 'source-ragdoll-v1'; sourceApp: number; build: number;
  models: { t: string; ct: string }; phyChecksums: { t: string; ct: string };
  rootBone: string; totalMass: number; summedPartMass: number;
  parts: SourceRagdollPart[]; joints: SourceRagdollJointDef[];
};

export const SOURCE_RAGDOLL_GRAVITY = 800;
export const SOURCE_RAGDOLL_POSE_DRIVER_VERSION = 'ragdoll-rigid-12426148-r3';
const CONSTRAINT_ITERATIONS = 6;
// Settle threshold in units/s, measured on the per-tick position delta: an
// 800-unit-tall corpse moving under 10 units/s reads as motionless, and VPhysics
// sleeps its ragdolls at the same order of magnitude.
const GROUND_FRICTION = .72, SETTLE_SPEED = 12, SETTLE_HOLD = .5;
// The death frame regularly exceeds ragdoll joint ranges (animation is not
// ragdoll-constrained), so limits are enforced as a per-iteration relaxation
// toward the clamped seat, never as an instant teleport that would visibly
// snap or fight the distance constraints it shares the loop with. A part
// resting on the ground yields almost completely: ground contact must win
// over joint limits, otherwise the arm chains buzz between the floor and the
// suspended limit direction forever.
const JOINT_LIMIT_RELAX = .25, GROUND_LIMIT_YIELD = .05;
// Small clamp deltas near the Euler gimbal boundary can still rebuild a very
// different quaternion, which reads as random limb twitching; only clearly
// broken poses (large violations) are worth correcting.
const JOINT_LIMIT_TOLERANCE = 25;
// Velocity relaxation applied to the solver's own correction after the
// position-delta rewrite: the original VPhysics ragdolls look heavy and stop
// fast; this dissipates the residual solver chatter of the position passes so
// corpses settle instead of buzzing.
const VELOCITY_RELAX = .55, MAX_SPEED = 800;
// Air drag on the corpse's horizontal motion only. A ragdoll must keep its
// ballistic fall (gravity has to accumulate, or a corpse never reaches the
// ground below it), but the killing impulse must not send it gliding for metres:
// the original corpse crumples near where it died. Ground contact adds its own
// friction on top of this.
const HORIZONTAL_AIR_DRAG = 4;
// Cone-recovery phase: the Death1 frame regularly starts far outside the
// original ragdoll cones (animation is not ragdoll-constrained). VPhysics
// pulls those joints back with its soft limits over the first few steps —
// visible as a quick limb snap, never a teleport. The first ticks therefore
// enforce the cones strictly (tiny tolerance, strong relax) so the pose is
// inside every cone quickly; afterwards the relaxed tolerance/relax keeps the
// solver from buzzing at the Euler gimbal boundary. Splitting the phases is
// what lets a corpse settle at all: recovery drives the violation to ~0 and
// the steady phase stops correcting, so no limit-vs-distance tug-of-war
// remains to inject a permanent velocity floor.
const LIMIT_RECOVER_SECONDS = .4, LIMIT_RECOVER_RELAX = .5, LIMIT_RECOVER_TOLERANCE = 2;
// Hard cap on how far one joint-limit relaxation may move a part per solver
// iteration. Euler-axis clamps can jump discontinuously when a relative
// rotation crosses a gimbal/branch boundary even though the physical joint
// barely moved; the cap turns those representation artifacts into a bounded
// nudge instead of a teleport, while genuine violations still converge
// quickly (cap * iterations * ticks far exceeds any real excursion). The value
// also sets how the cone recovery reads: at .5 the six iterations move a part
// about three units per tick, a quick limb snap rather than a pop.
const LIMIT_CORRECTION_CAP = .5;
// Strain softening: when a joint's cone is geometrically unreachable (the
// death pose pins the parent against the ground while the chain length locks
// the child out of the cone), limit corrections fight the distance/ground
// constraints forever and buzz the limb. Each tick the joint accumulates its
// violation as strain; the correction strength scales by exp(-strain/scale),
// so an unreachable cone relaxes to the original VPhysics soft-limit behavior
// — the limb keeps its pose slightly outside the cone and goes quiet — while
// reachable cones clear their violation before strain builds up.
// Two gates keep a normal death from softening: every corpse tumbles through
// large transient violations while it flies (up to ~1s), so strain only
// counts after the grace window, and the tug-of-war is a ground-contact
// phenomenon, so at least one side of the joint must be resting on the floor.
const STRAIN_DECAY = .92, STRAIN_SCALE = 120, STRAIN_GRACE_SECONDS = 1.2, STRAIN_NEAR_FLOOR = 2;

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export function parseSourceRagdollData(input: unknown): SourceRagdollData {
  check(typeof input === 'object' && input !== null, 'Ragdoll data must be an object');
  const d = input as Partial<SourceRagdollData>;
  check(d.format === 'source-ragdoll-v1', 'Unknown ragdoll data format');
  check(Array.isArray(d.parts) && d.parts.length === 16, 'Ragdoll data must list 16 parts');
  check(Array.isArray(d.joints) && d.joints.length === 15, 'Ragdoll data must list 15 joints');
  check(typeof d.rootBone === 'string' && d.parts[0].bone === d.rootBone, 'Ragdoll root part mismatch');
  for (const p of d.parts)
    check(Number.isFinite(p.mass) && p.mass > 0 && Number.isFinite(p.damping) && p.damping >= 0 &&
      Number.isFinite(p.rotdamping) && p.rotdamping >= 0, `Invalid ragdoll part ${p.bone}`);
  const bones = new Set(d.parts.map((p) => p.bone));
  check(bones.size === 16, 'Ragdoll parts must be unique bones');
  for (const j of d.joints) {
    const parent = d.parts[j.parent], child = d.parts[j.child];
    check(parent && child, 'Ragdoll joint references unknown parts');
    check(child.parentBone === parent.bone, `Ragdoll joint ${j.parent}->${j.child} disagrees with the part parent chain`);
    for (const axis of [j.x, j.y, j.z] as const)
      check(axis.length === 2 && axis.every(Number.isFinite) && axis[0] <= axis[1], 'Invalid ragdoll joint limit');
  }
  return { ...d, parts: d.parts.map((p) => ({ ...p })), joints: d.joints.map((j) => ({ ...j })) } as SourceRagdollData;
}

/** Bone-name binding between the shared ragdoll skeleton and one weapon pose
 * dataset, plus each part's ground-contact radius from the original hitboxes.
 * `partOwners` maps every main bone to the nearest ragdoll part at or above
 * it, so non-part bones follow their owner part rigidly. */
export type SourceRagdollIndex = {
  readonly data: SourceRagdollData;
  readonly partBones: readonly number[];
  readonly partParents: readonly (number | null)[];
  readonly partChildren: readonly (readonly number[])[];
  readonly partRadii: readonly number[];
  readonly partShapes: readonly {center: number[]; halfExtents: number[]}[];
  readonly partInverseBinds: readonly number[][];
  readonly partOwners: readonly number[];
  readonly boneParents: readonly number[];
  /** Original model_dropped root: sampled before the body enters ragdoll. */
  readonly weaponHandBone: number;
};

export function bindSourceRagdoll(data: SourceRagdollData, poseIndex: SourceCharacterPoseIndex): SourceRagdollIndex {
  const byName = new Map(poseIndex.data.mainBones.map((b, i) => [b.name, i]));
  const partBones = data.parts.map((p) => {
    const bone = byName.get(p.bone);
    check(bone !== undefined, `Ragdoll bone ${p.bone} is absent from this pose dataset`);
    return bone;
  });
  const partParents = data.parts.map((p) => {
    if (p.parentBone === undefined) return null;
    const parent = data.parts.findIndex((q) => q.bone === p.parentBone);
    check(parent >= 0, `Ragdoll parent ${p.parentBone} is not a part`);
    return parent;
  });
  const partChildren: number[][] = data.parts.map(() => []);
  partParents.forEach((parent, child) => { if (parent !== null) partChildren[parent].push(child); });
  const hitboxes = poseIndex.data.hitboxSets[0]?.hitboxes ?? [];
  const partRadii = partBones.map((bone) => {
    let radius = 0;
    for (const h of hitboxes) if (h.bone === bone) {
      const extent = Math.max(
        Math.abs(h.min[0]) + Math.abs(h.max[0]), Math.abs(h.min[1]) + Math.abs(h.max[1]),
        Math.abs(h.min[2]) + Math.abs(h.max[2]));
      radius = Math.max(radius, extent * .5);
    }
    return radius > 1e-6 ? radius : 3;
  });
  const partShapes = partBones.map((bone, i) => {
    const boxes = hitboxes.filter(h => h.bone === bone);
    if (!boxes.length) { const r = Math.cbrt(data.parts[i].volume * 3 / (4 * Math.PI)); return {center: [0,0,0], halfExtents: [r,r,r]}; }
    const min = [0,1,2].map(k => Math.min(...boxes.map(h => h.min[k])));
    const max = [0,1,2].map(k => Math.max(...boxes.map(h => h.max[k])));
    return {center: min.map((v,k) => (v+max[k])/2), halfExtents: min.map((v,k) => Math.max(.1,(max[k]-v)/2))};
  });
  const partInverseBinds = partBones.map(bone => [...poseIndex.data.mainBones[bone].inverseBindSource]);
  const partOfBone = new Map(partBones.map((bone, part) => [bone, part]));
  const partOwners = poseIndex.data.mainBones.map((bone, index) => {
    let at = index;
    while (at >= 0) { const part = partOfBone.get(at); if (part !== undefined) return part; at = poseIndex.data.mainBones[at].parent; }
    throw new Error(`Ragdoll bone chain from ${bone.name} never reaches a ragdoll part`);
  });
  return { data, partBones, partParents, partChildren, partRadii, partShapes, partInverseBinds, partOwners, weaponHandBone: byName.get('weapon_hand_R')??-1, boneParents: poseIndex.data.mainBones.map((b) => b.parent) };
}

/** Frozen death-instant skeleton state: part rest positions/orientations, the
 * rest chain directions (world and part-local), joint rest lengths and the
 * actor-local ground plane the standing death frame implies (the lowest part
 * sphere rests exactly on it, so the corpse never pops at spawn). `groundZ` is
 * that plane along the frame's up axis, which in Source-native pose data is +Z. */
export type SourceRagdollRest = {
  positions: Float64Array; quaternions: Float64Array;
  chainDirections: Float64Array; chainLocal: Float64Array; jointLengths: Float64Array;
  groundZ: number;
};

/** Live simulated state. `positions` is the only transmitted truth. `jointStrain`
 * is server-internal solver bookkeeping and never crosses the network.
 * `groundZ` is the per-part ground level along the frame's up axis, in
 * actor-local Source units: the authority refreshes it from the original map
 * collision each tick (see updateSourceRagdollGround), so a corpse rests on the
 * terrain under each of its own parts instead of one plane frozen at death. */
export type SourceRagdollLive = { positions: Float64Array; velocities: Float64Array; time: number; settled: boolean; settledFor: number;
  groundZ: Float64Array; jointStrain?: Float64Array; rigid?: SourceRigidRagdoll; restPose?: SourceRagdollRestTransforms };
export type SourceRagdollRestTransforms = {positions: number[]; quaternions: number[]};
export type SourceRagdollState = { positions: number[]; settled: boolean;
  /** r3: 16 independently integrated Source-local body rotations. */
  quaternions?: number[];
  /** Actual complete main-bone pose immediately before death. */
  restPose?: SourceRagdollRestTransforms;
};

/** Interpolates complete rigid states without dropping the frozen living pose.
 * A changed rest pose is a new corpse and must never blend with the old one. */
export function interpolateSourceRagdollState(a: SourceRagdollState, b: SourceRagdollState, t: number): SourceRagdollState {
  const alpha=Math.min(1,Math.max(0,Number.isFinite(t)?t:0));
  if(a.positions.length!==b.positions.length||JSON.stringify(a.restPose)!==JSON.stringify(b.restPose))return structuredClone(alpha<1?a:b);
  const result:SourceRagdollState={...structuredClone(alpha<1?a:b),positions:a.positions.map((v,i)=>v+(b.positions[i]-v)*alpha),settled:alpha<1?a.settled:b.settled};
  if(a.quaternions&&b.quaternions&&a.quaternions.length===b.quaternions.length) {
    result.quaternions=[];
    for(let i=0;i<a.quaternions.length;i+=4) result.quaternions.push(...new Quaternion().fromArray(a.quaternions,i).normalize()
      .slerp(new Quaternion().fromArray(b.quaternions,i).normalize(),alpha).toArray());
  }
  return result;
}

export function serializeSourceRagdoll(live: SourceRagdollLive): SourceRagdollState {
  return { positions: Array.from(live.positions, (v) => Math.round(v * 1e4) / 1e4), settled: live.settled };
}

function matrixTranslation(out: Float64Array, part: number, matrices: ArrayLike<number>, bone: number) {
  const at = bone * 16;
  out[part * 3] = matrices[at + 12]; out[part * 3 + 1] = matrices[at + 13]; out[part * 3 + 2] = matrices[at + 14];
}

function matrixQuaternion(out: Float64Array, part: number, matrices: ArrayLike<number>, bone: number) {
  const at = bone * 16, m0 = matrices[at], m1 = matrices[at + 1], m2 = matrices[at + 2],
    m4 = matrices[at + 4], m5 = matrices[at + 5], m6 = matrices[at + 6],
    m8 = matrices[at + 8], m9 = matrices[at + 9], m10 = matrices[at + 10];
  const trace = m0 + m5 + m10; let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    x = (m6 - m9) / s; y = (m8 - m2) / s; z = (m1 - m4) / s; w = s / 4;
  } else if (m0 > m5 && m0 > m10) {
    const s = Math.sqrt(1 + m0 - m5 - m10) * 2;
    x = s / 4; y = (m4 + m1) / s; z = (m8 + m2) / s; w = (m6 - m9) / s;
  } else if (m5 > m10) {
    const s = Math.sqrt(1 + m5 - m0 - m10) * 2;
    x = (m4 + m1) / s; y = s / 4; z = (m9 + m6) / s; w = (m8 - m2) / s;
  } else {
    const s = Math.sqrt(1 + m10 - m0 - m5) * 2;
    x = (m8 + m2) / s; y = (m9 + m6) / s; z = s / 4; w = (m1 - m4) / s;
  }
  const length = Math.hypot(x, y, z, w); check(length > 1e-9, 'Degenerate bone matrix quaternion');
  out[part * 4] = x / length; out[part * 4 + 1] = y / length; out[part * 4 + 2] = z / length; out[part * 4 + 3] = w / length;
}

function conjugate(q: Float64Array, at: number, out: Float64Array, to: number) {
  out[to] = -q[at]; out[to + 1] = -q[at + 1]; out[to + 2] = -q[at + 2]; out[to + 3] = q[at + 3];
}

function multiplyQuat(a: Float64Array, ai: number, b: Float64Array, bi: number, out: Float64Array, at: number) {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3], bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  const x = aw * bx + bw * ax + ay * bz - az * by, y = aw * by + bw * ay + az * bx - ax * bz,
    z = aw * bz + bw * az + ax * by - ay * bx, w = aw * bw - ax * bx - ay * by - az * bz;
  const length = Math.hypot(x, y, z, w); check(length > 1e-9, 'Degenerate quaternion product');
  out[at] = x / length; out[at + 1] = y / length; out[at + 2] = z / length; out[at + 3] = w / length;
}

function rotateVector(q: Float64Array, at: number, x: number, y: number, z: number, out: Float64Array, to: number) {
  const qx = q[at], qy = q[at + 1], qz = q[at + 2], qw = q[at + 3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[to] = x + qw * tx + (qy * tz - qz * ty);
  out[to + 1] = y + qw * ty + (qz * tx - qx * tz);
  out[to + 2] = z + qw * tz + (qx * ty - qy * tx);
}

/** Minimal rotation carrying normalized direction a onto normalized b. */
function rotationBetween(ax: number, ay: number, az: number, bx: number, by: number, bz: number, out: Float64Array, at: number) {
  const dot = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
  if (dot > 1 - 1e-9) { out[at] = 0; out[at + 1] = 0; out[at + 2] = 0; out[at + 3] = 1; return; }
  const q = new Quaternion().setFromUnitVectors(new Vector3(ax,ay,az),new Vector3(bx,by,bz));
  out.set(q.toArray(),at);
}

/** Build the frozen rest state from the sampled Death1 cycle 0 world pose
 * (actor-local Source units, column-major matrices). */
export function computeSourceRagdollRest(index: SourceRagdollIndex, worldMatrices: ArrayLike<number>): SourceRagdollRest {
  const count = index.data.parts.length;
  const positions = new Float64Array(count * 3), quaternions = new Float64Array(count * 4);
  for (let i = 0; i < count; i++) {
    matrixTranslation(positions, i, worldMatrices, index.partBones[i]);
    matrixQuaternion(quaternions, i, worldMatrices, index.partBones[i]);
    check(Number.isFinite(positions[i * 3]) && Number.isFinite(positions[i * 3 + 1]) && Number.isFinite(positions[i * 3 + 2]),
      `Ragdoll part ${index.data.parts[i].bone} has a non-finite rest position`);
  }
  const chainDirections = new Float64Array(count * 3), chainLocal = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    const parent = index.partParents[i];
    const reference = parent === null ? index.partChildren[i][0] : parent;
    check(reference !== undefined, `Ragdoll part ${i} has no chain reference`);
    const dx = positions[reference * 3] - positions[i * 3], dy = positions[reference * 3 + 1] - positions[i * 3 + 1],
      dz = positions[reference * 3 + 2] - positions[i * 3 + 2];
    const length = Math.hypot(dx, dy, dz);
    check(length > 1e-6, `Ragdoll part ${i} chain reference overlaps itself`);
    chainDirections[i * 3] = dx / length; chainDirections[i * 3 + 1] = dy / length; chainDirections[i * 3 + 2] = dz / length;
    const conj = new Float64Array(4); conjugate(quaternions, i * 4, conj, 0);
    rotateVector(conj, 0, chainDirections[i * 3], chainDirections[i * 3 + 1], chainDirections[i * 3 + 2], chainLocal, i * 3);
  }
  const jointLengths = new Float64Array(index.data.joints.length);
  index.data.joints.forEach((joint, j) => {
    const p = joint.parent, c = joint.child;
    const length = Math.hypot(positions[c * 3] - positions[p * 3], positions[c * 3 + 1] - positions[p * 3 + 1],
      positions[c * 3 + 2] - positions[p * 3 + 2]);
    check(length > 1e-6, 'Ragdoll joint has zero rest length');
    jointLengths[j] = length;
  });
  let groundZ = Infinity;
  for (let i = 0; i < count; i++) groundZ = Math.min(groundZ, positions[i * 3 + 2] - index.partRadii[i]);
  return { positions, quaternions, chainDirections, chainLocal, jointLengths, groundZ };
}

/** One Gauss-Seidel constraint pass shared by the runtime stepper:
 * distance constraints, ragdoll joint-limit relaxation and the ground plane,
 * in that order. `jointRelax`/`limitTolerance` are phase-dependent (see
 * stepSourceRagdoll). */
type RagdollConstraintBuffers = {
  matrices: Float64Array; quats: Float64Array; conjP: Float64Array; rel: Float64Array;
  relQ: Float64Array; restDirLocal: Float64Array; limited: Float64Array; world: Float64Array; conjRest: Float64Array;
  violations: Float64Array;
};
const ragdollConstraintBuffers = (count: number): RagdollConstraintBuffers => ({
  matrices: new Float64Array(count * 16), quats: new Float64Array(count * 4), conjP: new Float64Array(4),
  rel: new Float64Array(4), relQ: new Float64Array(4), restDirLocal: new Float64Array(3),
  limited: new Float64Array(4), world: new Float64Array(3), conjRest: new Float64Array(4),
  violations: new Float64Array(0),
});
const deg = (r: number) => r * 180 / Math.PI, rad = (d: number) => d * Math.PI / 180;

function solveRagdollConstraints(index: SourceRagdollIndex, positions: Float64Array, rest: SourceRagdollRest,
  groundZ: ArrayLike<number>, masses: number[], jointRelax: ArrayLike<number>, limitTolerance: number, b: RagdollConstraintBuffers): void {
  const count = index.data.parts.length;
  // Distance constraints: original part masses decide how far each side moves
  // (heavy torso barely budges, light limbs swing wide).
  index.data.joints.forEach((joint, j) => {
    const p = joint.parent, c = joint.child, restLength = rest.jointLengths[j];
    let dx = positions[c * 3] - positions[p * 3], dy = positions[c * 3 + 1] - positions[p * 3 + 1],
      dz = positions[c * 3 + 2] - positions[p * 3 + 2];
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-9) return;
    const error = (length - restLength) / length, wp = 1 / masses[p], wc = 1 / masses[c], total = wp + wc;
    const childShift = error * (wc / total), parentShift = error * (wp / total);
    positions[c * 3] -= dx * childShift; positions[c * 3 + 1] -= dy * childShift; positions[c * 3 + 2] -= dz * childShift;
    positions[p * 3] += dx * parentShift; positions[p * 3 + 1] += dy * parentShift; positions[p * 3 + 2] += dz * parentShift;
  });
  // Original ragdollconstraint axis limits: clamp each child's live
  // orientation relative to its parent, then relax the child toward the
  // limited direction at the joint's rest length.
  sourceRagdollBoneMatrices(index, positions, rest, b.matrices);
  for (let i = 0; i < count; i++) matrixQuaternion(b.quats, i, b.matrices, i);
  index.data.joints.forEach((joint, j) => {
    const p = joint.parent, c = joint.child;
    conjugate(b.quats, p * 4, b.conjP, 0);
    multiplyQuat(b.conjP, 0, b.quats, c * 4, b.rel, 0);
    const [rx, ry, rz] = quaternionToEulerXYZ(b.rel[0], b.rel[1], b.rel[2], b.rel[3]);
    const cx = Math.min(Math.max(deg(rx), joint.x[0]), joint.x[1]);
    const cy = Math.min(Math.max(deg(ry), joint.y[0]), joint.y[1]);
    const cz = Math.min(Math.max(deg(rz), joint.z[0]), joint.z[1]);
    const violation = Math.max(Math.abs(cx - deg(rx)), Math.abs(cy - deg(ry)), Math.abs(cz - deg(rz)));
    // Strain counts steady-phase violations only: the recovery phase reports
    // almost every joint as violating (its tolerance is 2°), which would
    // soften the whole corpse before the cones were even given a chance.
    if (b.violations.length === index.data.joints.length)
      b.violations[j] = violation > JOINT_LIMIT_TOLERANCE ? violation : 0;
    if (violation < limitTolerance) return;
    const relax = jointRelax[j];
    if (!(relax > 0)) return;
    const [qx, qy, qz, qw] = eulerXYZToQuaternion(rad(cx), rad(cy), rad(cz));
    b.relQ[0] = qx; b.relQ[1] = qy; b.relQ[2] = qz; b.relQ[3] = qw;
    // Rest child direction expressed in the parent's rest local frame.
    const dx0 = rest.positions[c * 3] - rest.positions[p * 3], dy0 = rest.positions[c * 3 + 1] - rest.positions[p * 3 + 1],
      dz0 = rest.positions[c * 3 + 2] - rest.positions[p * 3 + 2];
    const l0 = Math.hypot(dx0, dy0, dz0);
    conjugate(rest.quaternions, p * 4, b.conjRest, 0);
    rotateVector(b.conjRest, 0, dx0 / l0, dy0 / l0, dz0 / l0, b.restDirLocal, 0);
    // Limited child direction in world: live parent rotation * limited
    // relative rotation * rest local direction.
    multiplyQuat(b.quats, p * 4, b.relQ, 0, b.limited, 0);
    rotateVector(b.limited, 0, b.restDirLocal[0], b.restDirLocal[1], b.restDirLocal[2], b.world, 0);
    const restLength = rest.jointLengths[j];
    const floorC = groundZ[c] + index.partRadii[c];
    const grounded = positions[c * 3 + 2] <= floorC + .5;
    let mx = positions[p * 3] + b.world[0] * restLength - positions[c * 3];
    let my = positions[p * 3 + 1] + b.world[1] * restLength - positions[c * 3 + 1];
    let mz = positions[p * 3 + 2] + b.world[2] * restLength - positions[c * 3 + 2];
    const magnitude = Math.hypot(mx, my, mz);
    if (magnitude > 1e-9) {
      const scale = grounded
        ? Math.min(relax * GROUND_LIMIT_YIELD, LIMIT_CORRECTION_CAP / magnitude)
        : Math.min(relax, LIMIT_CORRECTION_CAP / magnitude);
      positions[c * 3] += mx * scale; positions[c * 3 + 1] += my * scale; positions[c * 3 + 2] += mz * scale;
    }
  });
  // Ground contact per part (position projection), against that part's own
  // original map surface.
  for (let i = 0; i < count; i++) {
    const floor = groundZ[i] + index.partRadii[i];
    if (positions[i * 3 + 2] < floor) positions[i * 3 + 2] = floor;
  }
}

/** Spawn the live ragdoll at rest with the death-instant velocity (player
 * velocity + kill impulse), both in the pose frame's actor-local Source units
 * per second (so +Z is up). The spawn pose is the death frame unchanged — the
 * effective cones already include it, matching the original solver's
 * first-step behavior. */
export function spawnSourceRagdoll(rest: SourceRagdollRest, velocity: { x: number; y: number; z: number },
  impulse: { x: number; y: number; z: number }): SourceRagdollLive {
  const velocities = new Float64Array(rest.positions.length);
  for (let i = 0; i < velocities.length; i += 3) {
    velocities[i] = velocity.x + impulse.x;
    velocities[i + 1] = velocity.y + impulse.y;
    velocities[i + 2] = velocity.z + impulse.z;
  }
  // Until the authority samples the original map under each part, every part
  // stands on the death frame's own implied plane, so the corpse never pops.
  const groundZ = new Float64Array(rest.positions.length / 3).fill(rest.groundZ);
  return { positions: rest.positions.slice(), velocities, time: 0, settled: false, settledFor: 0,
    groundZ, jointStrain: new Float64Array(15) };
}

/** Live part orientations derived from simulated positions and the frozen
 * rest: every part rotates by the minimal rotation carrying its rest chain
 * direction onto the live chain direction. `out` receives 16 column-major
 * bone matrices (actor-local Source units). */
export function sourceRagdollBoneMatrices(index: SourceRagdollIndex, positions: ArrayLike<number>,
  rest: SourceRagdollRest, out: Float64Array, authorityQuaternions?: ArrayLike<number>): Float64Array {
  const count = index.data.parts.length;
  check(out.length === count * 16 && positions.length === count * 3, 'Ragdoll bone matrix buffer size mismatch');
  const quaternions = new Float64Array(count * 4), rot = new Float64Array(4);
  if (authorityQuaternions) {
    check(authorityQuaternions.length === count*4 && Array.from(authorityQuaternions).every(Number.isFinite), 'Invalid ragdoll rotations');
    for(let i=0;i<count;i++) {const q=new Quaternion().fromArray(Array.from(authorityQuaternions).slice(i*4,i*4+4));check(q.lengthSq()>.5&&q.lengthSq()<1.5,'Invalid ragdoll quaternion norm');quaternions.set(q.normalize().toArray(),i*4);}
  }
  for (let i = 0; !authorityQuaternions && i < count; i++) {
    const parent = index.partParents[i];
    const reference = parent === null ? index.partChildren[i][0] : parent;
    let dx = positions[reference * 3] - positions[i * 3], dy = positions[reference * 3 + 1] - positions[i * 3 + 1],
      dz = positions[reference * 3 + 2] - positions[i * 3 + 2];
    const length = Math.hypot(dx, dy, dz);
    check(length > 1e-6, 'Degenerate live chain direction');
    dx /= length; dy /= length; dz /= length;
    rotationBetween(rest.chainDirections[i * 3], rest.chainDirections[i * 3 + 1], rest.chainDirections[i * 3 + 2],
      dx, dy, dz, rot, 0);
    multiplyQuat(rot, 0, rest.quaternions, i * 4, quaternions, i * 4);
  }
  for (let i = 0; i < count; i++) {
    const at = i * 16, qi = i * 4, x = quaternions[qi], y = quaternions[qi + 1], z = quaternions[qi + 2], w = quaternions[qi + 3];
    out[at] = 1 - 2 * (y * y + z * z); out[at + 1] = 2 * (x * y + z * w); out[at + 2] = 2 * (x * z - y * w);
    out[at + 4] = 2 * (x * y - z * w); out[at + 5] = 1 - 2 * (x * x + z * z); out[at + 6] = 2 * (y * z + x * w);
    out[at + 8] = 2 * (x * z + y * w); out[at + 9] = 2 * (y * z - x * w); out[at + 10] = 1 - 2 * (x * x + y * y);
    out[at + 3] = out[at + 7] = out[at + 11] = 0;
    out[at + 12] = positions[i * 3]; out[at + 13] = positions[i * 3 + 1]; out[at + 14] = positions[i * 3 + 2]; out[at + 15] = 1;
  }
  return out;
}

/** Euler XYZ (radians) of a quaternion: R = Rz(rz) * Ry(ry) * Rx(rx), the
 * axis convention the original ragdollconstraint limits are written against. */
function quaternionToEulerXYZ(x: number, y: number, z: number, w: number): [number, number, number] {
  const sx = 2 * (w * x + y * z), cx = 1 - 2 * (x * x + y * y);
  const sy = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))));
  const sz = 2 * (w * z + x * y), cz = 1 - 2 * (y * y + z * z);
  return [Math.atan2(sx, cx), sy, Math.atan2(sz, cz)];
}

function eulerXYZToQuaternion(rx: number, ry: number, rz: number): [number, number, number, number] {
  const cx = Math.cos(rx * .5), sx = Math.sin(rx * .5), cy = Math.cos(ry * .5), sy = Math.sin(ry * .5),
    cz = Math.cos(rz * .5), sz = Math.sin(rz * .5);
  return [sx * cy * cz - cx * sy * sz, cx * sy * cz + sx * cy * sz, cx * cy * sz - sx * sy * cz, cx * cy * cz + sx * sy * sz];
}

/** Advance the ragdoll one authoritative tick. Each part's ground is
 * `live.groundZ` along the frame's up axis (+Z), in actor-local Source units;
 * the authority refreshes that array from the original map collision before
 * every step. Pure function.
 *
 * The pose frame is Source-native, so the vertical axis is +Z: gravity pulls
 * along -Z and the ground is a Z level per part. Simulating along +Y instead (as
 * this module first did) left the body standing in Z while dragging it
 * sideways, which the renderer draws as an upright corpse floating off the
 * floor.
 *
 * Position-based dynamics: free integration, then one shared constraint loop
 * (distance + ragdoll joint limits + ground), then the velocity is rewritten
 * from the position delta and relaxed so every correction dissipates energy
 * instead of feeding a position/velocity feedback loop that never settles. */
export function stepSourceRagdoll(index: SourceRagdollIndex, live: SourceRagdollLive, rest: SourceRagdollRest,
  dt: number): SourceRagdollLive {
  check(Number.isFinite(dt) && dt > 0 && dt <= .1, 'Invalid ragdoll dt');
  if (live.settled) return live;
  const count = index.data.parts.length;
  check(live.groundZ.length === count, 'Ragdoll ground level count mismatch');
  const groundZ = live.groundZ;
  const positions = live.positions.slice(), velocities = live.velocities.slice(), previous = positions.slice();
  const masses = index.data.parts.map((p) => p.mass);
  for (let i = 0; i < count; i++) {
    velocities[i * 3 + 2] -= SOURCE_RAGDOLL_GRAVITY * dt;
    // A part already resting on the ground has its weight carried by the
    // contact normal, so gravity must not keep accelerating it into the floor.
    // Without this the clamp pushed the part back out every tick by g*dt^2,
    // a permanent ripple of g*dt units/s that sat right at the settle
    // threshold and kept landed corpses from ever reading as motionless.
    if (positions[i * 3 + 2] <= groundZ[i] + index.partRadii[i] + 1e-3 && velocities[i * 3 + 2] < 0)
      velocities[i * 3 + 2] = 0;
    positions[i * 3] += velocities[i * 3] * dt;
    positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
    positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
  }
  // Free-integration result, kept so the solver's own correction can be told
  // apart from ballistic motion. Gravity has to accumulate across ticks — a
  // corpse falling to the terrain below it must speed up like the original —
  // while the solver's pose correction still has to dissipate instead of
  // feeding a position/velocity feedback loop.
  const free = positions.slice();
  const buffers = ragdollConstraintBuffers(count);
  buffers.violations = new Float64Array(index.data.joints.length);
  const strain = live.jointStrain?.length === index.data.joints.length
    ? live.jointStrain.slice() : new Float64Array(index.data.joints.length);
  const recovering = live.time < LIMIT_RECOVER_SECONDS;
  const limitRelaxBase = recovering ? LIMIT_RECOVER_RELAX : JOINT_LIMIT_RELAX;
  const limitTolerance = recovering ? LIMIT_RECOVER_TOLERANCE : JOINT_LIMIT_TOLERANCE;
  const jointRelax = new Float64Array(index.data.joints.length);
  for (let j = 0; j < jointRelax.length; j++)
    jointRelax[j] = limitRelaxBase * Math.exp(-strain[j] / STRAIN_SCALE);
  for (let iteration = 0; iteration < CONSTRAINT_ITERATIONS; iteration++)
    solveRagdollConstraints(index, positions, rest, groundZ, masses,
      jointRelax, limitTolerance, buffers);
  // Strain bookkeeping from the last solver pass, gated to grounded joints
  // after the tumble grace window: reachable cones report no violation and
  // drain their strain, unreachable ones keep accumulating it until their
  // corrections go quiet.
  const nearFloor = (part: number) => positions[part * 3 + 2] <= groundZ[part] + index.partRadii[part] + STRAIN_NEAR_FLOOR;
  const gated = live.time >= STRAIN_GRACE_SECONDS;
  for (let j = 0; j < strain.length; j++) {
    const joint = index.data.joints[j];
    const resting = nearFloor(joint.parent) || nearFloor(joint.child);
    strain[j] = strain[j] * STRAIN_DECAY + (gated && resting ? buffers.violations[j] : 0);
  }
  // Velocity rewrite from the position delta of the whole solver pass, then
  // per-part damping, inelastic ground contact with friction, and a hard cap
  // keep corpses heavy and quiet.
  //
  // The rewrite splits ballistic motion from the solver's correction: the free
  // velocity carries gravity (so a corpse falling to the terrain below it speeds
  // up like the original), while the correction enters as a relaxed velocity so
  // it dissipates instead of feeding a position/velocity feedback loop. Relaxing
  // the whole velocity instead — as this module first did — capped a falling
  // corpse at g*dt*relax/(1-relax) ≈ 15 units/s: invisible while corpses only
  // ever dropped onto the plane under their own feet, and plainly wrong as soon
  // as they fall metres to the ground.
  //
  // The correction is capped at the per-tick gravity increment. The recovery-
  // phase joint snap moves a part by up to LIMIT_CORRECTION_CAP per iteration,
  // and rewriting that (dt-independent) displacement as Δposition/dt turns a
  // pose correction into real kinetic energy that grows as dt shrinks — at the
  // authority's 1/60 tick it launched corpses at MAX_SPEED instead of letting
  // them fall.
  const ballistic = SOURCE_RAGDOLL_GRAVITY * dt, glide = Math.max(0, 1 - HORIZONTAL_AIR_DRAG * dt);
  for (let i = 0; i < count; i++) {
    const damping = Math.max(0, 1 - index.data.parts[i].damping * dt);
    let cx = (positions[i * 3] - free[i * 3]) / dt * VELOCITY_RELAX;
    let cy = (positions[i * 3 + 1] - free[i * 3 + 1]) / dt * VELOCITY_RELAX;
    let cz = (positions[i * 3 + 2] - free[i * 3 + 2]) / dt * VELOCITY_RELAX;
    const correction = Math.hypot(cx, cy, cz);
    if (correction > ballistic && correction > 0) {
      const scale = ballistic / correction;
      cx *= scale; cy *= scale; cz *= scale;
    }
    // Horizontal motion loses speed to air drag; the vertical component keeps its
    // ballistic velocity so the corpse still falls at the original gravity.
    let vx = (velocities[i * 3] * glide + cx) * damping;
    let vy = (velocities[i * 3 + 1] * glide + cy) * damping;
    let vz = (velocities[i * 3 + 2] + cz) * damping;
    velocities[i * 3] = vx; velocities[i * 3 + 1] = vy; velocities[i * 3 + 2] = vz;
    if (positions[i * 3 + 2] <= groundZ[i] + index.partRadii[i] + 1e-6) {
      if (velocities[i * 3 + 2] < 0) velocities[i * 3 + 2] = 0;
      velocities[i * 3] *= GROUND_FRICTION; velocities[i * 3 + 1] *= GROUND_FRICTION;
    }
    const speed = Math.hypot(velocities[i * 3], velocities[i * 3 + 1], velocities[i * 3 + 2]);
    if (speed > MAX_SPEED) {
      const scale = MAX_SPEED / speed;
      velocities[i * 3] *= scale; velocities[i * 3 + 1] *= scale; velocities[i * 3 + 2] *= scale;
    }
  }
  // Settle detection uses the position delta, not the velocity: the solver
  // leaves a small constant velocity residue on parts where distance and
  // joint-limit corrections fight every tick, but the corpse is visually
  // motionless exactly when its positions stop moving.
  //
  // It averages over the parts instead of taking the worst one. A single foot
  // pinned between an unreachable chain target and the floor can keep
  // re-solving a fraction of a unit every tick while the body is completely
  // frozen, and a worst-part test reads that as motion forever. A corpse that
  // is genuinely still moving slides every part, so the mean catches that just
  // as well, and the ballistic term keeps the threshold meaningful at any dt.
  let sumDelta = 0;
  for (let i = 0; i < count; i++) sumDelta += Math.hypot(
    positions[i * 3] - previous[i * 3], positions[i * 3 + 1] - previous[i * 3 + 1],
    positions[i * 3 + 2] - previous[i * 3 + 2]);
  const quiet = (SETTLE_SPEED + SOURCE_RAGDOLL_GRAVITY * dt) * dt;
  const settledFor = sumDelta / count < quiet ? live.settledFor + dt : 0;
  return { positions, velocities, time: live.time + dt, settled: settledFor >= SETTLE_HOLD, settledFor, groundZ, jointStrain: strain };
}

/** The original map surface under a corpse, in the world frame the level uses
 * (Y up, metres). The authority owns the level query; this module only converts
 * between that frame and the Source-native actor-local pose frame. */
export type SourceRagdollGround = {
  /** Corpse actor origin and yaw (world metres / radians). */
  x: number; y: number; z: number; yaw: number;
  /** Original unit scale, so actor-local part positions become world metres. */
  metersPerSourceUnit: number;
  /** First original surface at or below `fromY` under (x, z), or null when the
   * ray leaves the world or starts inside a solid. */
  surfaceY(x: number, z: number, fromY: number): number | null;
  /** Shared authority world, stepped only by Simulation. */
  physicsWorld?: RAPIER.World;
};

/** Probe tolerance above a part's own sphere bottom: a part resting exactly on a
 * surface must still find that surface, and no ceiling above the part can ever be
 * inside this window. */
const GROUND_FLOOR_TOL = .02;
/** When even that probe starts inside original geometry the part is penetrating a
 * solid. The first surface above it (queried from just over the part's own top)
 * is the solid holding it, so the part is pushed back out onto it. The window is
 * kept to one part radius so a ceiling above a corpse can never be mistaken for
 * the floor that corpse is lying on. */
const GROUND_BURIED_LIFT = .3;

/** Refresh each part's actor-local ground from the original map collision. The
 * actor-local pose frame maps to the world as
 * `world = actorPos + scale * Ry(yaw + pi/2) * (px, pz, -py)`, which is the same
 * conversion the renderer applies to a corpse (verified against the rendered
 * skeleton), so the ray is cast under the part's own drawn position.
 *
 * Each probe starts just under that part's own sphere, so a part hanging under a
 * ceiling keeps the floor below it as its ground instead of climbing onto the
 * ceiling. A part with no original surface under it (a real void, or a burial
 * deeper than the window) keeps `fallbackLocalZ`, which the caller takes from the
 * corpse's own death-frame plane: the pre-terrain behaviour, never an invented
 * support and never a corpse sinking out of the world. */
export function updateSourceRagdollGround(index: SourceRagdollIndex, live: SourceRagdollLive,
  ground: SourceRagdollGround, fallbackLocalZ: number): void {
  const count = index.data.parts.length;
  check(live.positions.length === count * 3 && live.groundZ.length === count, 'Ragdoll ground update size mismatch');
  check([ground.x, ground.y, ground.z, ground.yaw, fallbackLocalZ].every(Number.isFinite) &&
    Number.isFinite(ground.metersPerSourceUnit) && ground.metersPerSourceUnit > 0, 'Invalid ragdoll ground query');
  const s = ground.metersPerSourceUnit, c = Math.cos(ground.yaw + Math.PI / 2), sn = Math.sin(ground.yaw + Math.PI / 2);
  for (let i = 0; i < count; i++) {
    const px = live.positions[i * 3], py = live.positions[i * 3 + 1], pz = live.positions[i * 3 + 2];
    const worldX = ground.x + s * (c * px - sn * py), worldZ = ground.z + s * (-sn * px - c * py);
    const centre = ground.y + s * pz, radius = s * index.partRadii[i];
    const surface = ground.surfaceY(worldX, worldZ, centre - radius + GROUND_FLOOR_TOL)
      ?? ground.surfaceY(worldX, worldZ, centre + radius + GROUND_BURIED_LIFT);
    live.groundZ[i] = surface === null ? fallbackLocalZ : (surface - ground.y) / s;
  }
}

function multiplyMat4(a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number, out: Float64Array, oi: number) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[ai + k * 4 + r] * b[bi + c * 4 + k];
    out[oi + c * 4 + r] = sum;
  }
}

function rigidInvert(m: ArrayLike<number>, at: number, out: Float64Array, to: number) {
  const r0x = m[at], r0y = m[at + 1], r0z = m[at + 2], r1x = m[at + 4], r1y = m[at + 5], r1z = m[at + 6],
    r2x = m[at + 8], r2y = m[at + 9], r2z = m[at + 10], tx = m[at + 12], ty = m[at + 13], tz = m[at + 14];
  out[to] = r0x; out[to + 1] = r1x; out[to + 2] = r2x; out[to + 3] = 0;
  out[to + 4] = r0y; out[to + 5] = r1y; out[to + 6] = r2y; out[to + 7] = 0;
  out[to + 8] = r0z; out[to + 9] = r1z; out[to + 10] = r2z; out[to + 11] = 0;
  out[to + 12] = -(r0x * tx + r0y * ty + r0z * tz); out[to + 13] = -(r1x * tx + r1y * ty + r1z * tz);
  out[to + 14] = -(r2x * tx + r2y * ty + r2z * tz); out[to + 15] = 1;
}

/** Full skeleton Source-world matrices for one simulated corpse: the 16 part
 * bones carry the simulated matrices; every other bone rigidly follows its
 * nearest owner part (live part transform applied to its death-instant rest
 * matrix). `restFull` is the death-instant full-skeleton world pose. */
export function expandSourceRagdollWorldMatrices(index: SourceRagdollIndex, restFull: ArrayLike<number>,
  positions: ArrayLike<number>, rest: SourceRagdollRest, out: Float64Array, quaternions?: ArrayLike<number>): Float64Array {
  const boneCount = index.partOwners.length, partCount = index.data.parts.length;
  check(out.length === boneCount * 16 && restFull.length >= boneCount * 16, 'Ragdoll world matrix buffer size mismatch');
  const parts = sourceRagdollBoneMatrices(index, positions, rest, new Float64Array(partCount * 16), quaternions);
  const deltas = new Float64Array(partCount * 16), inverse = new Float64Array(16);
  for (let part = 0; part < partCount; part++) {
    const bone = index.partBones[part];
    rigidInvert(restFull, bone * 16, inverse, 0);
    multiplyMat4(parts, part * 16, inverse, 0, deltas, part * 16);
    out.set(parts.subarray(part * 16, part * 16 + 16), bone * 16);
  }
  const delta = new Float64Array(16);
  for (let bone = 0; bone < boneCount; bone++) {
    const part = index.partOwners[bone];
    if (index.partBones[part] === bone) continue;
    multiplyMat4(deltas, part * 16, restFull, bone * 16, delta, 0);
    out.set(delta, bone * 16);
  }
  return out;
}

/** The corpse's render-ready pose: Source-local positions/quaternions for all
 * main bones, full Source-world matrices, and the render-local bone pose the
 * character actors consume (only the root bone re-bases the Source-native +Z up
 * axis into the GLTF frame, exactly like the animation sampler). */
export type SourceRagdollPoseSample = {
  positions: Float64Array; quaternions: Float64Array; sourceWorldMatrices: Float64Array;
  renderLocalPositions: Float64Array; renderLocalQuaternions: Float64Array;
};
const RENDER_CONVERSION = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

export function sampleSourceRagdollPose(index: SourceRagdollIndex, restFull: ArrayLike<number>,
  rest: SourceRagdollRest, positions: ArrayLike<number>, quaternions?: ArrayLike<number>): SourceRagdollPoseSample {
  const boneCount = index.partOwners.length;
  const worlds = expandSourceRagdollWorldMatrices(index, restFull, positions, rest, new Float64Array(boneCount * 16), quaternions);
  const localPositions = new Float64Array(boneCount * 3), localQuaternions = new Float64Array(boneCount * 4);
  const renderPositions = new Float64Array(boneCount * 3), renderQuaternions = new Float64Array(boneCount * 4);
  const local = new Float64Array(16), inverse = new Float64Array(16);
  for (let bone = 0; bone < boneCount; bone++) {
    const parent = index.boneParents[bone];
    if (parent < 0) local.set(worlds.subarray(bone * 16, bone * 16 + 16));
    else {
      rigidInvert(worlds, parent * 16, inverse, 0);
      multiplyMat4(inverse, 0, worlds, bone * 16, local, 0);
    }
    matrixTranslation(localPositions, bone, local, 0);
    matrixQuaternion(localQuaternions, bone, local, 0);
    if (parent < 0) {
      renderPositions.set([localPositions[bone * 3], localPositions[bone * 3 + 2], -localPositions[bone * 3 + 1]], bone * 3);
      multiplyQuat(new Float64Array(RENDER_CONVERSION), 0, localQuaternions, bone * 4, renderQuaternions, bone * 4);
    } else {
      renderPositions.set(localPositions.subarray(bone * 3, bone * 3 + 3), bone * 3);
      renderQuaternions.set(localQuaternions.subarray(bone * 4, bone * 4 + 4), bone * 4);
    }
  }
  return { positions: localPositions, quaternions: localQuaternions, sourceWorldMatrices: worlds,
    renderLocalPositions: renderPositions, renderLocalQuaternions: renderQuaternions };
}

/** The death-instant full-skeleton sampler input shared by the authority (rest
 * construction) and every client (independent restFull rebuild): the original
 * non-looping Death1 at its first frame with the corpse's neutral parameters. */
export const SOURCE_RAGDOLL_DEATH_REST_INPUT: SourceCharacterPoseInput = {
  state: 'Death', parameters: { move_x: 0, move_y: 0, body_yaw: 0, body_pitch: 0 },
  cycle: 0, upperCycle: 0, fireCycle: 0, fireWeight: 0, blendMode: 'sdk-3way',
};

/** Rebuild the frozen death-instant rest state for one pose dataset from the
 * shared Death1 cycle 0 frame; used identically by the authority and clients. */
export function computeSourceRagdollRestFromDeath1(index: SourceRagdollIndex,
  poseIndex: SourceCharacterPoseIndex): { rest: SourceRagdollRest; restFull: Float64Array } {
  const sampled = sampleSourceCharacterPose(poseIndex, SOURCE_RAGDOLL_DEATH_REST_INPUT);
  return { rest: computeSourceRagdollRest(index, sampled.sourceWorldMatrices), restFull: sampled.sourceWorldMatrices };
}

/** Wire-safe snapshot of the actual living main-bone pose, including weapon
 * action overlays. Bone-local transforms keep all original twists and helper
 * bones; positions-only part snapshots cannot reconstruct these. */
export type SourceRagdollPosePlayer = {
  weapon?: string;
  sourcePose?: SourceCharacterPoseInput;
  sourcePistolPose?: {body: SourceCharacterPoseInput; bodyLayers?: readonly {sequence:string; cycle:number; weight:number}[]};
  sourceAWPPose?: {body: SourceCharacterPoseInput; bodyLayers?: readonly {sequence:string; cycle:number; weight:number}[]};
};
export function captureSourceRagdollPose(index: SourceCharacterPoseIndex, player: SourceRagdollPosePlayer): SourceRagdollRestTransforms {
  const composite = player.weapon === 'awp' ? player.sourceAWPPose
    : player.weapon && !['glock','usp','deagle'].includes(player.weapon) ? undefined
    : player.sourcePistolPose ?? (player.weapon === undefined ? player.sourceAWPPose : undefined);
  const input = composite?.body ?? player.sourcePose;
  check(input, 'A living source pose is required before ragdoll creation');
  const sampled = sampleSourceCharacterPose(index, input);
  let animation = sampled.animationPose;
  for (const layer of composite?.bodyLayers ?? []) animation = accumulateSourceSequence(index, animation, layer.sequence,
    layer.cycle, layer.weight, input.parameters, input.blendMode);
  if (!composite?.bodyLayers?.length) return {positions: Array.from(sampled.positions), quaternions: Array.from(sampled.quaternions)};
  const positions: number[] = [], quaternions: number[] = [];
  for (let i=0;i<index.mainBoneCount;i++) {
    const mapped=index.data.mainToAnimation[i], bone=index.data.mainBones[i];
    positions.push(...(mapped>=0?animation.positions.slice(mapped*3,mapped*3+3):bone.position));
    quaternions.push(...(mapped>=0?animation.quaternions.slice(mapped*4,mapped*4+4):new Quaternion().fromArray(bone.quaternion).normalize().toArray()));
  }
  return {positions,quaternions};
}
export function sourceRagdollRestWorldMatrices(index: SourceRagdollIndex, pose: SourceRagdollRestTransforms): Float64Array {
  const count=index.boneParents.length;
  check(pose.positions.length===count*3&&pose.quaternions.length===count*4&&pose.positions.every(Number.isFinite)&&pose.quaternions.every(Number.isFinite),'Invalid complete ragdoll rest pose');
  const out=new Float64Array(count*16), local=new Matrix4(), position=new Vector3(), rotation=new Quaternion(), one=new Vector3(1,1,1);
  for(let i=0;i<count;i++) {
    position.fromArray(pose.positions,i*3);rotation.fromArray(pose.quaternions,i*4);
    check(rotation.lengthSq()>.5&&rotation.lengthSq()<1.5,'Invalid rest quaternion');
    local.compose(position,rotation.normalize(),one);
    const parent=index.boneParents[i];
    if(parent>=0)local.premultiply(new Matrix4().fromArray(out,parent*16));
    out.set(local.elements,i*16);
  }
  return out;
}
/** Shared actor-side decode for all six weapon families. */
export function sampleSourceRagdollState(index: SourceRagdollIndex, poseIndex: SourceCharacterPoseIndex, state: SourceRagdollState): SourceRagdollPoseSample {
  const legacy=state.restPose?null:computeSourceRagdollRestFromDeath1(index,poseIndex);
  const restFull=state.restPose?sourceRagdollRestWorldMatrices(index,state.restPose):legacy!.restFull;
  const rest=legacy?.rest??computeSourceRagdollRest(index,restFull);
  check(state.positions.length===index.data.parts.length*3&&state.positions.every(Number.isFinite),'Invalid ragdoll part positions');
  return sampleSourceRagdollPose(index,restFull,rest,state.positions,state.quaternions);
}

/** Server-authoritative ragdoll control surface attached to a pose driver:
 * per-player live simulation keyed by player id, so one shared driver safely
 * serves every corpse on the authority. Velocities/impulses arrive in Source
 * units per second. */
export type SourceRagdollDriver = {
  capturePose(player: SourceRagdollPosePlayer): SourceRagdollRestTransforms;
  beginRagdoll(player: { id: string }, velocity: { x: number; y: number; z: number },
    impulse: { x: number; y: number; z: number }, ground?: SourceRagdollGround, restPose?: SourceRagdollRestTransforms): SourceRagdollState;
  stepRagdoll(player: { id: string }, dt: number, ground?: SourceRagdollGround): SourceRagdollState | null;
  endRagdoll(player: { id: string }): void;
};

export function createSourceRagdollPoseDriver(base: SourcePoseDriver, poseIndex: SourceCharacterPoseIndex,
  data: SourceRagdollData, sharedStates?: Map<string, { rest: SourceRagdollRest; live: SourceRagdollLive }>): SourcePoseDriver {
  const index = bindSourceRagdoll(data, poseIndex);
  // All weapon drivers of one scenario share the corpse table, so a player
  // who dies holding one weapon and respawns with another still clears its
  // corpse from whichever driver the round reset reaches.
  const states = sharedStates ?? new Map<string, { rest: SourceRagdollRest; live: SourceRagdollLive }>();
  const ragdoll: SourceRagdollDriver = {
    capturePose(player) { return captureSourceRagdollPose(poseIndex,player); },
    beginRagdoll(player, velocity, impulse, ground, restPose) {
      const rest = restPose ? computeSourceRagdollRest(index, sourceRagdollRestWorldMatrices(index, restPose)) : computeSourceRagdollRestFromDeath1(index,poseIndex).rest;
      const live = spawnSourceRagdoll(rest, velocity, impulse);
      // The corpse rests on the original surface under each part from its very
      // first tick, so dying in mid-air no longer freezes it at the death height.
      if (ground) updateSourceRagdollGround(index, live, ground, rest.groundZ);
      states.get(player.id)?.live.rigid?.dispose();
      // Complete-pose authority uses rigid contact. The legacy no-rest API stays
      // readable for archived replays and deliberately narrow old fixtures.
      if(restPose) {live.restPose=structuredClone(restPose);live.rigid=createSourceRigidRagdoll(index,rest,velocity,impulse,ground);}
      states.set(player.id, { rest, live });
      return live.rigid ? {...live.rigid.read(0),restPose:live.restPose} : serializeSourceRagdoll(live);
    },
    stepRagdoll(player, dt, ground) {
      const state = states.get(player.id);
      if (!state) return null;
      if(state.live.rigid) return {...state.live.rigid.read(dt),restPose:state.live.restPose};
      if (!state.live.settled) {
        if (ground) updateSourceRagdollGround(index, state.live, ground, state.rest.groundZ);
        state.live = stepSourceRagdoll(index, state.live, state.rest, dt);
      }
      return serializeSourceRagdoll(state.live);
    },
    endRagdoll(player) { states.get(player.id)?.live.rigid?.dispose(); states.delete(player.id); },
  };
  return { ...base, ragdoll, ragdollIndex: index };
}
