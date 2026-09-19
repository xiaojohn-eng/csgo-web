import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { existsSync, readFileSync } from 'node:fs';
import { loadCharacterCpuFixture } from '../scripts/validate-source-character-actor';
import { createSourceLevel, type SourceLevelData } from '../game/source-level';
import type { SourceMapCollisionData } from '../game/source-map-collision';
import { bindSourceRagdoll, computeSourceRagdollRestFromDeath1, parseSourceRagdollData,
  spawnSourceRagdoll, stepSourceRagdoll, updateSourceRagdollGround,
  type SourceRagdollData, type SourceRagdollGround, type SourceRagdollIndex, type SourceRagdollLive,
  type SourceRagdollRest } from '../game/source-ragdoll';

/** Terrain under test, in the level's world frame (Y up, metres):
 *  - a solid floor whose top is y = 0 over x <= 10 (beyond that there is only void),
 *  - a solid step whose top is y = 2 over x in [0, 6],
 *  - a solid ceiling slab whose underside is y = 1.7 over x in [-16, -10],
 *  - a playerclip-only ceiling over x in [-8, -2] that must NOT hold a prop up. */
const CLIP = { y0: 1.45, y1: 1.55, x0: -8, x1: -2 };
const SLAB = { y0: 1.7, y1: 2, x0: -16, x1: -10 };
function terrain() {
  const bounds: SourceLevelData['worldBounds'] = { min: [-40, -20, -40], max: [40, 40, 40] };
  const box = (x: number, y: number, z: number) => [-x, -y, -z, -x, -y, z, -x, y, -z, -x, y, z,
    x, -y, -z, x, -y, z, x, y, -z, x, y, z];
  const data: SourceLevelData = { format: 'source-level-v1', id: 'terrain', name: 'terrain', sourceBspSha256: 'terrain',
    metersPerSourceUnit: .0254, worldBounds: bounds, boundsMeaning: 'terrain fixture',
    spawns: (['blue', 'amber'] as const).map((team, i) => ({ id: team, team, x: i, y: 1, z: 0, yaw: 0, pitch: 0,
      sourceClassname: 'terrain', sourceOrigin: [0, 0, 0], sourceAngles: [0, 0, 0] })),
    sites: [{ name: 'A', sourceModel: 1, hammerid: 'A', bounds }, { name: 'B', sourceModel: 2, hammerid: 'B', bounds }],
    siteBinding: 'terrain', navigation: null, navigationStatus: 'none', sourceNavSha256: 'nav-terrain',
    player: { standing: { halfExtents: [.4064, .9144, .4064], eyeHeight: 1.6256 },
      crouching: { halfExtents: [.4064, .6858, .4064], eyeHeight: 1.1684 }, gravity: 20.32, stepHeight: .4572,
      standableNormal: .7, sourceServerSha256: 'terrain', hullMeaning: 'AABB' } };
  const instance = (geometry: number, translation: [number, number, number], roles: ('player' | 'bullet' | 'projectile')[], source: Record<string, unknown> = {}) =>
    ({ geometry, translation, rotation: [0, 0, 0, 1] as [number, number, number, number], scale: 1, roles, source });
  const collision: SourceMapCollisionData = { format: 'source-map-collision-v1', sourceMap: 'terrain', sourceBspSha256: 'terrain',
    metersPerSourceUnit: .0254, missingPHY: [], limits: [], geometries: [
      { id: 0, kind: 'convex', vertices: box(20, .5, 30), source: {} },   // floor, top y = 0
      { id: 1, kind: 'convex', vertices: box(3, 1, 10), source: {} },     // step,  top y = 2
      { id: 2, kind: 'convex', vertices: box(3, .05, 3), source: {} },    // clip ceiling
      { id: 3, kind: 'convex', vertices: box(.5, .5, .5), source: {} },
      { id: 4, kind: 'convex', vertices: box(3, .15, 10), source: {} },   // solid slab
    ], colliders: [
      instance(0, [-10, -.5, 0], ['player', 'bullet', 'projectile']),
      instance(1, [3, 1, 0], ['player', 'bullet', 'projectile']),
      instance(2, [-5, (CLIP.y0 + CLIP.y1) / 2, 0], ['player']),
      instance(4, [-13, (SLAB.y0 + SLAB.y1) / 2, 0], ['player', 'bullet', 'projectile']),
    ], sensors: data.sites.map((site, i) => instance(3, [30 + i, .5, .5], [], { classname: 'func_bomb_target', model: site.sourceModel, hammerid: site.hammerid })) };
  return { data, collision };
}

const available = existsSync('public/source/csgo-12426148/character-ak/manifest.json');
const STEP = 1 / 64;

describe.runIf(available)('original ragdoll terrain collision', () => {
  let index: SourceRagdollIndex, rest: SourceRagdollRest;
  beforeAll(async () => {
    await RAPIER.init();
    const fixture = await loadCharacterCpuFixture();
    const data: SourceRagdollData = parseSourceRagdollData(JSON.parse(readFileSync('public/source/csgo-12426148/ragdoll/ragdoll-data.json', 'utf8')));
    index = bindSourceRagdoll(data, fixture.poseIndex);
    rest = computeSourceRagdollRestFromDeath1(index, fixture.poseIndex).rest;
  });
  /** A corpse's actor frame; yaw -pi/2 makes actor-local +X point along world +X. */
  const ground = (level: ReturnType<typeof createSourceLevel>, x: number, y: number, z: number): SourceRagdollGround =>
    ({ x, y, z, yaw: -Math.PI / 2, metersPerSourceUnit: .0254,
      surfaceY: (wx, wz, fromY) => level.groundHeight(wx, wz, fromY) });
  const level = () => { const { data, collision } = terrain(); const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const created = createSourceLevel(world, data, collision); world.step(); return { world, level: created }; };
  const worldY = (actorY: number, z: number) => actorY + z * .0254;
  const refresh = (live: SourceRagdollLive, query: SourceRagdollGround) =>
    updateSourceRagdollGround(index, live, query, rest.groundZ);
  const settle = (query: SourceRagdollGround, live: SourceRagdollLive, maxSteps = 2400) => {
    let state = live;
    for (let i = 0; i < maxSteps && !state.settled; i++) {
      refresh(state, query);
      state = stepSourceRagdoll(index, state, rest, STEP);
    }
    return state;
  };
  const positions = (live: SourceRagdollLive, actorY: number) => Array.from({ length: index.data.parts.length },
    (_, part) => worldY(actorY, live.positions[part * 3 + 2]));

  it('samples the ground under each part from the original map surface, not one death plane', () => {
    const { world, level: map } = level();
    const query = ground(map, -.5, 5, 0);
    const live = spawnSourceRagdoll(rest, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    // Straddle the step edge: half the parts are shifted one metre towards it.
    const metre = 1 / .0254, shifted = new Set<number>();
    for (let part = 0; part < index.data.parts.length; part += 2) {
      live.positions[part * 3] += metre; shifted.add(part);
    }
    refresh(live, query);
    const floor = (0 - 5) / .0254, step = (2 - 5) / .0254;
    for (let part = 0; part < index.data.parts.length; part++)
      // Convex hulls are float32, so the surface is centimetre-exact, not bit-exact.
      expect(live.groundZ[part]).toBeCloseTo(shifted.has(part) ? step : floor, 4);
    // Exactly two surfaces appear, one for each side of the step edge, and both
    // are populated: the corpse straddles real terrain instead of one plane.
    const quantise = (values: Iterable<number>) => [...new Set(Array.from(values, v => Math.round(v * 100) / 100))];
    expect(quantise(live.groundZ).sort((a, b) => a - b)).toEqual(quantise([floor, step]).sort((a, b) => a - b));
    expect(shifted.size).toBeGreaterThan(0); expect(shifted.size).toBeLessThan(index.data.parts.length);
    map.dispose(); world.free();
  });

  it('keeps a corpse on the floor under a solid ceiling instead of climbing onto it', () => {
    const { world, level: map } = level();
    // The slab is real: a corpse above it rests on its top.
    expect(map.groundHeight(-13, 0, 5)).toBeCloseTo(SLAB.y1, 4);
    const query = ground(map, -13, 0, 0);
    const live = spawnSourceRagdoll(rest, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    refresh(live, query);
    // Every part is below the slab's underside, so every part's ground is the
    // floor: a ceiling must never support the corpse that hangs under it.
    const standingHeight = Math.max(...Array.from({ length: index.data.parts.length }, (_, part) => rest.positions[part * 3 + 2]));
    expect(standingHeight * .0254).toBeLessThan(SLAB.y0);
    for (const value of live.groundZ) expect(value).toBeCloseTo(0, 4);
    const settled = settle(query, live);
    expect(settled.settled).toBe(true);
    expect(Math.max(...positions(settled, 0))).toBeLessThan(SLAB.y0);
    map.dispose(); world.free();
  });

  it('does not let a playerclip-only brush hold a corpse up', () => {
    const { world, level: map } = level();
    const query = ground(map, -5, .3, 0);
    const live = spawnSourceRagdoll(rest, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    refresh(live, query);
    // The ceiling is real for player hulls...
    expect(map.wallDistance(-5, 4, 0, 0, -1, 0, 'player')).toBeCloseTo(4 - CLIP.y1, 6);
    // ...but every part still finds the floor, not the clip brush above it.
    for (const value of live.groundZ) expect(value).toBeCloseTo((0 - .3) / .0254, 4);
    map.dispose(); world.free();
  });

  it('drops a corpse killed in mid-air onto the real surface below it', () => {
    const { world, level: map } = level();
    const live = spawnSourceRagdoll(rest, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    const deathZ = worldY(4, rest.groundZ);
    // Clear floor, away from the step and the solid slab.
    const settled = settle(ground(map, -20, 4, 0), live);
    expect(settled.settled).toBe(true);
    const heights = positions(settled, 4);
    const lowest = Math.min(...heights), mean = heights.reduce((a, b) => a + b, 0) / heights.length;
    // It came all the way down to the floor, and no part ever sank through it.
    expect(mean).toBeLessThan(.5);
    expect(lowest).toBeGreaterThan(-1e-6);
    expect(deathZ - mean).toBeGreaterThan(3);
    map.dispose(); world.free();
  });

  it('keeps a part with no surface under it on the death-frame plane instead of inventing support', () => {
    const { world, level: map } = level();
    // No floor beyond x = 10, so nothing is under the corpse but empty space.
    const settled = settle(ground(map, 20, .5, 0), spawnSourceRagdoll(rest, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }));
    expect(settled.settled).toBe(true);
    for (const value of settled.groundZ) expect(value).toBeCloseTo(rest.groundZ, 6);
    // The corpse stays where the death frame put it: never below it, and never
    // propped up on a surface that is not there.
    const heights = positions(settled, .5);
    expect(Math.min(...heights)).toBeGreaterThan(worldY(.5, rest.groundZ) - 1e-6);
    expect(Math.max(...heights)).toBeLessThan(worldY(.5, rest.groundZ) + 1.2);
    map.dispose(); world.free();
  });

  it('keeps every part above its own surface while the corpse settles', () => {
    const { world, level: map } = level();
    let live = spawnSourceRagdoll(rest, { x: 30, y: 0, z: 0 }, { x: -20, y: -40, z: 20 });
    const query = ground(map, -3, 6, 0);
    for (let i = 0; i < 600 && !live.settled; i++) {
      refresh(live, query);
      live = stepSourceRagdoll(index, live, rest, STEP);
      for (let part = 0; part < index.data.parts.length; part++)
        expect(live.positions[part * 3 + 2]).toBeGreaterThan(live.groundZ[part] + index.partRadii[part] - 1e-6);
    }
    expect(live.settled).toBe(true);
    map.dispose(); world.free();
  });
});
