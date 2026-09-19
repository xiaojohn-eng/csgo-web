import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-compat';
import { attachSourceMapCollision, sourceMapQueryGroups, type SourceMapCollisionData } from '../game/source-map-collision.js';

const folder = '.reference-assets/source-exports/dust2';
const collisionBytes = fs.readFileSync(`${folder}/collision/collision.json`);
const data = JSON.parse(collisionBytes.toString()) as SourceMapCollisionData;
const parameters = JSON.parse(fs.readFileSync('output/tests/source-player-parameters.json', 'utf8')) as {
  sha256: string; vectorsSourceUnits: Record<string, [number, number, number]>;
  convars: Record<string, { default: string }>;
};
const metadata = JSON.parse(fs.readFileSync(`${folder}/map-metadata.json`, 'utf8')) as {
  spawns: { hammerid: string; browserMetresPosition: [number, number, number] }[];
};
const scale = data.metersPerSourceUnit, groups = sourceMapQueryGroups('player');
const gravity = Number(parameters.convars.sv_gravity.default) * scale;
const stepHeight = Number(parameters.convars.sv_stepsize.default) * scale;
const normal = Number(parameters.convars.sv_standable_normal.default);
const identity = { x: 0, y: 0, z: 0, w: 1 }, down = { x: 0, y: -1, z: 0 };
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -gravity, z: 0 });
const map = attachSourceMapCollision(world, data, { roles: ['player'], sensors: false });
world.step();
const sourcePoint = (p: readonly number[]) => ({ x: p[0] * scale, y: p[2] * scale, z: -p[1] * scale });
const routes = [
  { label: 'middle to doors', start: [-400, 900, 16], end: [-400, 1800, 16] },
  { label: 'long approach', start: [1400, 1000, 40], end: [1400, 2200, 40] },
  { label: 'B site interior', start: [-1560, 2560, 40], end: [-1440, 2820, 40] },
  { label: 'A site interior', start: [1110, 2510, 102], end: [1200, 2580, 102] },
  { label: 'CT authored stair line', start: [256, 2200, -50], end: [256, 2440, -50] },
  { label: 'B site inset endpoint (original endpoint retained above)', start: [-1560, 2560, 40], end: [-1456, 2804, 40] },
];
const states = (['standing', 'crouching'] as const).map(stance => {
  const min = parameters.vectorsSourceUnits[stance === 'standing' ? 'hullMin' : 'duckHullMin'];
  const max = parameters.vectorsSourceUnits[stance === 'standing' ? 'hullMax' : 'duckHullMax'];
  const eyeHeight = parameters.vectorsSourceUnits[stance === 'standing' ? 'view' : 'duckView'][2] * scale;
  assert.deepEqual(min, [-16, -16, 0]);
  const half = { x: (max[0] - min[0]) * scale / 2, y: (max[2] - min[2]) * scale / 2, z: (max[1] - min[1]) * scale / 2 };
  const shape = new RAPIER.Cuboid(half.x, half.y, half.z);
  function settle(feet: { x: number; y: number; z: number }) {
    const origin = { ...feet, y: feet.y + half.y };
    const landing = world.castShape(origin, identity, down, shape, .02, 5, true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups);
    assert(landing && landing.time_of_impact > 0, 'Original hull starts clear above support');
    return { center: { ...origin, y: origin.y - landing.time_of_impact }, source: map.metadata.get(landing.collider.handle)?.source };
  }
  const spawns = metadata.spawns.map(spawn => {
    const [x, y, z] = spawn.browserMetresPosition, landing = settle({ x, y: y + .1, z });
    const intersections: unknown[] = [];
    world.intersectionsWithShape(landing.center, identity, shape, collider => {
      intersections.push(map.metadata.get(collider.handle)?.source); return true;
    }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups);
    assert.equal(intersections.length, 0);
    return { hammerid: spawn.hammerid, landing, eye: { ...landing.center, y: landing.center.y - half.y + eyeHeight }, intersections };
  });
  const walks = routes.map(route => {
    const landing = settle(sourcePoint(route.start)), target = sourcePoint(route.end);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(landing.center.x, landing.center.y, landing.center.z));
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setCollisionGroups(groups), body);
    const controller = world.createCharacterController(.015);
    controller.enableAutostep(stepHeight, .2, true); controller.enableSnapToGround(.18);
    controller.setMaxSlopeClimbAngle(Math.acos(normal)); controller.setMinSlopeSlideAngle(Math.acos(normal));
    world.step(); let vy = 0, steps = 0, blocked = 0, maxBlockedRun = 0;
    const samples: unknown[] = [], started = performance.now();
    for (; steps < 1200; steps++) {
      const before = body.translation(), dx = target.x - before.x, dz = target.z - before.z, distance = Math.hypot(dx, dz);
      if (distance < .08) break;
      // Keep the previous capsule comparison's speed. This is a collision/KCC
      // experiment, not a substitute for Source acceleration or weapon speed.
      const length = Math.min(2.8 / 60, distance); vy -= gravity / 60;
      controller.computeColliderMovement(collider, { x: dx / distance * length, y: vy / 60, z: dz / distance * length },
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups);
      const movement = controller.computedMovement(); if (controller.computedGrounded()) vy = 0;
      blocked = Math.hypot(movement.x, movement.z) < .001 ? blocked + 1 : 0; maxBlockedRun = Math.max(blocked, maxBlockedRun);
      const next = { x: before.x + movement.x, y: before.y + movement.y, z: before.z + movement.z };
      body.setNextKinematicTranslation(next); world.step();
      if (steps % 30 === 0 || blocked === 60) samples.push({ tick: steps, center: next, grounded: controller.computedGrounded(),
        collisions: Array.from({ length: controller.numComputedCollisions() }, (_, i) => {
          const hit = controller.computedCollision(i); return hit?.collider && map.metadata.get(hit.collider.handle)?.source;
        }) });
      if (blocked === 60) break;
    }
    const final = body.translation(), remaining = Math.hypot(final.x - target.x, final.z - target.z);
    const reached = remaining < .08;
    const endpointIntersections: unknown[] = [];
    world.intersectionsWithShape({ x: target.x, y: final.y, z: target.z }, identity, shape, candidate => {
      endpointIntersections.push(map.metadata.get(candidate.handle)?.source); return true;
    }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups, collider);
    world.removeCharacterController(controller); world.removeRigidBody(body); world.step();
    return { ...route, reached, remaining, steps, maxBlockedRun, final, samples, endpointIntersections,
      endpointProbeCenterY: final.y, cpuMs: performance.now() - started };
  });
  return { stance, sourceMin: min, sourceMax: max, halfExtentsMetres: half, eyeHeightMetres: eyeHeight, spawns, walks };
});
map.dispose(); assert.equal(world.colliders.len(), 0); world.free();
const result = { sourceServerSha256: parameters.sha256, sourceCollisionSha256: createHash('sha256').update(collisionBytes).digest('hex'),
  fixedDt: 1 / 60, matchedComparisonSpeed: 2.8, hullIsAxisAlignedNotYawRotated: true, gravityMetres: gravity,
  stepHeightMetres: stepHeight, standableNormalY: normal, states, freedWithoutWasmBorrowError: true,
  limitation: 'Original CS:GO hull dimensions and constructor defaults, exercised by Rapier sweeps/KCC. Not the original Source movement solver or full avatar pose.' };
fs.writeFileSync('output/tests/source-player-hull.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(states.map(state => ({ stance: state.stance, spawns: state.spawns.length,
  walks: state.walks.map(({ label, reached, remaining, steps }) => ({ label, reached, remaining, steps })) })), null, 2));
assert(states.every(state => state.spawns.length === 30 && state.walks.filter(walk => walk.label !== 'B site interior').every(walk => walk.reached)),
  'All source hull spawns and feasible approach/site routes pass');
assert(states.every(state => {
  const b = state.walks.find(walk => walk.label === 'B site interior')!;
  return !b.reached && b.maxBlockedRun === 60 && b.endpointIntersections.some(source =>
    (source as { layer?: string; brush?: number })?.layer === 'brush' && (source as { brush?: number }).brush === 846);
}), 'The original B endpoint intersects source PLAYERCLIP brush 846 for both wider Source hulls; preserve the capsule/AABB difference');
