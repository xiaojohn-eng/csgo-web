import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { attachSourceMapCollision, sourceMapQueryGroups, SOURCE_SENSOR_QUERY_GROUPS, type SourceMapCollisionData } from '../game/source-map-collision.js';

const root = process.cwd();
const folder = path.join(root, '.reference-assets/source-exports/dust2');
const data = JSON.parse(fs.readFileSync(path.join(folder, 'collision/collision.json'), 'utf8')) as SourceMapCollisionData;
const metadata = JSON.parse(fs.readFileSync(path.join(folder, 'map-metadata.json'), 'utf8')) as {
  spawns: { classname: string; hammerid: string; browserMetresPosition: [number, number, number] }[];
};
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -22, z: 0 });
const sentinel = world.createCollider(RAPIER.ColliderDesc.ball(.1).setTranslation(10000, 10000, 10000));
const started = performance.now();
const map = attachSourceMapCollision(world, data);
world.step();
const constructionMs = performance.now() - started;
const groups = sourceMapQueryGroups('player');
const identity = { x: 0, y: 0, z: 0, w: 1 };
const capsule = new RAPIER.Capsule(.63, .3);
const down = { x: 0, y: -1, z: 0 };
const spawns = metadata.spawns.map(spawn => {
  const [x, y, z] = spawn.browserMetresPosition;
  const ground = world.castRayAndGetNormal(new RAPIER.Ray({ x, y: y + .1, z }, down), 5, false,
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups);
  // A ray only finds the surface below one point. A real capsule can land on an
  // adjacent authored stair/playerclip edge; settle its full volume separately.
  const landing = world.castShape({ x, y: y + .1 + .93, z }, identity, down, capsule, .02, 5, true,
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups);
  const intersections: unknown[] = [];
  if (landing) {
    const center = { x, y: y + .1 + .93 - landing.time_of_impact, z };
    world.intersectionsWithShape(center, identity, capsule, collider => {
      intersections.push(map.metadata.get(collider.handle)); return true;
    }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups);
  }
  return { ...spawn, landing: landing && { distance: landing.time_of_impact,
    center: { x, y: y + .1 + .93 - landing.time_of_impact, z }, source: map.metadata.get(landing.collider.handle)?.source },
    ground: ground && { distance: ground.timeOfImpact, normal: ground.normal,
    point: { x, y: y + .1 - ground.timeOfImpact, z }, source: map.metadata.get(ground.collider.handle)?.source }, intersections };
});
assert.equal(spawns.length, 30);
assert(spawns.every(spawn => spawn.ground && spawn.ground.normal.y > .9 && spawn.landing &&
  spawn.landing.distance > 0 && !spawn.intersections.length), 'All thirty source spawns have ground and clear capsule landings');
const walls = [spawns[0], spawns[15]].flatMap(spawn => Array.from({ length: 8 }, (_, index) => {
  const center = spawn.landing!.center, origin = { ...center, y: center.y + .65 };
  const direction = { x: Math.cos(index * Math.PI / 4), y: 0, z: Math.sin(index * Math.PI / 4) };
  const ray = world.castRayAndGetNormal(new RAPIER.Ray(origin, direction), 50, false,
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, sourceMapQueryGroups('bullet'));
  const sweep = world.castShape(origin, identity, direction, new RAPIER.Ball(.12), 0, 50, true,
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, sourceMapQueryGroups('projectile'));
  return { spawn: spawn.hammerid, direction, ray: ray && { distance: ray.timeOfImpact, normal: ray.normal,
    source: map.metadata.get(ray.collider.handle)?.source }, sweep: sweep && { distance: sweep.time_of_impact,
    source: map.metadata.get(sweep.collider.handle)?.source } };
}));
assert(walls.filter(item => item.ray && Math.abs(item.ray.normal.y) < .5 && item.sweep).length >= 8,
  'Actual walls stop both bullet rays and finite projectile sweeps around both spawn regions');
// Verify role selection on actual source colliders, isolating each original
// shape with a query predicate so neighbouring solids cannot hide a bad mask.
const roleChecks = [
  { label: 'playerclip', find: (source: Record<string, unknown>) => source.layer === 'brush' && ((source.contents as number) & 0x10000) !== 0,
    expected: { player: true, bullet: false, projectile: false } },
  { label: 'grate', find: (source: Record<string, unknown>) => source.layer === 'brush' && ((source.contents as number) & 8) !== 0,
    expected: { player: true, bullet: false, projectile: false } },
  { label: 'grate VPHY', find: (source: Record<string, unknown>) => source.layer === 'worldVphy' && source.contents === 8,
    expected: { player: false, bullet: false, projectile: true } },
].map(item => {
  const collider = map.colliders.find(collider => item.find(map.metadata.get(collider.handle)!.source));
  assert(collider, item.label);
  const origin = collider.translation();
  const hits = Object.fromEntries((['player', 'bullet', 'projectile'] as const).map(role => [role,
    !!world.castRay(new RAPIER.Ray(origin, { x: 1, y: 0, z: 0 }), 100, true, undefined,
      sourceMapQueryGroups(role), undefined, undefined, candidate => candidate.handle === collider.handle)]));
  assert.deepEqual(hits, item.expected, item.label);
  return { label: item.label, source: map.metadata.get(collider.handle)?.source, hits };
});
const sensors = map.colliders.filter(collider => collider.isSensor()).map(collider => {
  const ray = new RAPIER.Ray(collider.translation(), { x: 1, y: 0, z: 0 });
  const isolated = (candidate: RAPIER.Collider) => candidate.handle === collider.handle;
  assert(world.castRay(ray, 100, true, undefined, SOURCE_SENSOR_QUERY_GROUPS, undefined, undefined, isolated));
  for (const role of ['player', 'bullet', 'projectile'] as const)
    assert.equal(world.castRay(ray, 100, true, undefined, sourceMapQueryGroups(role), undefined, undefined, isolated), null);
  return map.metadata.get(collider.handle)?.source;
});
const sourcePoint = (x: number, y: number, z: number) => ({ x: x * .0254, y: z * .0254, z: -y * .0254 });
const groundLine = (label: string, a: number[], b: number[], count = 17) => ({ label,
  samples: Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1), source = a.map((v, axis) => v + (b[axis] - v) * t);
    const origin = sourcePoint(source[0], source[1], source[2]);
    const hit = world.castRayAndGetNormal(new RAPIER.Ray(origin, down), 10, false,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups);
    return { source, height: hit ? origin.y - hit.timeOfImpact : null, normal: hit?.normal,
      surface: hit ? map.metadata.get(hit.collider.handle)?.source : null };
  }) });
const lanes = [
  groundLine('CT stairs / original prop 1216', [256, 2200, -50], [256, 2440, -50]),
  groundLine('middle', [-400, 900, 128], [-400, 1800, 128]),
  groundLine('long approach', [1400, 1000, 240], [1400, 2200, 240]),
  groundLine('B site', [-1600, 2520, 150], [-1440, 2820, 150]),
  groundLine('A site', [1000, 2360, 250], [1200, 2580, 250]),
];
assert(lanes.every(lane => lane.samples.every(sample => sample.height !== null && sample.normal!.y > .5)),
  'All 85 fixed route ground rays hit an upward original surface');
function walk(label: string, start: [number, number, number], end: [number, number, number], stepHeight = .28) {
  const feet = sourcePoint(...start), target = sourcePoint(...end);
  const landing = world.castShape({ ...feet, y: feet.y + .93 }, identity, down, capsule, .02, 5, true,
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups);
  assert(landing && landing.time_of_impact > 0, `${label} starts above a clear full capsule support`);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(feet.x, feet.y + .93 - landing.time_of_impact, feet.z));
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(.63, .3).setCollisionGroups(groups), body);
  const controller = world.createCharacterController(.015);
  controller.enableAutostep(stepHeight, .2, true); controller.enableSnapToGround(.18);
  controller.setMaxSlopeClimbAngle(Math.PI / 4); controller.setMinSlopeSlideAngle(Math.PI / 4);
  world.step();
  const samples: unknown[] = []; let vy = 0, steps = 0, blocked = 0, maxBlockedRun = 0;
  const started = performance.now();
  for (; steps < 1200; steps++) {
    const before = body.translation(), dx = target.x - before.x, dz = target.z - before.z, distance = Math.hypot(dx, dz);
    if (distance < .08) break;
    const length = Math.min(2.8 / 60, distance); vy -= 22 / 60;
    controller.computeColliderMovement(collider, { x: dx / distance * length, y: vy / 60, z: dz / distance * length },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups);
    const movement = controller.computedMovement();
    if (controller.computedGrounded()) vy = 0;
    const actual = Math.hypot(movement.x, movement.z);
    blocked = actual < .001 ? blocked + 1 : 0; maxBlockedRun = Math.max(blocked, maxBlockedRun);
    const next = { x: before.x + movement.x, y: before.y + movement.y, z: before.z + movement.z };
    body.setNextKinematicTranslation(next); world.step();
    if (steps % 30 === 0 || blocked === 60) samples.push({ tick: steps, center: next, grounded: controller.computedGrounded(),
      collisions: Array.from({ length: controller.numComputedCollisions() }, (_, i) => {
        const collision = controller.computedCollision(i); return collision?.collider && map.metadata.get(collision.collider.handle)?.source;
      }) });
    if (blocked === 60) break;
  }
  const final = body.translation(), remaining = Math.hypot(final.x - target.x, final.z - target.z);
  world.removeCharacterController(controller); world.removeRigidBody(body); world.step();
  return { label, start, end, stepHeight, steps, remaining, maxBlockedRun, final, samples,
    cpuMs: performance.now() - started, reached: remaining < .08 };
}
const walks = [
  walk('middle to doors', [-400, 900, 16], [-400, 1800, 16]),
  walk('long approach', [1400, 1000, 40], [1400, 2200, 40]),
  walk('B site interior', [-1560, 2560, 40], [-1440, 2820, 40]),
  walk('A site interior', [1110, 2510, 102], [1200, 2580, 102]),
  walk('CT authored stair line current controller', [256, 2200, -50], [256, 2440, -50]),
  walk('CT authored stair line 18 source-unit step', [256, 2200, -50], [256, 2440, -50], 18 * .0254),
];
assert(walks.slice(0, 4).every(walk => walk.reached), 'Four actual approach/site capsule routes remain traversable');
assert(!walks[4].reached && walks[4].maxBlockedRun === 60, 'Keep the current .28 m integration limitation visible');
assert(walks[5].reached, 'The same unmodified Source stair collision is traversable with a .4572 m step setting');
map.dispose();
map.dispose();
assert.equal(world.colliders.len(), 1, 'Only the caller-owned sentinel remains after idempotent dispose');
assert(world.getCollider(sentinel.handle));
world.removeCollider(sentinel, false);
world.free();
const result = { dataBytes: fs.statSync(path.join(folder, 'collision/collision.json')).size,
  constructionMs, stats: map.stats, spawns, walls, roleChecks, sensors, lanes, walks, freedWithoutWasmBorrowError: true };
fs.mkdirSync(path.join(root, 'output/tests'), { recursive: true });
fs.writeFileSync(path.join(root, 'output/tests/source-map-collision.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ constructionMs, stats: map.stats, spawnCount: spawns.length,
  grounds: spawns.filter(spawn => spawn.ground).length, clear: spawns.filter(spawn => !spawn.intersections.length).length,
  groundSamples: lanes.reduce((n, lane) => n + lane.samples.length, 0),
  walks: walks.map(({ label, reached, remaining, steps }) => ({ label, reached, remaining, steps })),
  freedWithoutWasmBorrowError: true }, null, 2));
