import { beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { attachSourceMapCollision, sourceMapQueryGroups, SOURCE_SENSOR_QUERY_GROUPS,
  type SourceCollisionInstance, type SourceMapCollisionData } from '../game/source-map-collision';

beforeAll(() => RAPIER.init());
const instance = (roles: SourceCollisionInstance['roles'], x = 0): SourceCollisionInstance => ({
  geometry: 0, translation: [x, 0, 0], rotation: [0, 0, 0, 1], scale: 1, roles, source: { fixture: true },
});
function data(): SourceMapCollisionData {
  return { format: 'source-map-collision-v1', sourceMap: 'test', sourceBspSha256: '', metersPerSourceUnit: .0254,
    geometries: [{ id: 0, kind: 'convex', vertices: [0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2], source: {} }],
    colliders: [instance(['player', 'bullet'])], sensors: [instance([], 10)], missingPHY: [], limits: [] };
}
it('preserves a sloped original convex face under rotation and scale, without its bounding box', () => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 }), source = data();
  source.colliders[0] = { ...source.colliders[0], translation: [7, 3, 5], scale: 2,
    rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };
  const map = attachSourceMapCollision(world, source);
  world.step();
  // Local point (1,*,.5) hits y=.5, then uniform scale2 + translation.
  const ray = new RAPIER.Ray({ x: 8, y: 10, z: 3 }, { x: 0, y: -1, z: 0 });
  const hit = world.castRayAndGetNormal(ray, 20, false, undefined, sourceMapQueryGroups('player'));
  expect(hit?.timeOfImpact).toBeCloseTo(6, 5);
  expect(hit?.normal.y).toBeCloseTo(1 / Math.sqrt(3), 5);
  // This point is inside the AABB, outside the actual tetrahedron.
  expect(world.castRay(new RAPIER.Ray({ x: 10, y: 10, z: 2 }, { x: 0, y: -1, z: 0 }), 20,
    false, undefined, sourceMapQueryGroups('player'))).toBeNull();
  map.dispose(); world.free();
});
it('keeps sensors queryable and role selection separate from solid actors, and disposes only its own data', () => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const sentinel = world.createCollider(RAPIER.ColliderDesc.ball(.1).setTranslation(100, 100, 100));
  const map = attachSourceMapCollision(world, data(), { roles: ['player'] }); world.step();
  const solidRay = new RAPIER.Ray({ x: .2, y: .2, z: .2 }, { x: 1, y: 0, z: 0 });
  expect(world.castRay(solidRay, 2, true, undefined, sourceMapQueryGroups('player'))).not.toBeNull();
  expect(world.castRay(solidRay, 2, true, undefined, sourceMapQueryGroups('bullet'))).toBeNull();
  const sensorRay = new RAPIER.Ray({ x: 10.2, y: .2, z: .2 }, { x: 1, y: 0, z: 0 });
  expect(world.castRay(sensorRay, 2, true, undefined, SOURCE_SENSOR_QUERY_GROUPS)).not.toBeNull();
  expect(world.castRay(sensorRay, 2, true, undefined, sourceMapQueryGroups('player'))).toBeNull();
  map.dispose(); map.dispose();
  expect(world.colliders.len()).toBe(1); expect(world.getCollider(sentinel.handle)).toBe(sentinel);
  world.removeCollider(sentinel, false); world.free();
});
it('rolls back a partially constructed map when a later original shape is absent', () => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const sentinel = world.createCollider(RAPIER.ColliderDesc.ball(.1));
  const source = data(); source.colliders.push({ ...instance(['player'], 5), geometry: 99 });
  expect(() => attachSourceMapCollision(world, source)).toThrow('Missing original geometry 99');
  expect(world.colliders.len()).toBe(1); expect(world.getCollider(sentinel.handle)).toBe(sentinel);
  world.removeCollider(sentinel, false); world.free();
});
it('rejects malformed injected missing-PHY metadata before adding colliders', () => {
  const world = new RAPIER.World({x:0,y:0,z:0});
  const broken = {...data(),missingPHY:null} as unknown as SourceMapCollisionData;
  expect(() => attachSourceMapCollision(world,broken)).toThrow();
  const remaining = world.colliders.len(); world.free();
  expect(remaining).toBe(0);
});
