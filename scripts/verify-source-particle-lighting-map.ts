/** Actual original-map CPU query, using the shipped ambient sampler and original
 * lighting-mask geometry. This is not browser evidence or native physics QA. */
import RAPIER from '@dimforge/rapier3d-compat';
import {Vector3} from 'three';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createSourceLevel} from '../game/source-level';
import {createSourceLightingTrace,type SourceLightingTraceData} from '../game/source-lighting-trace';
import {createSourceParticleLighting,sourceParticleLightQueryColor,type SourceParticleLightingOwner,type SourceParticleLightVec3} from '../game/source-particle-lighting';
const args=process.argv.slice(2),arg=(key:string,fallback:string)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const appRoot=resolve(arg('--app-root','.')),base=resolve(appRoot,'public/source/csgo-12426148');
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const {createSourceAmbientSampler}=await import(pathToFileURL(resolve(appRoot,'game/source-env-cubemaps.ts')).href);
const files=new Map(['planes','nodes','leaves','ambient-index-hdr','ambient-lighting-hdr'].map(name=>[name+'.bin',new Uint8Array(readFileSync(resolve(base,'environment-probes',name+'.bin')))]));
const ambient=createSourceAmbientSampler(files),position=new Vector3();
await RAPIER.init();const world=new RAPIER.World({x:0,y:-20.32,z:0});
const level=createSourceLevel(world,read(resolve(base,'dust2/level.json')),read(resolve(base,'dust2/collision.json')));world.step();
const data=read(resolve(base,'fidelity-world-20260913/lighting-trace/trace.json'))as SourceLightingTraceData;
data.visibility=read(resolve(base,'fidelity-world-20260913/lighting-trace/visibility.json'));
const trace=createSourceLightingTrace(data,{world,map:level.collision});
assert(trace.audit.visibility,'Requires the original PVS/leaf-flags lighting trace owner');
const provider=createSourceParticleLighting({lightingTrace:trace as unknown as SourceParticleLightingOwner,sampleAmbient:p=>ambient.sampleSourcePosition(position.set(...p))});
try{
 const spawns=read(resolve(appRoot,'.reference-assets/source-exports/dust2/visibility/spawn-fixtures.json'));
 const rows=[],times=[];
 for(const spawn of spawns){
  const p=spawn.sourceEye64 as SourceParticleLightVec3,start=performance.now(),color=provider.sampleSourcePosition(p);times.push(performance.now()-start);
  assert(color.every(v=>Number.isInteger(v)&&v>=0&&v<=255));
  const worldPosition={x:p[0]*.0254,y:p[2]*.0254,z:-p[1]*.0254};assert.deepEqual(provider.sampleWorldPosition(worldPosition),color);
  const raw=ambient.sampleSourcePosition(position.set(...p));
  rows.push({hammerid:spawn.hammerid,team:spawn.team,sourceEye64:p,leaf:trace.leafAt(p),color,rawAmbientOnlyColor:raw?sourceParticleLightQueryColor(raw.faces):null});
 }
 assert(rows.length===30);assert(new Set(rows.map(r=>r.color.join(','))).size>1,'Actual map lighting unexpectedly uniform');
 const sorted=times.toSorted((a,b)=>a-b),output=resolve(arg('--output','output/fidelity-character/particle-orientation/lighting-map.json'));
 const report={status:'passed',scope:'30 original Source/DustII spawn eyes, real shipped leaf ambient sampler, original worldlight data and lighting-mask trace. CPU scene query; not original engine native physics or browser/GPU acceptance.',provider:{...provider.audit},trace:trace.audit,queryMs:{mean:times.reduce((a,b)=>a+b,0)/times.length,p95:sorted[Math.floor(sorted.length*.95)]},rows};
 mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,rows:undefined,output}));
}finally{provider.dispose();trace.dispose();level.dispose();world.free();}
