import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { SOURCE_MAGAZINE_DROP_BUDGET, SOURCE_MAGAZINE_DROP_GRAVITY, SOURCE_MAGAZINE_DROP_LIFE,
  SourceMagazineDrops, sourceMagazineDropBounds, sourceMagazineDropFromMesh, sourceMagazineDropMatrix,
  sourceMagazineDropSupport, sourceMagazineDropSurface, sourceMagazineMeshTransform, spawnSourceMagazineDropBody,
  stepSourceMagazineDropBody,
  type SourceMagazineDropSource } from '../game/source-magazine-drop';

/** A skinned prop whose vertices bind to the supplied influences (at most four,
 * normalized by the caller), so the single-rigid-joint rule can be exercised
 * without an original asset. */
function skinned(joints: readonly (readonly [number, number])[]): T.SkinnedMesh {
  const geometry = new T.BoxGeometry(.06, .18, .1);
  const count = geometry.getAttribute('position').count;
  const skinIndex = new Uint16Array(count * 4), skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) for (let c = 0; c < 4; c++) {
    const pair = joints[c]; if (!pair) continue;
    skinIndex[i * 4 + c] = pair[0]; skinWeight[i * 4 + c] = pair[1];
  }
  geometry.setAttribute('skinIndex', new T.BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new T.BufferAttribute(skinWeight, 4));
  const bone = new T.Bone(); bone.name = 'weapon_mag';
  const mesh = new T.SkinnedMesh(geometry, new T.MeshStandardMaterial());
  mesh.add(bone); mesh.bind(new T.Skeleton([bone]), new T.Matrix4());
  return mesh;
}
const STEP = 1 / 60;
function source(overrides: Partial<SourceMagazineDropSource> = {}): SourceMagazineDropSource {
  const mesh = skinned([[0, 1]]);
  return { key: 'ak47', geometry: mesh.geometry, material: mesh.material as T.Material,
    matrix: new T.Matrix4().makeTranslation(3, 1.2, -7), floorY: 0, forward: new T.Vector3(0, 0, 1), seed: 7, ...overrides };
}

describe('the original prop samples the map under itself', () => {
  it('takes the surface under the prop, refuses a ceiling, and keeps the spawn level over a void', () => {
    const body = spawnSourceMagazineDropBody(source({ floorY: 0 }), sourceMagazineDropBounds(source().geometry));
    const probes: { x: number; z: number; fromY: number }[] = [];
    // A column with no exported surface must not move the prop at all.
    sourceMagazineDropSurface(body, (x, z, fromY) => { probes.push({ x, z, fromY }); return null; });
    expect(body.floorY).toBe(0);
    // The probe starts above the prop's own lowest point, so a prop that has
    // already sunk to the floor still finds that floor.
    expect(probes[0].fromY).toBeGreaterThan(body.center.y);
    expect(probes[0].x).toBeCloseTo(body.center.x, 9); expect(probes[0].z).toBeCloseTo(body.center.z, 9);
    // A trench under the prop's own column becomes its floor.
    sourceMagazineDropSurface(body, () => -6);
    expect(body.floorY).toBe(-6);
    // A solid above the prop is a ceiling, not a floor.
    sourceMagazineDropSurface(body, () => body.center.y + 1);
    expect(body.floorY).toBe(-6);
  });
  it('lets a live prop land on the surface it actually fell over', () => {
    const scene = new T.Scene(), pool = new SourceMagazineDrops(scene);
    // Thrown from a ledge six metres above the original floor beneath it.
    pool.spawn(source({ matrix: new T.Matrix4().makeTranslation(0, 2, 0), floorY: 0, surfaceY: () => -6 }));
    for (let i = 0; i < 600; i++) pool.update(STEP);
    expect(pool.active).toBe(1);
    const resting = pool.audit()[0].position[1];
    expect(resting).toBeGreaterThan(-6);
    expect(resting - -6).toBeLessThan(.25);
  });
});

describe('original magazine prop geometry', () => {
  it('measures the original bind-pose bounds of the magazine shape', () => {
    const { half, center } = sourceMagazineDropBounds(source().geometry);
    // BoxGeometry stores float32 positions.
    expect(half.x).toBeCloseTo(.03, 6); expect(half.y).toBeCloseTo(.09, 6); expect(half.z).toBeCloseTo(.05, 6);
    expect(center.toArray()).toEqual([0, 0, 0]);
  });
  it('detaches a magazine bound rigidly to exactly one joint', () => {
    const mesh = skinned([[0, 1]]);
    mesh.position.set(1, 2, 3); mesh.updateMatrixWorld(true);
    const bone = mesh.skeleton.bones[0];
    bone.position.set(.2, 0, -.1); bone.quaternion.setFromAxisAngle(new T.Vector3(1, 0, 0), .6);
    mesh.updateMatrixWorld(true);
    const matrix = sourceMagazineMeshTransform(mesh);
    expect(matrix).not.toBeNull();
    // Cross-checked against three.js's own skinning path rather than the
    // derivation it is meant to collapse, so this is an independent result.
    const positions = mesh.geometry.getAttribute('position');
    for (const vertex of [0, 11, positions.count - 1]) {
      const expected = new T.Vector3().fromBufferAttribute(positions, vertex);
      mesh.applyBoneTransform(vertex, expected).applyMatrix4(mesh.matrixWorld);
      const actual = new T.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(matrix!);
      expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
    }
  });
  it('refuses to detach a prop that is not bound to a single joint', () => {
    expect(sourceMagazineMeshTransform(skinned([[0, 1], [1, 1]]))).toBeNull();
    expect(sourceMagazineMeshTransform(skinned([[0, .99], [1, .01]]))).toBeNull();
  });
  it('derives the throw direction from the weapon offset and rejects an array material', () => {
    const mesh = skinned([[0, 1]]);
    mesh.position.set(0, 0, 4); mesh.updateMatrixWorld(true);
    const root = new T.Group(); root.updateMatrixWorld(true);
    const drop = sourceMagazineDropFromMesh({ key: 'ak47', mesh, root, origin: { x: 0, y: 0, z: 3 }, floorY: 0, seed: 0 })!;
    expect(drop.forward.toArray()).toEqual([0, 0, 1]);
    expect(drop.floorY).toBe(0);
    const arrayed = skinned([[0, 1]]); arrayed.material = [new T.MeshStandardMaterial()];
    expect(sourceMagazineDropFromMesh({ key: 'ak47', mesh: arrayed, root, origin: { x: 0, y: 0, z: 3 }, floorY: 0, seed: 0 })).toBeNull();
  });
});

describe('original magazine prop flight', () => {
  it('falls at the original Source gravity and never sinks through the ground', () => {
    const body = spawnSourceMagazineDropBody(source(), sourceMagazineDropBounds(source().geometry));
    expect(body.center.y).toBeCloseTo(1.2, 12);
    let lowest = Infinity;
    for (let i = 0; i < Math.ceil(4 / STEP); i++) {
      stepSourceMagazineDropBody(body, STEP);
      lowest = Math.min(lowest, body.center.y - sourceMagazineDropSupport(body.half, body.quaternion));
    }
    expect(lowest).toBeGreaterThan(body.floorY - 1e-9);
    expect(body.resting).toBe(true);
    // Source sv_gravity 800 at 1 unit = 1 inch.
    expect(SOURCE_MAGAZINE_DROP_GRAVITY).toBeCloseTo(20.32, 12);
  });
  it('settles flat on its largest face instead of freezing on a corner', () => {
    const body = spawnSourceMagazineDropBody(source(), sourceMagazineDropBounds(source().geometry));
    for (let i = 0; i < Math.ceil(4 / STEP); i++) stepSourceMagazineDropBody(body, STEP);
    const axis = new T.Vector3(1, 0, 0).applyQuaternion(body.quaternion);
    expect(Math.abs(axis.y)).toBeCloseTo(1, 6);
    expect(body.center.y).toBeCloseTo(body.floorY + body.half.getComponent(body.flatAxis), 6);
    expect(body.velocity.length()).toBe(0);
  });
  it('is deterministic: the same original event yields the same prop everywhere', () => {
    const first = spawnSourceMagazineDropBody(source(), sourceMagazineDropBounds(source().geometry));
    const second = spawnSourceMagazineDropBody(source(), sourceMagazineDropBounds(source().geometry));
    for (let i = 0; i < 120; i++) { stepSourceMagazineDropBody(first, STEP); stepSourceMagazineDropBody(second, STEP); }
    expect(first.center.toArray()).toEqual(second.center.toArray());
    expect(first.quaternion.toArray()).toEqual(second.quaternion.toArray());
    expect(first.resting).toBe(second.resting);
  });
  it('places the prop back on the original bind-pose geometry at the simulated transform', () => {
    const drop = source(), body = spawnSourceMagazineDropBody(drop, sourceMagazineDropBounds(drop.geometry));
    stepSourceMagazineDropBody(body, STEP);
    const matrix = sourceMagazineDropMatrix(body);
    const origin = new T.Vector3().setFromMatrixPosition(matrix);
    const expected = body.center.clone().addScaledVector(body.centerOffset.clone().applyQuaternion(body.quaternion), -1);
    expect(origin.distanceTo(expected)).toBeLessThan(1e-12);
  });
});

describe('original magazine prop pool', () => {
  const scene = () => new T.Scene();
  it('draws at most the fixed budget and recycles the oldest prop', () => {
    const pool = new SourceMagazineDrops(scene(), 2), drop = source();
    expect(SOURCE_MAGAZINE_DROP_BUDGET).toBe(8);
    for (let i = 0; i < 5; i++) pool.spawn({ ...drop, seed: i });
    expect(pool.active).toBe(2);
    expect(pool.audit().length).toBe(2);
    // The audit names the original weapon each live prop came from.
    expect(pool.audit().map(row => row.key)).toEqual(['ak47', 'ak47']);
    expect(pool.audit().map(row => row.vertices)).toEqual([24, 24]);
    expect(new Set(pool.audit().map(row => row.name)).size).toBe(2);
  });
  it('clones the original material per slot and releases only its own clones', () => {
    const pool = new SourceMagazineDrops(scene(), 1), drop = source();
    let originalReleased = 0; drop.material.addEventListener('dispose', () => originalReleased++);
    pool.spawn(drop);
    const slots = (pool as unknown as { slots: { material: T.Material }[] }).slots;
    const first = slots[0].material;
    expect(first).not.toBe(drop.material);
    let firstReleased = 0; first.addEventListener('dispose', () => firstReleased++);
    // A later skin change replaces the weapon material; the slot releases its
    // stale clone and takes a fresh one, and the weapon's own material is safe.
    const replacement = new T.MeshStandardMaterial();
    pool.spawn({ ...drop, material: replacement });
    expect(firstReleased).toBe(1); expect(originalReleased).toBe(0);
    const second = slots[0].material;
    expect(second).not.toBe(replacement);
    let secondReleased = 0; second.addEventListener('dispose', () => secondReleased++);
    pool.dispose();
    expect(secondReleased).toBe(1); expect(originalReleased).toBe(0);
    // The original geometry belongs to its owner and is never disposed here.
    expect(drop.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });
  it('removes the prop after the original prop lifetime and clears a departing match', () => {
    const pool = new SourceMagazineDrops(scene(), 2), drop = source();
    pool.spawn(drop);
    const mesh = (pool as unknown as { slots: { mesh: T.Mesh }[] }).slots[0].mesh;
    expect(mesh.parent).not.toBeNull(); expect(mesh.visible).toBe(true);
    for (let i = 0; i < Math.ceil(SOURCE_MAGAZINE_DROP_LIFE / STEP) + 2; i++) pool.update(STEP);
    expect(pool.active).toBe(0); expect(mesh.parent).toBeNull(); expect(mesh.visible).toBe(false);
    pool.spawn(drop); pool.spawn({ ...drop, seed: 1 });
    expect(pool.active).toBe(2);
    pool.clear();
    expect(pool.active).toBe(0);
    expect(() => { pool.dispose(); pool.dispose(); pool.spawn(drop); pool.update(STEP); }).not.toThrow();
    expect(pool.active).toBe(0);
  });
  it('keeps a live prop inside a valid level surface for the whole flight', () => {
    const pool = new SourceMagazineDrops(scene(), 1), drop = { ...source(), floorY: 1 };
    pool.spawn(drop);
    const body = (pool as unknown as { slots: { body: { center: T.Vector3; half: T.Vector3; quaternion: T.Quaternion } }[] }).slots[0].body;
    for (let i = 0; i < Math.ceil(3 / STEP); i++) {
      pool.update(STEP);
      expect(body.center.y - sourceMagazineDropSupport(body.half, body.quaternion)).toBeGreaterThan(1 - 1e-9);
      expect(Number.isFinite(body.center.x + body.center.y + body.center.z)).toBe(true);
    }
  });
});
