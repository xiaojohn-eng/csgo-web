import fs from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { createSourceLevel, type SourceLevelData } from '../game/source-level.js';
import type { SourceMapCollisionData } from '../game/source-map-collision.js';
const folder = '.reference-assets/source-exports/dust2';
const data = JSON.parse(fs.readFileSync(`${folder}/level.json`, 'utf8')) as SourceLevelData;
const collision = JSON.parse(fs.readFileSync(`${folder}/collision/collision.json`, 'utf8')) as SourceMapCollisionData;
await RAPIER.init(); const world = new RAPIER.World({x:0,y:-data.player.gravity,z:0});
const level = createSourceLevel(world,data,collision); world.step();
assert.equal(level.spawns.blue.length,15); assert.equal(level.spawns.amber.length,15);
const spawns = data.spawns.map(spawn => {
  const standing = level.settleSourceSpawn(spawn,'standing'), crouching = level.settleSourceSpawn(spawn,'crouching');
  assert(standing && crouching);
  return { id: spawn.id, team: spawn.team, authored: spawn, standing, crouching };
});
const sites = level.sites.map(site => {
  const point = { x:site.x, y:site.y, z:site.z };
  assert(level.siteContainsPoint(site.name,point));
  assert.deepEqual(level.sitesForSourcePlayer(point,'standing'),[site.name]);
  assert.deepEqual(level.sitesForSourcePlayer(point,'crouching'),[site.name]);
  assert(!level.siteContainsPoint(site.name,{...point,y:site.bounds.max[1]+1}));
  return { name:site.name, sourceModel:site.sourceModel, hammerid:site.hammerid, point, triggerConvexes:site.colliders.length };
});
const eye = (spawn: typeof spawns[number]) => ({ x:spawn.standing!.x,y:spawn.standing!.y+level.player.standing.eyeHeight,z:spawn.standing!.z });
const rays = [eye(spawns[0]),eye(spawns[15])].flatMap(origin => Array.from({length:8},(_,i) => {
  const direction={x:Math.cos(i*Math.PI/4),y:0,z:Math.sin(i*Math.PI/4)};
  const distance=level.wallDistance(origin.x,origin.y,origin.z,direction.x,0,direction.z,'bullet',100);
  if (Number.isFinite(distance)) {
    const before={x:origin.x+direction.x*Math.max(0,distance-.05),y:origin.y,z:origin.z+direction.z*Math.max(0,distance-.05)};
    const after={x:origin.x+direction.x*(distance+.05),y:origin.y,z:origin.z+direction.z*(distance+.05)};
    assert(level.sight(origin,before)); assert(!level.sight(origin,after));
  }
  return { origin,direction,distance:Number.isFinite(distance)?distance:null };
}));
assert(rays.filter(ray=>ray.distance!==null).length>=8);
level.dispose();level.dispose();assert.equal(world.colliders.len(),0);world.free();
const result={sourceBspSha256:data.sourceBspSha256,spawns,sites,rays,worldBounds:level.worldBounds,
  navigation:level.navigation,stats:level.collision.stats,freedWithoutWasmBorrowError:true,
  implementationSHA256:Object.fromEntries(['game/source-level.ts','game/source-map-collision.ts'].map(file=>
    [file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]))};
fs.writeFileSync('output/tests/source-level.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({spawns:spawns.length,sites,rays:rays.length,navigation:null,disposed:true},null,2));
