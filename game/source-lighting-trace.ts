/** Independent original lighting trace contract. No gameplay role mask is used.
 * World brush planes/texinfo come from BSP; only original displacement and
 * optionally static-prop PHY intersections borrow the existing Rapier world. */
import RAPIER from '@dimforge/rapier3d-compat';
import {SOURCE_LIGHTING_TRACE_ASSET} from './source-lighting-trace-data';
import {SOURCE_LIGHTING_VISIBILITY_ASSET} from './source-lighting-trace-visibility-data';
import {prepareSourceLightingVisibility,type SourceLightingVisibilityData} from './source-lighting-trace-visibility';
import {sourceSha256} from './source-sha256';
import type {attachSourceMapCollision} from './source-map-collision';
export type SourceLightingPoint=readonly [number,number,number];
export type SourceLightingTree={readonly head:number;readonly planes:readonly (readonly [number,number,number,number])[];
  readonly nodes:readonly {readonly plane:number;readonly children:readonly [number,number]}[];readonly leafContents:readonly number[]};
type Brush={id:number;contents:number;sides:number[][];bounds:[number[],number[]]};
type Displacement={key:string;geometry:number;contents:number;ranges:[number,number,number][]};
export type SourceLightingTraceData={format:'source-lighting-trace-v1';build:12426148;sourceBspSha256:string;collisionSha256:string;
  tree:SourceLightingTree;brushes:Brush[];displacements:Displacement[];props:{model:string;contents:number;mdlSha256:string}[];
  evidence?:unknown;limitations:string[];visibility?:SourceLightingVisibilityData};
export type SourceLightingTraceResult={fraction:number;surfaceFlags:number;startSolid?:boolean;allSolid?:boolean;
  source?:{layer:string;brush?:number;side?:number;geometry?:number;prop?:number;contents:number}};
export type SourceLightingTraceOptions={mask?:0x4081|0x4481;includeProps?:boolean};
type BVH={bounds:[number[],number[]];left?:BVH;right?:BVH;brushes?:Brush[]};
const EPSILON=.03125,f=Math.fround;
const dot=(p:readonly number[],v:readonly number[])=>f(f(f(p[0]*v[0])+f(p[1]*v[1]))+f(p[2]*v[2]));
function point(p:SourceLightingPoint):[number,number,number]{if(p.length!==3||!p.every(Number.isFinite))throw Error('Invalid original lighting trace point');return [f(p[0]),f(p[1]),f(p[2])];}
function bvh(brushes:Brush[]):BVH{
 const bounds:[number[],number[]]=[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]];
 for(const b of brushes)for(let i=0;i<3;i++){bounds[0][i]=Math.min(bounds[0][i],b.bounds[0][i]);bounds[1][i]=Math.max(bounds[1][i],b.bounds[1][i]);}
 if(brushes.length<=8)return {bounds,brushes};
 const spans=bounds[0].map((v,i)=>bounds[1][i]-v),axis=spans.indexOf(Math.max(...spans));
 const ordered=brushes.slice().sort((a,b)=>a.bounds[0][axis]+a.bounds[1][axis]-b.bounds[0][axis]-b.bounds[1][axis]||a.id-b.id),mid=ordered.length>>1;
 return {bounds,left:bvh(ordered.slice(0,mid)),right:bvh(ordered.slice(mid))};
}
function boundsHit(bounds:BVH['bounds'],from:readonly number[],delta:readonly number[],until:number){
 let start=0,end=until;
 for(let i=0;i<3;i++){
  const low=bounds[0][i]-EPSILON,high=bounds[1][i]+EPSILON;
  if(delta[i]===0){if(from[i]<low||from[i]>high)return false;continue;}
  let a=(low-from[i])/delta[i],b=(high-from[i])/delta[i];if(a>b)[a,b]=[b,a];start=Math.max(start,a);end=Math.min(end,b);if(start>end)return false;
 }
 return true;
}
/** Halfspace clipping of the original brush. The Source 1/32-unit entry/exit
 * margin is retained; full native CM rounding/order equivalence is not claimed. */
export function sourceLightingClipBrush(brush:Brush,planes:SourceLightingTree['planes'],from:SourceLightingPoint,to:SourceLightingPoint):SourceLightingTraceResult|null{
 let enter=-1,leave=1,startOut=false,endOut=false,hitSide:number[]|undefined;
 for(const side of brush.sides){
  const p=planes[side[0]],a=f(dot(p,from)-p[3]),b=f(dot(p,to)-p[3]);
  startOut||=a>0;endOut||=b>0;
  if(a>0&&b>=a)return null;if(a<=0&&b<=0)continue;
  if(a>b){const fraction=f(f(a-EPSILON)/f(a-b));if(fraction>enter){enter=fraction;hitSide=side;}}
  else leave=Math.min(leave,f(f(a+EPSILON)/f(a-b)));
 }
 if(!startOut)return endOut?{fraction:1,surfaceFlags:0,startSolid:true}:{fraction:0,surfaceFlags:0,startSolid:true,allSolid:true,source:{layer:'brush',brush:brush.id,contents:brush.contents}};
 if(enter<leave&&enter>-1&&enter<1&&hitSide)return {fraction:Math.max(0,enter),surfaceFlags:hitSide[1],source:{layer:'brush',brush:brush.id,side:hitSide[2],contents:brush.contents}};
 return null;
}
function validate(data:SourceLightingTraceData){
 if(data.format!=='source-lighting-trace-v1'||data.build!==12426148)throw Error('Original lighting trace identity differs');
 const {planes,nodes,leafContents,head}=data.tree;
 if(!Number.isInteger(head)||head<0||head>=nodes.length||!leafContents.length)throw Error('Original lighting tree root differs');
 for(const p of planes)if(p.length!==4||!p.every(Number.isFinite))throw Error('Original lighting plane differs');
 for(const n of nodes)if(!Number.isInteger(n.plane)||!planes[n.plane]||n.children.length!==2||n.children.some(c=>!Number.isInteger(c)||c< -leafContents.length||c>=nodes.length))throw Error('Original lighting tree reference differs');
 for(const b of data.brushes)if(!Number.isInteger(b.contents)||!(b.contents&0x4481)||!b.sides.length||b.sides.some(s=>!planes[s[0]]||!Number.isInteger(s[1]))||b.bounds.some(row=>row.length!==3||!row.every(Number.isFinite)))throw Error('Original lighting brush differs');
}
/** Caller owns the world and original collider metadata for this map. This
 * adapter creates no physics resources, modifies no roles and needs no step. */
export function createSourceLightingTrace(data:SourceLightingTraceData,physics?:{world:RAPIER.World;map:Pick<ReturnType<typeof attachSourceMapCollision>,'metadata'>}){
 validate(data);const visibility=data.visibility?prepareSourceLightingVisibility(data.visibility):null;
 if(data.visibility&&(data.visibility.sourceBspSha256!==data.sourceBspSha256||data.visibility.leafClusters.length!==data.tree.leafContents.length))throw Error('Original lighting leaf/PVS map differs');
 const tree={...data.tree,leafClusters:data.visibility?.leafClusters,leafFlags:data.visibility?.leafFlags},index=bvh(data.brushes),displacements=new Map(data.displacements.map(d=>[d.key,d]));
 const propContents=new Map(data.props.map(p=>[p.model,p.contents]));let disposed=false;
 const metaByHandle=new Map<number,{contents:number;layer:'displacement'|'propPhy';geometry:number;prop?:number;ranges?:Displacement['ranges']}>();
 for(const [handle,m] of physics?.map.metadata??[]){
  if(m.sensor)continue;const s=m.source;
  if(s.layer==='displacement'){
   const key=[...(s.grid as number[]),s.contents].join(','),d=displacements.get(key);
   if(!d||d.geometry!==m.geometry||d.contents!==s.contents)throw Error('Original lighting displacement mapping differs');
   metaByHandle.set(handle,{layer:'displacement',contents:d.contents,geometry:m.geometry,ranges:d.ranges});
  }else if(s.layer==='propPhy'){
   const contents=propContents.get(String(s.model));if(contents===undefined)throw Error('Original lighting prop contents missing');
   metaByHandle.set(handle,{layer:'propPhy',contents,geometry:m.geometry,prop:Number(s.prop)});
  }
 }
 return {tree,audit:{sourceBspSha256:data.sourceBspSha256,collisionSha256:data.collisionSha256,worldBrushes:data.brushes.length,
   skySides:data.brushes.reduce((n,b)=>n+b.sides.filter(s=>s[1]&4).length,0),physics:!!physics,visibility:!!visibility,limitations:data.limitations.slice()},
  visibleWorldlight(leaf:number,light:{cluster:number;type:number}){
   if(disposed)throw Error('Original lighting trace disposed');if(!visibility)throw Error('Original lighting PVS is unavailable');
   return visibility.visibleWorldlight(leaf,light);
  },
  leafAt(sourcePoint:SourceLightingPoint){
   if(disposed)throw Error('Original lighting trace disposed');const p=point(sourcePoint);let node=tree.head,steps=0;
   while(node>=0){if(++steps>tree.nodes.length)throw Error('Original lighting tree cycle');const n=tree.nodes[node],plane=tree.planes[n.plane];node=n.children[f(dot(plane,p)-plane[3])>=0?0:1];}
   const leaf=-node-1;return {leaf,contents:tree.leafContents[leaf],cluster:tree.leafClusters?.[leaf],flags:tree.leafFlags?.[leaf]};
  },
  trace(sourceFrom:SourceLightingPoint,sourceTo:SourceLightingPoint,options:SourceLightingTraceOptions={}):SourceLightingTraceResult{
   if(disposed)throw Error('Original lighting trace disposed');const from=point(sourceFrom),to=point(sourceTo),mask=options.mask??0x4481;
   if(mask!==0x4481&&mask!==0x4081)throw Error('Unverified original lighting mask');
   const delta=to.map((v,i)=>f(v-from[i]));let result:SourceLightingTraceResult={fraction:1,surfaceFlags:0},startSolid=false;
   const pending=[index];
   while(pending.length){const node=pending.pop()!;if(!boundsHit(node.bounds,from,delta,result.fraction))continue;
    if(node.brushes)for(const brush of node.brushes){if(!(brush.contents&mask))continue;const hit=sourceLightingClipBrush(brush,tree.planes,from,to);if(!hit)continue;
     startSolid||=!!hit.startSolid;if(hit.fraction<result.fraction)result=hit;
    }else pending.push(node.right!,node.left!);
   }
   if(physics&&result.fraction>0){
    // Ray direction is the complete segment, so Rapier timeOfImpact is the
    // dimensionless fraction, independent of the Source->metre axis transform.
    const ray=new RAPIER.Ray({x:from[0]*.0254,y:from[2]*.0254,z:-from[1]*.0254},{x:delta[0]*.0254,y:delta[2]*.0254,z:-delta[1]*.0254});
    const hit=physics.world.castRayAndGetNormal(ray,result.fraction,true,RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,undefined,undefined,undefined,c=>{
     const m=metaByHandle.get(c.handle);return !!m&&!!(m.contents&mask)&&(m.layer==='displacement'||options.includeProps===true);
    });
    if(hit&&hit.timeOfImpact<result.fraction){
     const m=metaByHandle.get(hit.collider.handle)!;let flags=0;
     if(m.ranges){
      const triangle=hit.featureId;let at=0,found=false;
      if(triangle===undefined)throw Error('Original lighting displacement triangle is unavailable');
      for(const [count,surfaceFlags] of m.ranges){if(triangle>=at&&triangle<at+count){flags=surfaceFlags;found=true;break;}at+=count;}
      if(!found)throw Error('Original lighting displacement face index differs');
     }
     result={fraction:hit.timeOfImpact,surfaceFlags:flags,source:{layer:m.layer,geometry:m.geometry,prop:m.prop,contents:m.contents}};
    }
   }
   if(startSolid)result.startSolid=true;return result;
  },dispose(){disposed=true;metaByHandle.clear();},
 };
}
export async function loadSourceLightingTrace(options:{world:RAPIER.World;map:Pick<ReturnType<typeof attachSourceMapCollision>,'metadata'>;baseURL?:string;signal?:AbortSignal}){
 const base=new URL(options.baseURL??'/source/csgo-12426148/fidelity-world-20260913/lighting-trace/',globalThis.location?.href??'http://127.0.0.1/');
 const response=await fetch(new URL(SOURCE_LIGHTING_TRACE_ASSET.file,base),{signal:options.signal});if(!response.ok)throw Error('Original lighting trace HTTP '+response.status);
 const bytes=await response.arrayBuffer();if(bytes.byteLength!==SOURCE_LIGHTING_TRACE_ASSET.bytes||await sourceSha256(new Uint8Array(bytes))!==SOURCE_LIGHTING_TRACE_ASSET.sha256)throw Error('Original lighting trace SHA differs');
 const data:SourceLightingTraceData=JSON.parse(new TextDecoder().decode(bytes));
 if(data.sourceBspSha256!==SOURCE_LIGHTING_TRACE_ASSET.sourceBspSha256||data.collisionSha256!==SOURCE_LIGHTING_TRACE_ASSET.collisionSha256)throw Error('Original lighting map identity differs');
 const pvsResponse=await fetch(new URL(SOURCE_LIGHTING_VISIBILITY_ASSET.file,base),{signal:options.signal});if(!pvsResponse.ok)throw Error('Original lighting PVS HTTP '+pvsResponse.status);
 const pvsBytes=new Uint8Array(await pvsResponse.arrayBuffer());
 if(pvsBytes.byteLength!==SOURCE_LIGHTING_VISIBILITY_ASSET.bytes||await sourceSha256(pvsBytes)!==SOURCE_LIGHTING_VISIBILITY_ASSET.sha256)throw Error('Original lighting PVS SHA differs');
 data.visibility=JSON.parse(new TextDecoder().decode(pvsBytes));
 return createSourceLightingTrace(data,options);
}
