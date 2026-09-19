import RAPIER from '@dimforge/rapier3d-compat';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createSourceLevel} from '../game/source-level';
import {createSourceLightingTrace,type SourceLightingTraceData} from '../game/source-lighting-trace';
import {SOURCE_LIGHTING_TRACE_ASSET} from '../game/source-lighting-trace-data';
const root=resolve('.'),base=resolve(root,'public/source/csgo-12426148'),read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const bytes=readFileSync(resolve(base,'fidelity-world-20260913/lighting-trace/trace.json'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),SOURCE_LIGHTING_TRACE_ASSET.sha256);
const data:SourceLightingTraceData=JSON.parse(bytes.toString());
const collision=read(resolve(base,'dust2/collision.json')),levelData=read(resolve(base,'dust2/level.json'));
assert.equal(createHash('sha256').update(readFileSync(resolve(base,'dust2/collision.json'))).digest('hex'),data.collisionSha256);
await RAPIER.init();const world=new RAPIER.World({x:0,y:-20.32,z:0}),level=createSourceLevel(world,levelData,collision);world.step();
const owner=createSourceLightingTrace(data,{world,map:level.collision}),brushes=createSourceLightingTrace(data);
const bsp=readFileSync(resolve('.reference-assets/csgo-legacy/csgo/maps/de_dust2.bsp')),offset=new DataView(bsp.buffer,bsp.byteOffset,bsp.byteLength).getUint32(8+54*16,true),size=new DataView(bsp.buffer,bsp.byteOffset,bsp.byteLength).getUint32(12+54*16,true);
const view=new DataView(bsp.buffer,bsp.byteOffset,bsp.byteLength);
assert.equal(size%100,0);const lights=Array.from({length:size/100},(_,i)=>{const at=offset+i*100;return {index:i,type:view.getInt32(at+52,true),origin:[0,4,8].map(o=>view.getFloat32(at+o,true)),normal:[24,28,32].map(o=>view.getFloat32(at+o,true))};});
assert.equal(lights.length,26);const sun=lights.find(l=>l.type===3)!;
const spawns=read(resolve('.reference-assets/source-exports/dust2/visibility/spawn-fixtures.json'));
const rows=[];let leafChecks=0,traceCalls=0,totalMs=0;
for(const spawn of spawns){
 for(const [key,expected] of [['sourceOrigin','originExpected'],['sourceEye64','eyeExpected']]){
  const leaf=owner.leafAt(spawn[key]);assert.equal(leaf.leaf,spawn[expected].leaf);leafChecks++;
 }
 const from=spawn.sourceEye64 as [number,number,number],to=from.map((v,i)=>v-sun.normal[i]*57016.3203125) as [number,number,number];
 const start=performance.now(),worldOnly=owner.trace(from,to),withProps=owner.trace(from,to,{includeProps:true}),brushOnly=brushes.trace(from,to);
 totalMs+=performance.now()-start;traceCalls+=3;
 for(const hit of [worldOnly,withProps,brushOnly])assert(Number.isFinite(hit.fraction)&&hit.fraction>=0&&hit.fraction<=1);
 assert(withProps.fraction<=worldOnly.fraction+1e-6);
 const samples=[];
 for(const light of lights.filter(l=>l.type!==3&&l.type!==5)){
  const hit=owner.trace(from,light.origin as [number,number,number]);traceCalls++;
  assert(hit.fraction>=0&&hit.fraction<=1);samples.push({light:light.index,type:light.type,fraction:hit.fraction,surfaceFlags:hit.surfaceFlags,source:hit.source});
 }
 rows.push({hammerid:spawn.hammerid,team:spawn.team,sourceEye64:from,leaf:owner.leafAt(from),sun:{worldOnly,withProps,brushOnly},lights:samples});
}
assert(rows.some(r=>r.sun.worldOnly.surfaceFlags&4),'No original sky portal hit');assert(rows.some(r=>!(r.sun.worldOnly.surfaceFlags&4)),'No original indoor occluder hit');
const report={status:'passed',scope:'Original asset/CPU physics adapter validation. 60 original spawn leaf matches, 30 original sun rays in 3 filter modes, 24 local-light rays at each eye. Not native CM/VPhysics numerical equivalence or GPU-lighting acceptance.',
 asset:SOURCE_LIGHTING_TRACE_ASSET,leafChecks,traceCalls,sun: sun,meanSunThreeTraceMs:totalMs/spawns.length,
 originalWorldOnlySky:rows.filter(r=>r.sun.worldOnly.surfaceFlags&4).length,withPropsSky:rows.filter(r=>r.sun.withProps.surfaceFlags&4).length,
 audit:owner.audit,rows};
writeFileSync(resolve('research/source-lighting-trace.json'),JSON.stringify(report,null,2)+'\n');
owner.dispose();brushes.dispose();level.dispose();world.free();console.log(JSON.stringify({...report,rows:undefined}));
