import * as T from 'three';

/** The original reload animation takes the spent magazine out of the weapon at
 * AE_CL_EJECT_MAG and the client drops it as its own physics prop (CS:GO's
 * `CMagazine`, a VPhysics prop) that falls to the ground and is removed a while
 * later. This module reproduces that prop from the ORIGINAL magazine geometry:
 * the world weapon magazine is rigidly bound to a single `weapon_mag` joint, so
 * detaching it is an exact rigid transform of its bind-pose geometry and no
 * second copy of the asset is needed.
 *
 * Two deliberate boundaries, both recorded in docs/parity.md:
 *  - The flight is a bounded ballistic + single-contact settle approximation of
 *    VPhysics, not a full rigid-body solver: the prop rests on one horizontal
 *    surface rather than tumbling down arbitrary BSP/PHY faces. That surface is
 *    the original map surface the authority traced under the shooter
 *    (`sourceLevel.groundHeight`, MASK_SOLID), so a reload beside a ledge drops
 *    the prop onto the real ledge instead of onto a plane through the feet.
 *  - It is a local presentation prop with no gameplay authority, exactly like
 *    the original (a dropped magazine is cosmetic and cannot be picked up).
 */

/** Fixed draw budget: one mesh per live prop, no shadow-map draws. The original
 * reload takes ~2.4s, so a full server reloading at once still stays near this. */
export const SOURCE_MAGAZINE_DROP_BUDGET = 8;
/** sv_gravity 800 at the original 1 unit = 1 inch (the same constant the
 * authoritative PHY corpse uses). */
export const SOURCE_MAGAZINE_DROP_GRAVITY = 800 * .0254;
/** The original removes the prop a while after it lands (m_flRemoveTime). */
export const SOURCE_MAGAZINE_DROP_LIFE = 12;
const SETTLE_SECONDS = .38, RESTITUTION = .26, CONTACT_FRICTION = .42, REST_SPEED = .55, SPIN_DECAY = .45;
const STEP_CAP = .05;

function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

export type SourceMagazineDropBounds = { half: T.Vector3; center: T.Vector3 };
const BOUNDS = new WeakMap<T.BufferGeometry, SourceMagazineDropBounds>();
/** The original magazine geometry's local bounds. The magazine mesh is rigid
 * (a single joint at weight 1), so its bind-pose box IS the prop's shape. */
export function sourceMagazineDropBounds(geometry: T.BufferGeometry): SourceMagazineDropBounds {
  const cached = BOUNDS.get(geometry); if (cached) return cached;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox; check(box, 'Original magazine geometry has no bounds');
  const half = new T.Vector3().subVectors(box.max, box.min).multiplyScalar(.5);
  const center = new T.Vector3().addVectors(box.max, box.min).multiplyScalar(.5);
  check([half.x, half.y, half.z, center.x, center.y, center.z].every(Number.isFinite) && half.x > 0 && half.y > 0 && half.z > 0,
    'Invalid original magazine bounds');
  const value = { half, center }; BOUNDS.set(geometry, value); return value;
}

/** The world transform of a detached original magazine. The character/weapon
 * magazine is a SkinnedMesh bound rigidly to one joint, so the original
 * three.js skin transform collapses to a single bone matrix:
 * matrixWorld * bindMatrixInverse * bone.matrixWorld * boneInverse * bindMatrix.
 * A prop that is NOT rigidly bound returns null: this never invents a shape. */
export function sourceMagazineMeshTransform(mesh: T.Mesh): T.Matrix4 | null {
  const skinned = mesh as T.SkinnedMesh;
  if ((mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh !== true) { mesh.updateWorldMatrix(true, false); return mesh.matrixWorld.clone(); }
  const geometry = mesh.geometry, skinIndex = geometry.getAttribute('skinIndex'), skinWeight = geometry.getAttribute('skinWeight');
  if (!skinIndex || !skinWeight || !skinned.skeleton) return null;
  const weight = new Map<number, number>(); let total = 0;
  for (let i = 0; i < skinIndex.count; i++) for (let c = 0; c < 4; c++) {
    const w = skinWeight.getComponent(i, c); if (!(w > 0)) continue;
    const joint = skinIndex.getComponent(i, c); weight.set(joint, (weight.get(joint) ?? 0) + w); total += w;
  }
  let joint = -1, share = 0;
  for (const [index, sum] of weight) if (sum > share) { joint = index; share = sum; }
  const bone = joint >= 0 ? skinned.skeleton.bones[joint] : undefined, inverse = joint >= 0 ? skinned.skeleton.boneInverses[joint] : undefined;
  if (!bone || !inverse || total <= 0 || share / total < .999) return null;
  return new T.Matrix4().multiplyMatrices(skinned.matrixWorld,
    new T.Matrix4().multiplyMatrices(skinned.bindMatrixInverse,
      new T.Matrix4().multiplyMatrices(bone.matrixWorld,
        new T.Matrix4().multiplyMatrices(inverse, skinned.bindMatrix))));
}

export type SourceMagazineDropSource = {
  /** Original weapon identity; the pool swaps geometry/material when it changes. */
  key: string;
  geometry: T.BufferGeometry;
  material: T.Material;
  /** World transform of the original magazine at the eject event. */
  matrix: T.Matrix4;
  /** Ground level under the weapon (the shooter's own origin height). */
  floorY: number;
  /** Horizontal world direction away from the weapon, already normalised. */
  forward: T.Vector3;
  /** Deterministic per-drop variation so two clients drop the same prop. */
  seed: number;
  /** The original map surface under an arbitrary world column, when the caller
   * can query it. The prop re-samples it under its own column while it flies,
   * the way the original client-side VPhysics prop rests on whatever it lands
   * on; without it the prop keeps the single level it was spawned with. */
  surfaceY?: (x: number, z: number, fromY: number) => number | null;
};

/** Builds the prop from an original weapon actor's own magazine mesh. Returns
 * null when the mesh carries no single rigid joint, an array material, or no
 * usable direction: this never substitutes a shape the original does not have. */
export function sourceMagazineDropFromMesh(options: { key: string; mesh: T.Mesh; root: T.Object3D;
  origin: { x: number; y: number; z: number }; floorY: number; seed: number;
  surfaceY?: (x: number, z: number, fromY: number) => number | null }): SourceMagazineDropSource | null {
  const { key, mesh, root, origin, floorY, seed, surfaceY } = options;
  const material = Array.isArray(mesh.material) ? undefined : mesh.material;
  const matrix = material ? sourceMagazineMeshTransform(mesh) : null;
  if (!matrix) return null;
  const position = new T.Vector3().setFromMatrixPosition(matrix);
  const forward = new T.Vector3(position.x - origin.x, 0, position.z - origin.z);
  // The weapon hangs ahead of the shooter's origin; if it ever sits exactly over
  // it, fall back to the operator's own facing, which is the original actor's
  // local +X after the fixed yaw offset from the pose contract.
  if (forward.lengthSq() < 1e-8) forward.setFromMatrixColumn(root.matrixWorld, 0).setY(0);
  if (!(forward.lengthSq() > 1e-12) || !material) return null;
  return { key, geometry: mesh.geometry, material, matrix, floorY, forward: forward.normalize(), seed,
    ...(surfaceY === undefined ? {} : { surfaceY }) };
}

export type SourceMagazineDropBody = {
  center: T.Vector3; quaternion: T.Quaternion; velocity: T.Vector3; spin: T.Vector3;
  /** Box half extents and centre offset in WORLD metres, i.e. the original
   * geometry bounds scaled by the weapon's own unit scale (1 unit = 1 inch). */
  half: T.Vector3; centerOffset: T.Vector3; scale: number; flatAxis: number;
  floorY: number; age: number; life: number; resting: boolean; settling: number;
  settleFrom: T.Quaternion; settleTo: T.Quaternion;
};

/** Deterministic 32-bit LCG; the same seed yields the same tumble everywhere. */
function random(seed: number) {
  let state = (seed >>> 0) || 1;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
}

/** The axis the original prop lies on once it settles: the thinnest one, i.e.
 * the normal of the magazine's largest face. */
function thinnestAxis(half: T.Vector3) {
  return half.x <= half.y && half.x <= half.z ? 0 : half.y <= half.z ? 1 : 2;
}

/** How far the box extends below its centre for this orientation: the support
 * function of an axis-aligned box, so a tilted prop never sinks into the floor. */
export function sourceMagazineDropSupport(half: T.Vector3, quaternion: T.Quaternion): number {
  const m = new T.Matrix4().makeRotationFromQuaternion(quaternion).elements;
  return Math.abs(m[1] * half.x) + Math.abs(m[5] * half.y) + Math.abs(m[9] * half.z);
}

function flatOrientation(body: SourceMagazineDropBody, out: T.Quaternion): T.Quaternion {
  const axis = new T.Vector3(body.flatAxis === 0 ? 1 : 0, body.flatAxis === 1 ? 1 : 0, body.flatAxis === 2 ? 1 : 0)
    .applyQuaternion(body.quaternion);
  const up = new T.Vector3(0, axis.y < 0 ? -1 : 1, 0);
  // The minimal rotation to lay the magazine's largest face down; it keeps the
  // prop's own yaw, so the original facing is preserved.
  return out.setFromUnitVectors(axis.normalize(), up).multiply(body.quaternion).normalize();
}

export function spawnSourceMagazineDropBody(source: SourceMagazineDropSource, bounds: SourceMagazineDropBounds): SourceMagazineDropBody {
  const next = random(source.seed);
  const position = new T.Vector3(), quaternion = new T.Quaternion(), scale = new T.Vector3();
  source.matrix.decompose(position, quaternion, scale);
  const forward = source.forward.clone().normalize();
  const right = new T.Vector3().crossVectors(forward, new T.Vector3(0, 1, 0));
  // The magazine geometry is in Source units and the weapon's own transform
  // carries the unit scale, so the prop keeps it: the box the physics uses is
  // the original geometry bounds converted to world metres.
  const uniform = (scale.x + scale.y + scale.z) / 3;
  check([position.x, position.y, position.z, scale.x, scale.y, scale.z].every(Number.isFinite) && uniform > 0 &&
    Math.max(Math.abs(scale.x - uniform), Math.abs(scale.y - uniform), Math.abs(scale.z - uniform)) <= uniform * 1e-6,
    'Invalid detached original magazine transform');
  check(forward.lengthSq() > 1e-12, 'Invalid detached original magazine direction');
  const half = bounds.half.clone().multiplyScalar(uniform), center = bounds.center.clone().multiplyScalar(uniform);
  quaternion.normalize();
  // The original prop is pushed out of the magwell and falls: mostly down, a
  // short kick away from the weapon, and a little to the right.
  const velocity = forward.clone().multiplyScalar(.3 + next() * .3).addScaledVector(right, (next() - .5) * .7);
  velocity.y = .35 + next() * .4;
  return { center: position.clone().add(center.clone().applyQuaternion(quaternion)), quaternion,
    velocity, spin: new T.Vector3((next() - .5) * 7, (next() - .5) * 5, (next() - .5) * 8),
    half, centerOffset: center, scale: uniform, flatAxis: thinnestAxis(half),
    floorY: source.floorY, age: 0, life: SOURCE_MAGAZINE_DROP_LIFE, resting: false, settling: 0,
    settleFrom: quaternion.clone(), settleTo: quaternion.clone() };
}

export function stepSourceMagazineDropBody(body: SourceMagazineDropBody, dt: number): void {
  check(Number.isFinite(dt) && dt > 0, 'Invalid magazine drop interval');
  const step = Math.min(dt, STEP_CAP);
  body.age += step;
  if (body.resting) return;
  if (body.settling > 0) {
    body.settling = Math.min(1, body.settling + step / SETTLE_SECONDS);
    const ease = body.settling * body.settling * (3 - 2 * body.settling);
    body.quaternion.slerpQuaternions(body.settleFrom, body.settleTo, ease);
    // Keep the prop exactly in contact while it rolls onto its largest face, so
    // the transition can never push it through the level.
    body.center.y = body.floorY + sourceMagazineDropSupport(body.half, body.quaternion);
    if (body.settling >= 1) body.resting = true;
    return;
  }
  body.velocity.y -= SOURCE_MAGAZINE_DROP_GRAVITY * step;
  body.center.addScaledVector(body.velocity, step);
  const spin = body.spin.length();
  if (spin > 1e-6) body.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(body.spin.clone().divideScalar(spin), spin * step)).normalize();
  const low = body.center.y - sourceMagazineDropSupport(body.half, body.quaternion);
  if (low >= body.floorY) return;
  body.center.y += body.floorY - low;
  if (body.velocity.y < 0) body.velocity.y = -body.velocity.y * RESTITUTION;
  body.velocity.x *= 1 - CONTACT_FRICTION; body.velocity.z *= 1 - CONTACT_FRICTION;
  body.spin.multiplyScalar(1 - SPIN_DECAY);
  if (Math.abs(body.velocity.y) >= REST_SPEED || spin > 4) return;
  // Settle: the prop comes to rest on its largest face, the way VPhysics
  // resolves a dropped magazine, instead of freezing upright on one corner.
  flatOrientation(body, body.settleTo);
  body.settleFrom.copy(body.quaternion); body.settling = 1e-6;
  body.velocity.set(0, 0, 0); body.spin.set(0, 0, 0);
}

/** The original prop is a client-side VPhysics body: it rests on whatever the
 * map has under it, not on the level it was thrown from. Re-sample the surface
 * under the prop's own column, measured from just above its own lowest point so
 * a prop that has already sunk to the floor still finds the floor. A surface
 * above the prop is refused (that is a ceiling the prop is under) and a column
 * with no surface keeps the previous one, so a prop is never pushed or popped. */
export function sourceMagazineDropSurface(body: SourceMagazineDropBody,
  surfaceY: (x: number, z: number, fromY: number) => number | null): void {
  const above = sourceMagazineDropSupport(body.half, body.quaternion) + .05;
  const surface = surfaceY(body.center.x, body.center.z, body.center.y + above);
  if (surface !== null && Number.isFinite(surface) && surface <= body.center.y) body.floorY = surface;
}

/** The prop's world matrix for the original bind-pose geometry, including the
 * weapon's own unit scale so the unmodified original mesh renders at its
 * correct size outside the character root. */
export function sourceMagazineDropMatrix(body: SourceMagazineDropBody, out = new T.Matrix4()): T.Matrix4 {
  const origin = body.center.clone().addScaledVector(body.centerOffset.clone().applyQuaternion(body.quaternion), -1);
  return out.compose(origin, body.quaternion, new T.Vector3(body.scale, body.scale, body.scale));
}

type Slot = {
  mesh: T.Mesh;
  /** Owned clone of the original magazine material, so a prop keeps the
   * appearance it was dropped with even if the weapon's skin later changes. */
  material: T.Material;
  sourceMaterial: T.Material;
  /** Original weapon identity of the live prop, for the asset audit. */
  key: string;
  /** The original map surface the live prop re-samples under its own column. */
  surface: ((x: number, z: number, fromY: number) => number | null) | null;
  body: SourceMagazineDropBody | null;
};

/** Draws the live dropped prop with the ORIGINAL magazine geometry. The
 * geometry stays owned by the character asset owner (it outlives the prop and is
 * never disposed here); the material is cloned once per slot so a live prop can
 * never point at a material its weapon owner released. */
export class SourceMagazineDrops {
  private slots: Slot[] = [];
  private readonly matrix = new T.Matrix4();
  disposed = false;
  constructor(private readonly scene: T.Scene, private readonly budget = SOURCE_MAGAZINE_DROP_BUDGET) {
    check(Number.isSafeInteger(budget) && budget > 0, 'Invalid original magazine drop budget');
  }
  get active(): number { return this.slots.filter(slot => slot.body).length; }
  /** A free slot, then a new slot up to the budget, then the oldest prop. */
  private claim(source: SourceMagazineDropSource): Slot {
    let slot = this.slots.find(candidate => !candidate.body);
    if (!slot && this.slots.length < this.budget) {
      const mesh = new T.Mesh(source.geometry, source.material.clone());
      mesh.name = `SourceMagazineDrop_${this.slots.length}`; mesh.matrixAutoUpdate = false; mesh.visible = false;
      mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = true;
      slot = { mesh, material: mesh.material as T.Material, sourceMaterial: source.material, key: source.key,
        surface: null, body: null };
      this.slots.push(slot);
    }
    if (!slot) {
      slot = this.slots[0];
      for (const candidate of this.slots) if (candidate.body!.age > slot.body!.age) slot = candidate;
    }
    slot.key = source.key;
    if (slot.sourceMaterial !== source.material) {
      // The weapon's own material was replaced (skin change or asset reload);
      // the slot's clone is stale, so release it and clone the current one.
      slot.material.dispose(); slot.sourceMaterial = source.material;
      slot.material = source.material.clone(); slot.mesh.material = slot.material;
    }
    if (slot.mesh.geometry !== source.geometry) slot.mesh.geometry = source.geometry;
    slot.surface = source.surfaceY ?? null;
    return slot;
  }
  spawn(source: SourceMagazineDropSource): void {
    if (this.disposed) return;
    const slot = this.claim(source);
    slot.body = spawnSourceMagazineDropBody(source, sourceMagazineDropBounds(source.geometry));
    if (!slot.mesh.parent) this.scene.add(slot.mesh);
    slot.mesh.matrix.copy(sourceMagazineDropMatrix(slot.body, this.matrix));
    slot.mesh.visible = true; slot.mesh.updateMatrixWorld(true);
  }
  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    for (const slot of this.slots) {
      if (!slot.body) continue;
      // The map under the prop, not the map under the shooter it came from.
      if (slot.surface && !slot.body.resting) sourceMagazineDropSurface(slot.body, slot.surface);
      stepSourceMagazineDropBody(slot.body, dt);
      if (slot.body.age >= slot.body.life) {
        // The original removes the prop a while after it lands; it does not fade.
        slot.body = null; slot.mesh.visible = false; slot.mesh.removeFromParent(); continue;
      }
      slot.mesh.matrix.copy(sourceMagazineDropMatrix(slot.body, this.matrix)); slot.mesh.matrixWorldNeedsUpdate = true;
    }
  }
  clear(): void {
    for (const slot of this.slots) { slot.body = null; slot.mesh.visible = false; slot.mesh.removeFromParent(); }
  }
  /** Counts only; the original geometry belongs to the character asset owner. */
  audit() {
    return this.slots.filter(slot => slot.body).map(slot => ({ name: slot.mesh.name, key: slot.key,
      vertices: slot.mesh.geometry.getAttribute('position').count,
      age: slot.body!.age, position: slot.body!.center.toArray(), resting: slot.body!.resting, visible: slot.mesh.visible }));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) {
      slot.mesh.removeFromParent(); slot.mesh.visible = false; slot.body = null;
      // Only the owned material clone is released; geometry stays with its owner.
      slot.material.dispose();
    }
    this.slots = [];
  }
}
