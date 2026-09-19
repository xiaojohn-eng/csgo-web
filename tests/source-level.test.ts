import { beforeAll, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createSourceLevel, type SourceLevelData } from '../game/source-level';
import type { SourceMapCollisionData } from '../game/source-map-collision';
import type {SourceNavigationData} from '../game/source-navigation';
beforeAll(() => RAPIER.init());
function fixture() {
  const bounds: SourceLevelData['worldBounds'] = { min: [-5, -5, -5], max: [30, 5, 5] };
  const data: SourceLevelData = { format: 'source-level-v1', id: 'fixture', name: 'fixture', sourceBspSha256: 'fixture',
    metersPerSourceUnit: .0254, worldBounds: bounds, boundsMeaning: 'original fixture',
    spawns: (['blue', 'amber'] as const).map((team, i) => ({ id: team, team, x: i, y: 3, z: 0, yaw: i, pitch: 0,
      sourceClassname: i ? 'info_player_terrorist' : 'info_player_counterterrorist', sourceOrigin: [i, 0, 0], sourceAngles: [0, 0, 0] })),
    sites: [{ name: 'A', sourceModel: 26, hammerid: 'A', bounds }, { name: 'B', sourceModel: 27, hammerid: 'B', bounds }],
    siteBinding: 'fixture', navigation: null, navigationStatus: 'unavailable', sourceNavSha256: '',
    player: { standing: { halfExtents: [.4064, .9144, .4064], eyeHeight: 1.6256 },
      crouching: { halfExtents: [.4064, .6858, .4064], eyeHeight: 1.1684 }, gravity: 20.32, stepHeight: .4572,
      standableNormal: .7, sourceServerSha256: 'fixture', hullMeaning: 'AABB' } };
  const collision: SourceMapCollisionData = { format: 'source-map-collision-v1', sourceMap: 'fixture', sourceBspSha256: 'fixture',
    metersPerSourceUnit: .0254, missingPHY: [], limits: [], geometries: [
      { id: 0, kind: 'convex', vertices: [-2,-1,-.1, -2,-1,.1, -2,1,-.1, -2,1,.1, 2,-1,-.1, 2,-1,.1, 2,1,-.1, 2,1,.1], source: {} },
      { id: 1, kind: 'convex', vertices: [-.5,-.5,-.5, 1.5,-.5,-.5, -.5,1.5,-.5, -.5,-.5,1.5], source: {} },
    ], colliders: [{ geometry: 0, translation: [0, 1, 3], rotation: [0,0,0,1], scale: 1, roles: ['player','bullet','projectile'], source: {} }],
    sensors: data.sites.map((site, i) => ({ geometry: 1, translation: [10.5 + 10*i, .5, .5], rotation: [0,0,0,1], scale: 1,
      roles: [], source: { classname: 'func_bomb_target', model: site.sourceModel, hammerid: site.hammerid } })) };
  return { data, collision };
}
it('uses original map walls for metric rays and excludes caller actors and bomb sensors', () => {
  const world = new RAPIER.World({x:0,y:0,z:0}), { data, collision } = fixture();
  const actor = world.createCollider(RAPIER.ColliderDesc.ball(.2).setTranslation(0,1,1));
  const level = createSourceLevel(world, data, collision); world.step();
  expect(level.wallDistance(0,1,0,0,0,10)).toBeCloseTo(2.9, 5);
  expect(level.sight({x:0,y:1,z:0},{x:0,y:1,z:2})).toBe(true);
  expect(level.sight({x:0,y:1,z:0},{x:0,y:1,z:4})).toBe(false);
  expect(level.sight({x:0,y:1,z:3},{x:0,y:1,z:3.0001})).toBe(false);
  expect(level.wallDistance(10.5,.5,.5,1,0,0)).toBe(Infinity);
  expect(level.navigation).toBeNull(); expect(level.spawns.blue[0].yaw).toBe(0);
  level.dispose(); level.dispose(); expect(world.colliders.len()).toBe(1);
  expect(() => level.wallDistance(0,0,0,1,0,0)).toThrow('disposed');
  world.removeCollider(actor, false); world.free();
});
it('tests actual sloped trigger volume and full player hull overlap instead of a rectangle or feet point', () => {
  const world = new RAPIER.World({x:0,y:0,z:0}), { data, collision } = fixture();
  const level = createSourceLevel(world, data, collision); world.step();
  expect(level.siteContainsPoint('A',{x:10.5,y:.5,z:.5})).toBe(true);
  expect(level.siteContainsPoint('A',{x:11.8,y:1.8,z:1.8})).toBe(false);
  expect(level.siteContainsPoint('A',{x:10.75,y:.75,z:.75})).toBe(false);
  expect(level.sitesOverlappingShape({x:10.75,y:.75,z:.75},new RAPIER.Ball(.2))).toEqual(['A']);
  expect(level.siteContainsPoint('A',{x:9.8,y:0,z:.2})).toBe(false);
  expect(level.sitesForSourcePlayer({x:9.8,y:0,z:.2},'standing')).toEqual(['A']);
  level.dispose(); world.free();
});
it('finds the original surface under a point for physics props, excluding sensors and playerclip', () => {
  const world = new RAPIER.World({x:0,y:0,z:0}), { data, collision } = fixture();
  // A playerclip-only brush: real for player hulls, not a surface a physics prop
  // (corpse, dropped magazine) can rest on. Original props collide with MASK_SOLID.
  collision.colliders.push({ geometry: 0, translation: [0, 4, 0], rotation: [0,0,0,1], scale: 1, roles: ['player'], source: {} });
  const level = createSourceLevel(world, data, collision); world.step();
  // The original box spans y 0..2 at z 2.9..3.1, so its top is the surface there.
  expect(level.groundHeight(0, 3, 8)).toBeCloseTo(2, 6);
  // The clip brush is really there for players, but not for a prop.
  expect(level.wallDistance(0, 8, 0, 0, -1, 0, 'player')).toBeCloseTo(3, 5);
  expect(level.groundHeight(0, 0, 8)).toBeNull();
  // Bomb sensors are excluded, and a ray that starts inside a solid reports no
  // surface at all instead of a zero drop.
  expect(level.groundHeight(10.5, .5, 8)).toBeNull();
  expect(level.groundHeight(0, 3, 1)).toBeNull();
  expect(level.groundHeight(0, 3, Number.NaN)).toBeNull();
  level.dispose(); world.free();
});
it('rejects mismatched source identity before mutation and rolls back missing trigger bindings', () => {
  const world = new RAPIER.World({x:0,y:0,z:0}), { data, collision } = fixture();
  expect(() => createSourceLevel(world, {...data,sourceBspSha256:'wrong'},collision)).toThrow('identity mismatch');
  expect(world.colliders.len()).toBe(0);
  data.sites[1].hammerid = 'missing';
  expect(() => createSourceLevel(world,data,collision)).toThrow('Missing original bomb trigger B');
  expect(world.colliders.len()).toBe(0); world.free();
});
it('rejects malformed injected spawn metadata without retaining original map colliders', () => {
  const world = new RAPIER.World({x:0,y:0,z:0}), { data, collision } = fixture();
  const broken = {...data,spawns:null} as unknown as SourceLevelData;
  expect(() => createSourceLevel(world,broken,collision)).toThrow();
  const remaining = world.colliders.len(); world.free();
  expect(remaining).toBe(0);
});
it('binds the matching original 3D NAV and preserves vertical portal endpoints',()=>{
  const world=new RAPIER.World({x:0,y:0,z:0}),{data,collision}=fixture();data.sourceNavSha256='nav-fixture';
  const navigation:SourceNavigationData={format:'source-navigation-v1',version:16,subVersion:1,
    sourceNavSha256:'nav-fixture',sourceBspSha256:'fixture',metersPerSourceUnit:.0254,places:[],ladders:[],areas:[
      {id:1,flags:0,nw:[0,0,0],se:[100,100,0],neZ:0,swZ:0,place:0,connections:[[],[2],[],[]],ladders:[[],[]]},
      {id:2,flags:0,nw:[100,0,50],se:[200,100,50],neZ:50,swZ:50,place:0,connections:[[],[],[],[1]],ladders:[[],[]]},
    ]};
  expect(()=>createSourceLevel(world,data,collision,{navigation:{...navigation,sourceNavSha256:'other'}})).toThrow('NAV identity');
  expect(world.colliders.len()).toBe(0);
  const level=createSourceLevel(world,data,collision,{navigation});
  const route=level.pathfind({x:.254,y:0,z:-1.27},{x:3.81,y:1.27,z:-1.27});
  expect(route.status).toBe('path');expect(route.staticOnly).toBe(true);expect(route.areaIds).toEqual([1,2]);
  const exit=route.waypoints.find(p=>p.kind==='portal-exit')!,enter=route.waypoints.find(p=>p.kind==='portal-enter')!;
  expect(exit.x).toBe(enter.x);expect(exit.z).toBe(enter.z);expect(enter.y-exit.y).toBeCloseTo(1.27,8);
  level.dispose();expect(()=>level.pathfind({x:0,y:0,z:0},{x:1,y:0,z:0})).toThrow('disposed');
  expect(world.colliders.len()).toBe(0);world.free();
});
