/** The original player foot IK.
 *
 * The original player animations carry their own foot IK: every `a_Run*` variant
 * and the two idle turn layers declare a `GROUND` rule per foot chain, with the
 * cycle window in which the foot is planted (`start`/`peak`/`tail`/`end`), the
 * frame it makes contact, and the original `height` (18 units) and `radius`
 * (2.5 units). See `docs/source-ik-rules.md` and `game/source-ik-rules.ts` for
 * where those numbers come from.
 *
 * This module evaluates the original rules at the pose's own cycle, blends them
 * with exactly the descriptor weights the pose was built from, and solves the
 * two-bone hip/knee chain so the foot keeps its animated height above the
 * surface the original collision reports under it. The reference is the actor
 * origin on which the animation was authored, not the ground at the centre of
 * an axis-aligned collision hull. Those differ on slopes. When the original
 * origin lies on flat ground, the correction is zero and the pose is untouched.
 *
 * Boundaries (recorded in docs/parity.md): the solve is a standard two-bone IK,
 * not the original engine's solver; position correction follows world up,
 * the planted sole tilts to the original collision normal, and unreachable
 * targets use the public SDK reach clamp without stretching bones. Original
 * compressed IK error curves, contact latching and native solver parity remain
 * unimplemented; a reach-limited foot can retain a small surface gap.
 */
import * as T from 'three';
import { sourceIKWindowWeight, type SourceIKRules } from './source-ik-rules';
import { sourceSequenceBlend, type SourceCharacterPoseIndex, type SourceCharacterState,
  type SourcePoseMode, type SourcePoseParameters } from './source-character-pose';

/** Source poses are authored in Source units (1 unit = 1 inch); the actor root
 * carries the conversion, so a rule's original numbers are converted here. */
const unit = (metersPerSourceUnit: number, value: number) => value * metersPerSourceUnit;
/** Public Source SDK bone_setup.cpp Studio_SolveIK keeps a nearly straight
 * knee one degree from its singularity; this is not a fitted model tolerance. */
const KNEEMAX_EPSILON = .9998;

export type SourceFootIKChain = { chain: number; name: string; hip: number; knee: number; foot: number };
export type SourceFootIKGround = (x: number, z: number, fromY: number) => number | null;
export type SourceFootIKInput = {
  /** The shipped pose index of this actor (bone names, sequences, descriptors). */
  index: SourceCharacterPoseIndex;
  /** The actor's own cloned character bones, in the pose index's main order. */
  bones: readonly T.Bone[];
  /** The staged original IK rule set of this character's team. */
  rules: SourceIKRules;
  /** World position of the actor's origin (the original model stands on it). */
  origin: { x: number; y: number; z: number };
  metersPerSourceUnit: number;
  /** The original collision's surface under a world column. */
  ground: SourceFootIKGround;
  /** Original collision normal in world Y-up coordinates. */
  groundNormal?: (x: number, z: number, fromY: number) => {x:number;y:number;z:number}|null;
  state: SourceCharacterState;
  cycle: number;
  parameters: SourcePoseParameters;
  blendMode?: SourcePoseMode;
};

/** The team whose original animation model this pose index was built from. */
export function sourceFootIKTeam(index: SourceCharacterPoseIndex): 't' | 'ct' {
  return /(^|[/\\])ct_animations\.mdl$/.test(index.data.animationModel) ? 'ct' : 't';
}

/** The original foot chains of this pose index: exactly the chains the original
 * GROUND rules target (chain 2 right, 3 left), resolved to the actor's own bone
 * slots by the original link bone names. */
export function sourceFootIKChains(index: SourceCharacterPoseIndex, rules: SourceIKRules, team: 't' | 'ct'): SourceFootIKChain[] {
  const slot = new Map<string, number>();
  index.data.mainBones.forEach((bone, i) => { if (!slot.has(bone.name)) slot.set(bone.name, i); });
  const grounded = new Set<number>();
  for (const list of rules.teams[team].rules.values()) for (const rule of list) if (rule.type === 'GROUND') grounded.add(rule.chain);
  const chains: SourceFootIKChain[] = [];
  for (const chain of rules.teams[team].chains) {
    if (!grounded.has(chain.index) || chain.links.length !== 3) continue;
    const slots = chain.links.map(link => slot.get(link.name));
    if (slots.some(s => s === undefined)) continue;
    chains.push({ chain: chain.index, name: chain.name, hip: slots[0]!, knee: slots[1]!, foot: slots[2]! });
  }
  return chains;
}

/** The original rule of one foot at this cycle, blended by the descriptor
 * weights the pose was actually built from. `envelope` is the original window
 * influence (0 outside the window), the rest are the original numbers averaged
 * by that same influence. */
export type SourceFootIKRule = { envelope: number; height: number; radius: number; contact: number; weight: number };
export function sourceFootIKRule(index: SourceCharacterPoseIndex, rules: SourceIKRules, team: 't' | 'ct',
  descriptors: readonly { animationIndex: number; weight: number }[], chain: number, cycle: number): SourceFootIKRule {
  const table = rules.teams[team].rules;
  let influence = 0, height = 0, radius = 0, contact = 0;
  for (const { animationIndex, weight } of descriptors) {
    const frame = index.frames.get(animationIndex);
    if (!frame) continue;
    for (const rule of table.get(frame.descriptor.name) ?? []) {
      if (rule.type !== 'GROUND' || rule.chain !== chain) continue;
      const at = weight * sourceIKWindowWeight(rule.window, cycle);
      if (!(at > 0)) continue;
      influence += at; height += rule.height * at; radius += rule.radius * at; contact += rule.contact * at;
    }
  }
  if (!(influence > 0)) return { envelope: 0, height: 0, radius: 0, contact: 0, weight: 0 };
  return { envelope: Math.min(1, influence), height: height / influence, radius: radius / influence,
    contact: contact / influence, weight: influence };
}

/** Rotates a bone so its `from -> wasTo` direction becomes `from -> nowTo`,
 * keeping its twist, by applying the world-space delta `Q` to the local
 * rotation: `local = parentWorld⁻¹ · Q · parentWorld · local`. */
function aimBone(bone: T.Bone, from: T.Vector3, wasTo: T.Vector3, nowTo: T.Vector3, worldDelta?: T.Quaternion): T.Quaternion | null {
  const a = wasTo.clone().sub(from), b = nowTo.clone().sub(from);
  if (!(a.lengthSq() > 1e-18) || !(b.lengthSq() > 1e-18)) return null;
  const delta = new T.Quaternion().setFromUnitVectors(a.normalize(), b.normalize());
  applyWorldRotation(bone, delta);
  if (worldDelta) worldDelta.copy(delta);
  return delta;
}
/** The rotation part of an object's world matrix. The actor's bones hang under a
 * model scaled by the original unit (1 Source unit = 1 inch = 0.0254 m), and
 * THREE's `setFromRotationMatrix` assumes an unscaled matrix, so the uniform
 * scale has to be divided out before the quaternion means anything. */
export function sourceBoneWorldRotation(object: T.Object3D): T.Quaternion {
  const e = object.matrixWorld.elements;
  const scaleX = Math.hypot(e[0], e[1], e[2]), scaleY = Math.hypot(e[4], e[5], e[6]), scaleZ = Math.hypot(e[8], e[9], e[10]);
  const m = new T.Matrix4().copy(object.matrixWorld);
  for (const [column, scale] of [[0, scaleX], [4, scaleY], [8, scaleZ]] as const)
    for (let row = 0; row < 3; row++) m.elements[column + row] = scale > 0 ? m.elements[column + row] / scale : m.elements[column + row];
  return new T.Quaternion().setFromRotationMatrix(m);
}

/** Applies a world-space rotation delta to one bone's local rotation. */
function applyWorldRotation(bone: T.Bone, delta: T.Quaternion): void {
  const parent = bone.parent;
  if (!(parent && parent.isObject3D)) return;
  const parentWorld = sourceBoneWorldRotation(parent);
  bone.quaternion.premultiply(parentWorld.clone().invert().multiply(delta).multiply(parentWorld)).normalize();
}

/** Solves one original foot chain so the foot origin moves `delta` metres along
 * world up, keeping the animated bend plane and the foot's world orientation.
 * Unreachable targets use the public SDK's far/near limits instead of abandoning
 * the entire solve. Invalid or directionless chains still change nothing. */
export function solveSourceFootChain(hip: T.Bone, knee: T.Bone, foot: T.Bone, delta: number): boolean {
  if (!Number.isFinite(delta) || !(Math.abs(delta) > 1e-6)) return false;
  const p0 = new T.Vector3().setFromMatrixPosition(hip.matrixWorld);
  const p1 = new T.Vector3().setFromMatrixPosition(knee.matrixWorld);
  const p2 = new T.Vector3().setFromMatrixPosition(foot.matrixWorld);
  const upper = p1.distanceTo(p0), lower = p2.distanceTo(p1);
  if (!(upper > 1e-6) || !(lower > 1e-6)) return false;
  const target = p2.clone(); target.y += delta;
  const reach = target.clone().sub(p0);
  let distance = reach.length();
  if (!(distance > 1e-6) || !Number.isFinite(distance)) return false;
  // Source SDK bone_setup.cpp:2810–2828. Move the target into the reachable
  // interval, not the joints apart. At the near limit use the authored direction.
  const far = (upper + lower) * KNEEMAX_EPSILON;
  const near = Math.max(Math.abs(upper - lower) * 1.15, Math.min(upper, lower) * .15);
  if (distance > far) { reach.multiplyScalar(far / distance); distance = far; }
  else if (distance < near) {
    reach.copy(p2).sub(p0);if (!(reach.lengthSq() > 1e-12)) return false;
    reach.normalize().multiplyScalar(near);distance = near;
  }
  target.copy(p0).add(reach);
  reach.normalize();
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const bend = Math.sqrt(Math.max(0, upper * upper - along * along));
  // The knee keeps bending the way the animation bends it: the component of the
  // animated knee offset perpendicular to the new reach direction. A straight
  // animated chain has no bend direction to preserve, so it is refused (the
  // original knee direction would be a guess, not this file's to invent).
  const kneeOffset = p1.clone().sub(p0);
  const perpendicular = kneeOffset.clone().addScaledVector(reach, -kneeOffset.dot(reach));
  if (!(perpendicular.lengthSq() > 1e-14)) return false;
  const kneeTarget = p0.clone().addScaledVector(reach, along).addScaledVector(perpendicular.normalize(), bend);
  const hipDelta = new T.Quaternion();
  if (!aimBone(hip, p0, p1, kneeTarget, hipDelta)) return false;
  hip.updateMatrixWorld(true);
  const kneeNow = new T.Vector3().setFromMatrixPosition(knee.matrixWorld);
  const footNow = new T.Vector3().setFromMatrixPosition(foot.matrixWorld);
  const kneeDelta = new T.Quaternion();
  if (!aimBone(knee, kneeNow, footNow, target, kneeDelta)) return false;
  knee.updateMatrixWorld(true);
  // Keep the foot's own world orientation: the ankle stays as animated and the
  // sole does not tilt with the knee. Both aims above rotated the foot with the
  // chain, so undoing them means applying the inverse of the whole world delta.
  applyWorldRotation(foot, hipDelta.clone().invert().multiply(kneeDelta.clone().invert()));
  foot.updateMatrixWorld(true);
  return true;
}

export type SourceFootIKResult = { applied: number; moved: number; chains: { chain: number; envelope: number; delta: number; actualDelta?: number; reachLimited?: boolean; normalAligned?: boolean }[] };

/** Tilt the authored sole plane onto a walkable surface while retaining the
 * animation's yaw/twist. The exact GROUND window supplies the blend weight. */
export function alignSourceFootToGround(foot: T.Bone, normal: {x:number;y:number;z:number}, weight: number): boolean {
  if(![normal.x,normal.y,normal.z,weight].every(Number.isFinite)||weight<=0)return false;
  const n=new T.Vector3(normal.x,normal.y,normal.z);
  if(n.lengthSq()<1e-12)return false;
  n.normalize();
  if(n.y<.7||n.y>1-1e-12)return false;
  const tilt=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),n);
  tilt.slerp(new T.Quaternion(),1-Math.min(1,weight));
  applyWorldRotation(foot,tilt);foot.updateMatrixWorld(true);return true;
}

/** Applies the original foot IK of the current pose. Requires the actor's world
 * matrices to be current; leaves them current for the caller. */
export function applySourceFootIK(input: SourceFootIKInput): SourceFootIKResult {
  const result: SourceFootIKResult = { applied: 0, moved: 0, chains: [] };
  const lower = input.index.data.states[input.state]?.lower;
  if (lower === undefined) return result;
  const team = sourceFootIKTeam(input.index);
  const descriptors = sourceSequenceBlend(input.index, lower, input.cycle, input.parameters, input.blendMode);
  const chains = sourceFootIKChains(input.index, input.rules, team);
  if (!chains.length || !descriptors.length) return result;
  // Nothing is traced (and no pose is touched) unless an original window is
  // actually open on a foot, so an idle or airborne pose costs nothing.
  const rules = new Map<number, SourceFootIKRule>();
  for (const chain of chains) {
    const rule = sourceFootIKRule(input.index, input.rules, team, descriptors, chain.chain, input.cycle);
    rules.set(chain.chain, rule);
    if (rule.envelope > 0) result.applied++;
    result.chains.push({ chain: chain.chain, envelope: rule.envelope, delta: 0 });
  }
  if (!result.applied) return result;
  for (const chain of chains) {
    const rule = rules.get(chain.chain)!;
    const measured = result.chains.find(c => c.chain === chain.chain)!;
    if (!(rule.envelope > 0)) continue;
    const foot = input.bones[chain.foot], hip = input.bones[chain.hip], knee = input.bones[chain.knee];
    if (!(hip?.isBone && knee?.isBone && foot?.isBone)) { result.applied--; continue; }
    const height = unit(input.metersPerSourceUnit, rule.height);
    const footPosition = new T.Vector3().setFromMatrixPosition(foot.matrixWorld);
    const surface = input.ground(footPosition.x, footPosition.z, footPosition.y + height);
    if (surface === null || !Number.isFinite(surface)) continue;
    const floor = input.origin.y;
    // The authored sole is relative to the model origin. Subtracting a second
    // centre-ground trace would retain the hull's slope clearance (10–11 cm on
    // the original Dust II fixtures). Preserve the original window and step cap.
    const delta = Math.max(-height, Math.min(height, rule.envelope * (surface - floor)));
    measured.delta = delta;
    const translated=solveSourceFootChain(hip,knee,foot,delta);
    measured.actualDelta=new T.Vector3().setFromMatrixPosition(foot.matrixWorld).y-footPosition.y;
    if(Math.abs(measured.actualDelta-delta)>1e-5)measured.reachLimited=true;
    const normal=input.groundNormal?.(footPosition.x,footPosition.z,footPosition.y+height);
    const aligned=normal?alignSourceFootToGround(foot,normal,rule.envelope):false;
    if(aligned)measured.normalAligned=true;
    if(translated||aligned)result.moved++;
  }
  return result;
}
