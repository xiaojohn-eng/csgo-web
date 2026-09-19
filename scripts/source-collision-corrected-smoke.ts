import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import RAPIER from '@dimforge/rapier3d-compat';
import { attachSourceMapCollision, sourceMapQueryGroups, SOURCE_SENSOR_QUERY_GROUPS,
  type SourceMapCollisionData } from '../game/source-map-collision';

// Fixed points come from the independently decoded native-axis/MDL/VVD audit,
// not the exported collision extents. Keep the old export as an explicit red
// witness: its ladder blocks the empty CT ramp and misses the actual ladder.
const dir='.reference-assets/source-exports/dust2';
const corrected=!process.argv.includes('--original');
const bytes=fs.readFileSync(`${dir}/${corrected?'collision-ivp-corrected':'collision'}/collision.json`);
const data=JSON.parse(bytes.toString()) as SourceMapCollisionData;
await RAPIER.init();
const world=new RAPIER.World({x:0,y:0,z:0});
const sentinel=world.createCollider(RAPIER.ColliderDesc.ball(.01).setTranslation(10000,10000,10000));
const map=attachSourceMapCollision(world,data);world.step();
const identity={x:0,y:0,z:0,w:1},roles=['player','bullet','projectile'] as const;
const isolatedLadder=(c:RAPIER.Collider)=>map.metadata.get(c.handle)?.source.prop===2647;
const ladderRay=new RAPIER.Ray({x:13.5,y:-3,z:-60.4},{x:-1,y:0,z:0});
const rungGapRay=new RAPIER.Ray({x:13.5,y:-2.7,z:-60.4},{x:-1,y:0,z:0});
const rungGap=world.castRay(rungGapRay,2,false,undefined,sourceMapQueryGroups('bullet'),undefined,undefined,isolatedLadder);
const ladderHits=Object.fromEntries(roles.map(role=>{
  const hit=world.castRayAndGetNormal(ladderRay,2,false,undefined,sourceMapQueryGroups(role),undefined,undefined,isolatedLadder);
  return [role,hit&&{distance:hit.timeOfImpact,normal:hit.normal,source:map.metadata.get(hit.collider.handle)?.source}];
}));
const standing=new RAPIER.Cuboid(16*.0254,36*.0254,16*.0254);
const actualSweep=world.castShape({x:14.5,y:-3.1+36*.0254,z:-60.4},identity,{x:-1,y:0,z:0},standing,0,3,true,
  undefined,sourceMapQueryGroups('player'),undefined,undefined,isolatedLadder);
const before={x:12.09457363959501,y:-3.2736165000513897,z:-55.96975389061562};
const ghostSweep=world.castShape({...before,y:before.y+36*.0254},identity,{x:1,y:0,z:0},standing,0,.2,true,
  undefined,sourceMapQueryGroups('player'),undefined,undefined,isolatedLadder);
const roleChecks=[
  {name:'playerclip',find:(s:Record<string,unknown>)=>s.layer==='brush'&&((s.contents as number)&0x10000)!==0,
    expected:{player:true,bullet:false,projectile:false}},
  {name:'grate',find:(s:Record<string,unknown>)=>s.layer==='brush'&&((s.contents as number)&8)!==0,
    expected:{player:true,bullet:false,projectile:false}},
  {name:'grate VPHY',find:(s:Record<string,unknown>)=>s.layer==='worldVphy'&&s.contents===8,
    expected:{player:false,bullet:false,projectile:true}},
].map(check=>{
  const c=map.colliders.find(c=>check.find(map.metadata.get(c.handle)!.source));assert(c,check.name);
  const ray=new RAPIER.Ray(c.translation(),{x:1,y:0,z:0});
  const actual=Object.fromEntries(roles.map(role=>[role,!!world.castRay(ray,100,true,undefined,sourceMapQueryGroups(role),
    undefined,undefined,candidate=>candidate.handle===c.handle)]));
  assert.deepEqual(actual,check.expected);return {name:check.name,source:map.metadata.get(c.handle)?.source,actual};
});
const sensors=map.colliders.filter(c=>c.isSensor()).map(c=>{
  const ray=new RAPIER.Ray(c.translation(),{x:1,y:0,z:0}),only=(candidate:RAPIER.Collider)=>candidate.handle===c.handle;
  assert(world.castRay(ray,100,true,undefined,SOURCE_SENSOR_QUERY_GROUPS,undefined,undefined,only));
  for(const role of roles)assert.equal(world.castRay(ray,100,true,undefined,sourceMapQueryGroups(role),undefined,undefined,only),null);
  return map.metadata.get(c.handle)?.source;
});
assert.equal(sensors.length,15);
const report={corrected,sourceCollisionSha256:createHash('sha256').update(bytes).digest('hex'),ladderHits,rungGapClear:rungGap===null,
  actualLadderHullSweep:actualSweep&&{distance:actualSweep.time_of_impact,source:map.metadata.get(actualSweep.collider.handle)?.source},
  emptyRampLadderHullSweep:ghostSweep&&{distance:ghostSweep.time_of_impact,source:map.metadata.get(ghostSweep.collider.handle)?.source},
  roleChecks,sensors,stats:map.stats,disposedOnlyOwned:false};
map.dispose();map.dispose();assert.equal(world.colliders.len(),1);assert.equal(world.getCollider(sentinel.handle),sentinel);
world.removeCollider(sentinel,false);world.free();report.disposedOnlyOwned=true;
fs.writeFileSync(`output/tests/source-collision-${corrected?'corrected':'original'}-roles.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
assert(roles.every(role=>ladderHits[role]),'The actual ladder position must stop player/bullet/projectile rays');
assert(actualSweep,'The original ladder must stop the standing AABB at its actual position');
assert.equal(ghostSweep,null,'The original ladder must not block the empty CT ramp');
assert.equal(rungGap,null,'The original rung gap remains open to a zero-radius bullet ray');
console.log('PASS: original physical ladder retained, CT ramp ghost removed, role/sensor/disposal contracts preserved');
