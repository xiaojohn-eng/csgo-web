import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import original from './fixtures/source-worldlight-kernels.json';
import nativeCache from './fixtures/source-particle-cache-native.json';
import {SOURCE_PARTICLE_WORLDLIGHTS,sourceParticleLightQueryColor,sourceWorldlightAttenuation,sourceWorldlightCone,sourceWorldlightAddCube,sourceParticleBuildLightCache,sourceParticleCompleteLightCache,sourceParticleClipToLeaf,sourceParticleLightCell,sourceParticleLightCachePosition,createSourceParticleLighting,type SourceParticleLightingTrace,type SourceParticleLightVec3,type SourceParticleLightingOwner} from '../game/source-particle-lighting';
it('matches 202 executed original point/surface/spot/sky attenuation and cone cases',()=>{
 expect(SOURCE_PARTICLE_WORLDLIGHTS).toHaveLength(26);
 for(const row of original.cases){
  const light=SOURCE_PARTICLE_WORLDLIGHTS[row.light];
  expect(sourceWorldlightAttenuation(light,row.delta),`${row.light} attenuation`).toBeCloseTo(row.nativeAttenuation,10);
  expect(sourceWorldlightCone(light,row.direction),`${row.light} cone`).toBeCloseTo(row.nativeCone,7);
 }
});
it('matches executed native cache selection, weak-light folding and final query cases',()=>{
 for(const row of nativeCache.cases){
  const calls:{mask:number;includeProps:boolean}[]=[];
  const trace:SourceParticleLightingTrace=(from,to,options)=>{
   calls.push(options);
   const distance=Math.hypot(...to.map((v,i)=>v-from[i])),sun=distance>50000;
   return {fraction:Math.fround(row.traceMode==='blocked'?.5:row.traceMode==='near-end'&&!sun&&distance?Math.max(0,1-7/distance):1),surfaceFlags:sun&&!['blocked','sky-blocked'].includes(row.traceMode)?4:0};
  };
  const cache=sourceParticleBuildLightCache(row.cachePoint as unknown as SourceParticleLightVec3,row.ambient,{trace});
  expect(cache.pending,JSON.stringify([row.cachePoint,row.traceMode])).toEqual(row.nativePending);
  cache.cube.forEach((face,i)=>face.forEach((value,j)=>expect(value,`${row.cachePoint} ${row.traceMode} cube ${i}/${j}`).toBeCloseTo(row.nativeCacheCube[i][j],5)));
  expect(sourceParticleCompleteLightCache(cache,row.queryPoint as unknown as SourceParticleLightVec3,trace).color).toEqual(row.nativeColor);
  expect(calls,JSON.stringify([row.cachePoint,row.traceMode])).toEqual(row.traces.map(t=>({mask:t.mask,includeProps:t.includeProps})));
 }
});
it('clips crossing-leaf candidates exactly like original CM with the actual DustII tree',()=>{
 const {tree}=JSON.parse(readFileSync('public/source/csgo-12426148/fidelity-world-20260913/lighting-trace/trace.json','utf8'));
 for(const row of nativeCache.clamps)expect(sourceParticleClipToLeaf(tree,row.from as unknown as SourceParticleLightVec3,row.candidate as unknown as SourceParticleLightVec3)).toEqual(row.native);
 expect(sourceParticleLightCell([-32,-64,-128]).min).toEqual([-64,-96,-192]);
});
it('matches original cache-center placement cases including obstruction and start-solid fallbacks',()=>{
 const {tree}=JSON.parse(readFileSync('public/source/csgo-12426148/fidelity-world-20260913/lighting-trace/trace.json','utf8'));
 const leafAt=(p:SourceParticleLightVec3)=>{let node=tree.head;while(node>=0){const n=tree.nodes[node],q=tree.planes[n.plane];node=n.children[Math.fround(Math.fround(Math.fround(Math.fround(q[0]*p[0])+Math.fround(q[1]*p[1]))+Math.fround(q[2]*p[2]))-q[3])>=0?0:1];}return {leaf:-node-1,contents:tree.leafContents[-node-1]};};
 for(const row of nativeCache.centers){let calls=0;
  const trace:SourceParticleLightingTrace=()=>{calls++;return {fraction:row.traceMode==='all-blocked'||row.traceMode==='first-blocked'&&calls===1?.5:1,surfaceFlags:0,startSolid:row.traceMode==='start-solid'};};
  expect(sourceParticleLightCachePosition(row.point as unknown as SourceParticleLightVec3,{tree,leafAt,trace}),JSON.stringify(row)).toEqual(row.native);
  expect(calls).toEqual(row.traces.length);
 }
});
it('returns native bytes at an effect CP, converts world axes, reuses the source cell, and owns no map resources',()=>{
 const owner:SourceParticleLightingOwner={tree:{head:0,planes:[[1,0,0,-32768]],nodes:[{plane:0,children:[-1,-1]}],leafContents:[0]},leafAt:()=>({leaf:0,contents:0}),visibleWorldlight:()=>true,
  trace:(from,to)=>({fraction:1,surfaceFlags:Math.hypot(...to.map((v,i)=>v-from[i]))>50000?4:0})};
 const row=nativeCache.cases.find(c=>c.cachePoint[0]===-16&&c.traceMode==='clear')!,point=row.queryPoint as unknown as SourceParticleLightVec3;
 const provider=createSourceParticleLighting({lightingTrace:owner,sampleAmbient:()=>({faces:row.ambient})});
 expect(provider.sampleSourcePosition(point)).toEqual(row.nativeColor);
 expect(provider.sampleWorldPosition({x:point[0]*.0254,y:point[2]*.0254,z:-point[1]*.0254})).toEqual(row.nativeColor);
 expect(provider.audit).toMatchObject({queries:2,cacheMisses:1,cacheHits:1,cacheEntries:1});
 provider.dispose();expect(provider.audit.cacheEntries).toBe(0);expect(()=>provider.sampleSourcePosition(point)).toThrow(/disposed/);
 expect(owner.trace(point,point,{mask:0x4481,includeProps:false}).fraction).toBe(1);
});
it('averages the completed cube, upper clamps HDR, truncates bytes and does not gamma decode twice',()=>{
 expect(sourceParticleLightQueryColor(Array.from({length:6},()=>[2,.75,.125]))).toEqual([255,191,31]);
 expect(sourceParticleLightQueryColor([[.1,.2,.3],[.2,.3,.4],[.3,.4,.5],[.4,.5,.6],[.5,.6,.7],[.6,.7,.8]])).toEqual([89,114,140]);
 expect(()=>sourceParticleLightQueryColor([[1,1,1]])).toThrow(/completed/);
});
it('adds each static light only to its positive cube faces',()=>{
 const light={...SOURCE_PARTICLE_WORLDLIGHTS[0],intensity:[2,3,4]},cube=Array.from({length:6},()=>[0,0,0]);
 sourceWorldlightAddCube(cube,light,[1,0,0],.25);expect(cube).toEqual([[.5,.75,1],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]]);
});
