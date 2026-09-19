/** Original build 12426148 particle-lighting arithmetic. Worldlight records are
 * immutable BSP HDR data. The explicit trace/cache policy lives outside these
 * kernels so a bullet ray or an uncompleted ambient cube cannot impersonate the
 * engine's GetLightForPoint query. */
import original from './source-particle-worldlights.json';
export type SourceParticleLightVec3=readonly [number,number,number];
export type SourceParticleWorldlight=(typeof original.worldlights)[number];
export const SOURCE_PARTICLE_WORLDLIGHTS=original.worldlights;
export const SOURCE_PARTICLE_LIGHTING_DEFAULTS=original.defaults;
export const SOURCE_PARTICLE_LIGHTING_TRACE_MASK=0x4481;
export const SOURCE_PARTICLE_LIGHTING_SKY_DISTANCE=57016.3203125;
const f=Math.fround;
const dot=(a:readonly number[],b:readonly number[])=>f(f(f(f(a[0])*f(b[0]))+f(f(a[1])*f(b[1])))+f(f(a[2])*f(b[2])));
/** Native 0x337230; radius=0 is unbounded, surface emitters have a one-unit
 * inverse-square cap, point/spot emitters retain original C/L/Q attenuation. */
export function sourceWorldlightAttenuation(light:SourceParticleWorldlight,delta:readonly number[],ignoreRadius=false){
 const squared=dot(delta,delta),distance=f(Math.sqrt(squared));
 if(light.type===0){
  if(light.radius!==0&&squared>f(light.radius*light.radius))return 0;
  return squared<1?1:f(1/squared);
 }
 if(light.type===1||light.type===2){
  if(!ignoreRadius&&light.radius!==0&&distance>light.radius)return 0;
  return f(1/f(f(f(squared*light.quadraticAttenuation)+light.constantAttenuation)+f(distance*light.linearAttenuation)));
 }
 return light.type===3||light.type===5?1:0;
}
/** Native 0x3373b0 called with its two lighting directions aliased, exactly as
 * GetLightForPoint does. Preserve the dot(unit,unit) factor and the native
 * exponent==0 linear branch rather than assuming an exact unit vector. */
export function sourceWorldlightCone(light:SourceParticleWorldlight,direction:readonly number[]){
 const facing=f(-dot(light.normal,direction)),normalWeight=Math.max(0,dot(direction,direction));
 if(light.type===1)return normalWeight;
 if(light.type===3)return Math.max(0,facing);
 if(light.type===5)return 1;
 if(light.type===0)return facing<=.01?0:f(facing*normalWeight);
 if(light.type===2){
  if(facing<=light.stopDot2)return 0;
  if(facing>=light.stopDot)return normalWeight;
  const t=f(f(facing-light.stopDot2)/f(light.stopDot-light.stopDot2));
  return light.exponent===0||light.exponent===1?f(normalWeight*t):f(Math.pow(t,light.exponent)*normalWeight);
 }
 return 0;
}
/** Native normalisation in 0x55c520 includes FLT_EPSILON. */
export function sourceWorldlightDirection(delta:readonly number[]):[number,number,number]{
 const scale=f(1/f(f(Math.sqrt(dot(delta,delta)))+2**-23));
 return delta.map(v=>f(v*scale))as[number,number,number];
}
/** Native 0x55c110 adds positive projections onto the six signed cube axes. */
export function sourceWorldlightAddCube(cube:number[][],light:SourceParticleWorldlight,direction:readonly number[],weight:number){
 if(cube.length!==6||cube.some(face=>face.length!==3))throw Error('Particle lighting requires all six completed faces');
 for(let face=0;face<6;face++){
  const projection=direction[face>>1]*(face%2===0?1:-1);
  if(projection<=0)continue;
  const strength=f(projection*weight);
  for(let channel=0;channel<3;channel++)cube[face][channel]=f(cube[face][channel]+f(light.intensity[channel]*strength));
 }
}
/** Executed 0x565d58 -> 0x565be6 -> 0x69d251. Only a COMPLETED Lightcache
 * cube belongs here; raw leaf ambient has not yet received worldlight terms. */
export function sourceParticleLightQueryColor(completedCube:readonly (readonly number[])[]):[number,number,number]{
 if(completedCube.length!==6||completedCube.some(face=>face.length!==3||!face.every(Number.isFinite)))throw Error('Invalid completed particle lighting cube');
 const sum=[0,0,0];for(const face of completedCube)for(let i=0;i<3;i++)sum[i]=f(sum[i]+face[i]);
 return sum.map(v=>Math.trunc(f(Math.min(1,f(v*f(1/6)))*255))&255)as[number,number,number];
}
export type SourceParticleLightingTree={readonly head:number;readonly planes:readonly (readonly [number,number,number,number])[];
 readonly nodes:readonly {readonly plane:number;readonly children:readonly [number,number]}[];readonly leafContents:readonly number[]};
export type SourceParticleLightingTrace=(from:SourceParticleLightVec3,to:SourceParticleLightVec3,options:{mask:0x4081|0x4481;includeProps:boolean})=>{fraction:number;surfaceFlags:number;startSolid?:boolean;allSolid?:boolean};
const vec=(p:readonly number[])=>p.map(f)as[number,number,number];
const sub=(a:readonly number[],b:readonly number[])=>a.map((v,i)=>f(v-b[i]))as[number,number,number];
const length=(p:readonly number[])=>f(Math.sqrt(dot(p,p)));
/** Executed original CM_ClipToLeaf, 0x3fae10. Follow the FROM point's branch
 * throughout; recomputing the branch from the moving candidate clips to the
 * wrong leaf at corners. Original Source axial planes are positive axes. */
export function sourceParticleClipToLeaf(tree:SourceParticleLightingTree,from:SourceParticleLightVec3,candidate:SourceParticleLightVec3,margin=.5){
 const p=vec(from),to=vec(candidate);let node=tree.head,steps=0;
 while(node>=0){
  if(++steps>tree.nodes.length)throw Error('Original particle lighting tree cycle');
  const n=tree.nodes[node],plane=tree.planes[n.plane];
  const axis=plane.findIndex((value,i)=>i<3&&value===1&&plane.every((v,k)=>k===3||k===i||v===0));
  const distance=(v:readonly number[])=>f((axis>=0?v[axis]:dot(plane,v))-plane[3]);
  const a=distance(p),b=distance(to);node=n.children[a>=0?0:1];
  if(a>=0&&b<0){const step=f(margin-b);for(let i=0;i<3;i++)to[i]=f(to[i]+f(plane[i]*step));}
  else if(a<0&&b>0){const step=f(b+margin);for(let i=0;i<3;i++)to[i]=f(to[i]-f(plane[i]*step));}
 }
 return to;
}
/** 0x55ddd0 uses complement for negative cells, including exact boundaries. */
export function sourceParticleLightCell(point:SourceParticleLightVec3){
 const min=point.map((value,i)=>{value=f(value);const shift=i===2?6:5,index=Math.trunc(Math.abs(value))>>shift;return (value<0?~index:index)<<shift;})as[number,number,number];
 const max=min.map((v,i)=>v+(i===2?64:32))as[number,number,number];return {min,max,center:min.map((v,i)=>f(f(v+max[i])*.5))as[number,number,number]};
}
export function sourceParticleLightCachePosition(point:SourceParticleLightVec3,owner:{tree:SourceParticleLightingTree;leafAt:(p:SourceParticleLightVec3)=>{leaf:number;contents:number};trace:SourceParticleLightingTrace}){
 const p=vec(point),cell=sourceParticleLightCell(p),leaf=owner.leafAt(p).leaf,centerLeaf=owner.leafAt(cell.center);let candidate=cell.center;
 if(centerLeaf.leaf===leaf||!(centerLeaf.contents&0x4081)){
  if(centerLeaf.leaf!==leaf)candidate=sourceParticleClipToLeaf(owner.tree,p,candidate);
  const hit=owner.trace(p,candidate,{mask:0x4081,includeProps:false});
  if(hit.startSolid)return p;if(hit.fraction>=1)return candidate;
 }
 candidate=sourceParticleClipToLeaf(owner.tree,p,[cell.center[0],cell.center[1],p[2]]);
 return owner.trace(p,candidate,{mask:0x4081,includeProps:false}).fraction>=1?candidate:p;
}
/** 0x40d050 sphere/cone intersection used before tracing surface/spot lights. */
function sphereCone(point:readonly number[],radius:number,light:SourceParticleWorldlight,sin:number,cos:number){
 const offset=f(radius/sin),shifted=light.origin.map((v,i)=>f(v-f(light.normal[i]*offset))),d=sub(point,shifted);
 if(dot(d,light.normal)<f(cos*length(d)))return false;
 const direct=sub(point,light.origin),distance=length(direct);
 return f(-dot(direct,light.normal))<f(sin*distance)||radius>=distance;
}
function boxDistance(min:readonly number[],max:readonly number[],point:readonly number[]){return dot(point.map((v,i)=>v<min[i]?f(v-min[i]):v>max[i]?f(v-max[i]):0),point.map((v,i)=>v<min[i]?f(v-min[i]):v>max[i]?f(v-max[i]):0));}
function luma(light:SourceParticleWorldlight){return f(f(f(light.intensity[1]*f(.587))+f(light.intensity[0]*f(.299)))+f(light.intensity[2]*f(.114)));}
/** The original 0x55c520 LOS policy is explicit. Ordinary query flags=1 skip
 * LOS only after that same light passed the cache's world-only LOS test.
 * Sunlight still requires an actual SURF_SKY hit in the final query. */
export function sourceParticleLightAt(light:SourceParticleWorldlight,point:SourceParticleLightVec3,trace:SourceParticleLightingTrace,flags=0){
 let direction:[number,number,number]=[0,0,0];
 if(light.type===5)return {weight:0,direction};
 if(light.type===3){
  const to=point.map((v,i)=>f(v-f(light.normal[i]*SOURCE_PARTICLE_LIGHTING_SKY_DISTANCE)))as[number,number,number];
  if(!(trace(point,to,{mask:0x4481,includeProps:!!(flags&4)}).surfaceFlags&4))return {weight:0,direction};
  return {weight:1,direction:light.normal.map(v=>-v)as[number,number,number]};
 }
 const delta=sub(light.origin,point);let weight=sourceWorldlightAttenuation(light,delta,!!(flags&2));
 if(!(flags&8))weight=f(weight*f(264*f(1/264))); // all original DustII styles are 0, whose installed default is 264
 if(light.type!==0&&f(Math.max(...light.intensity)*weight)<f(.0002))return {weight:0,direction};
 direction=sourceWorldlightDirection(delta);
 if(!(flags&1)){
  const result=trace(point,vec(light.origin),{mask:0x4481,includeProps:!!(flags&4)});
  if(f(length(delta)*f(1-f(result.fraction)))>8)weight=0;
 }
 return {weight,direction};
}
type CacheOptions={trace:SourceParticleLightingTrace;visible?:(light:SourceParticleWorldlight)=>boolean;skyCellSamples?:boolean};
/** Original static cold-cache path, r_worldlights=2, hardware >=2. Sky reserves
 * one slot. Lesser lights are folded into the ambient cube; selected lights
 * are evaluated again at the actual query position by GetLightForPoint. */
export function sourceParticleBuildLightCache(point:SourceParticleLightVec3,ambient:readonly (readonly number[])[],options:CacheOptions){
 const p=vec(point),cube=ambient.map(face=>face.map(f)),pending:{light:SourceParticleWorldlight;brightness:number}[]=[],cell=sourceParticleLightCell(p);
 const fold=(light:SourceParticleWorldlight,weight:number,direction:readonly number[])=>sourceWorldlightAddCube(cube,light,direction,f(weight*sourceWorldlightCone(light,direction)));
 for(const light of SOURCE_PARTICLE_WORLDLIGHTS){
  if(light.style!==0||light.flags&1||options.visible&&!options.visible(light))continue;
  const sphereRadius=length(sub(cell.max,p)),distance=length(sub(light.origin,p));
  if(light.type===0||light.type===2){
   if(distance>f(f(light.radius*(light.type===2?1000:1))+sphereRadius))continue;
   const cos=light.type===0?0:light.stopDot2,sin=light.type===0?1:f(Math.sin(f(Math.acos(cos))));
   if(!sphereCone(p,sphereRadius,light,sin,cos))continue;
  }
  if((light.type===1||light.type===2)&&boxDistance(cell.min,cell.max,light.origin)>f(f(light.radius*light.radius)*1000))continue;
  let {weight,direction}=sourceParticleLightAt(light,p,options.trace,light.type===3?6:2);
  if(light.type===3&&options.skyCellSamples){
   const corners=[[0,0,0],[1,0,0],[0,0,1],[0,1,0],[0,1,1],[1,1,0],[1,0,1],[1,1,1]];
   for(const corner of corners){const at=corner.map((v,i)=>(v?cell.max:cell.min)[i])as[number,number,number],sample=sourceParticleLightAt(light,at,options.trace,6);if(sample.weight>=weight)({weight,direction}=sample);}
  }
  if(weight<=0)continue;
  const brightness=f(luma(light)*weight);
  if(light.type!==0&&brightness<f(.0002)){fold(light,weight,direction);continue;}
  if(pending.length<2){
   pending.push({light,brightness});
   if(pending.length<2||pending.some(entry=>entry.light.type===3))continue;
   pending.pop(); // original slot reservation; do not silently discard this light
  }
  let weakest=-1,best=brightness;
  pending.forEach((entry,i)=>{if(best>entry.brightness){weakest=i;best=entry.brightness;}});
  if(weakest<0){fold(light,weight,direction);continue;}
  const previous=pending[weakest];pending[weakest]={light,brightness};
  const previousWeight=f(previous.brightness/luma(previous.light));
  fold(previous.light,previousWeight,previous.light.type===3?[0,0,0]:sourceWorldlightDirection(sub(previous.light.origin,p)));
 }
 return {cube,pending:pending.map(entry=>entry.light.id),point:p};
}
export function sourceParticleCompleteLightCache(cache:ReturnType<typeof sourceParticleBuildLightCache>,point:SourceParticleLightVec3,trace:SourceParticleLightingTrace){
 const cube=cache.cube.map(face=>face.slice()),p=vec(point);
 for(const id of cache.pending){const light=SOURCE_PARTICLE_WORLDLIGHTS[id],{weight,direction}=sourceParticleLightAt(light,p,trace,1);sourceWorldlightAddCube(cube,light,direction,f(weight*sourceWorldlightCone(light,direction)));}
 return {cube,color:sourceParticleLightQueryColor(cube)};
}
export type SourceParticleLightingOwner={tree:SourceParticleLightingTree;leafAt:(point:SourceParticleLightVec3)=>{leaf:number;contents:number};trace:SourceParticleLightingTrace;
 visibleWorldlight:(leaf:number,light:{cluster:number;type:number})=>boolean};
/** Map-scoped static particle CP query. Call once when an effect is born, not
 * once per rendered particle. The supplied trace/world and ambient owner are
 * borrowed. Dispose this CPU cache before changing either map owner.
 * Cold-cache placement/selection/arithmetic follow the executed native path;
 * browser cache eviction does not reproduce the engine's frame miss budget or
 * transient dynamic lights. No synthetic white/ambient-only fallback is used. */
export function createSourceParticleLighting(options:{lightingTrace:SourceParticleLightingOwner;sampleAmbient:(sourcePoint:SourceParticleLightVec3)=>{faces:readonly (readonly number[])[]}|null;skyCellSamples?:boolean}){
 const owner=options.lightingTrace,caches=new Map<string,ReturnType<typeof sourceParticleBuildLightCache>>();let disposed=false;
 const audit={queries:0,cacheMisses:0,cacheHits:0,cacheEntries:0,worldlights:SOURCE_PARTICLE_WORLDLIGHTS.length,skyCellSamples:options.skyCellSamples??false,
  boundary:'Original static worldlights, default lightstyles and cold-cache query; bounded browser CPU cache, no original transient frame budget/dynamic lights.'};
 function sampleSourcePosition(point:SourceParticleLightVec3):[number,number,number]{
  if(disposed)throw Error('Original particle lighting disposed');if(point.length!==3||!point.every(Number.isFinite))throw Error('Invalid original particle lighting position');
  const p=vec(point),leaf=owner.leafAt(p).leaf;
  // Original 0x564123 hash/equality coordinates use truncation + 32768;
  // unlike 0x55ddd0's placement bounds, negative exact boundaries differ.
  const key=[...p.map((v,i)=>(Math.trunc(v)+32768)>>(i===2?6:5)),leaf].join(',');
  let cache=caches.get(key);audit.queries++;
  if(cache){audit.cacheHits++;caches.delete(key);caches.set(key,cache);}
  else{
   audit.cacheMisses++;const center=sourceParticleLightCachePosition(p,owner),ambient=options.sampleAmbient(center);
   const faces=ambient?.faces??Array.from({length:6},()=>[0,0,0]);
   if(faces.length!==6||faces.some(face=>face.length!==3||!face.every(Number.isFinite)))throw Error('Invalid original particle ambient sample');
   cache=sourceParticleBuildLightCache(center,faces,{trace:owner.trace,visible:light=>owner.visibleWorldlight(leaf,light),skyCellSamples:audit.skyCellSamples});
   caches.set(key,cache);if(caches.size>512)caches.delete(caches.keys().next().value!);audit.cacheEntries=caches.size;
  }
  return sourceParticleCompleteLightCache(cache,p,owner.trace).color;
 }
 return {sampleSourcePosition,sampleWorldPosition(point:{x:number;y:number;z:number}){return sampleSourcePosition([point.x/.0254,-point.z/.0254,point.y/.0254]);},audit,
  dispose(){disposed=true;caches.clear();audit.cacheEntries=0;}};
}
