import * as T from 'three';
import {SOURCE_ROPES,type SourceRope} from './source-ropes';
import {findSourceLeaf,type SourceVisibilityIndex} from './source-visibility';
const f=Math.fround,SCALE=.0254,DT=f(.02),DAMP=f(.98),ACCEL=f(f(DT*DT)*.5),GRAVITY=-1500;
export type RopeLighting=(position:T.Vector3)=>readonly[number,number,number]|null;
function stepNodes(p:Float32Array,prev:Float32Array,a:readonly number[],b:readonly number[],spring:number,wind:readonly number[]){
 const count=p.length/3,springSq=f(spring*spring);
 for(let i=0;i<count;i++)for(let k=0;k<3;k++){
  const at=i*3+k,current=p[at],force=f((k===2?GRAVITY:0)+f((wind[k]??0)*10));
  p[at]=f(f(current+f(f(current-prev[at])*DAMP))+f(force*ACCEL));prev[at]=current;
 }
 for(let pass=0;pass<3;pass++){
  for(let i=0;i<count-1;i++){
   const at=i*3,next=at+3,dx=f(p[at]-p[next]),dy=f(p[at+1]-p[next+1]),dz=f(p[at+2]-p[next+2]);
   const sq=f(f(f(dx*dx)+f(dy*dy))+f(dz*dz));if(sq<=springSq||sq===0)continue;
   const factor=f(f(1-f(spring/f(Math.sqrt(sq))))*.5);
   for(let k=0;k<3;k++){const move=f((k===0?dx:k===1?dy:dz)*factor);p[at+k]=f(p[at+k]-move);p[next+k]=f(p[next+k]+move);}
  }
  p.set(a,0);p.set(b,(count-1)*3);
 }
}
/** Static map path: native server RecalculateLength 0x9cfda0 truncates
 * endpoint distance; the +Slack path 0x9d2c00 is gated by ROPE_RESIZE bit 0
 * at 0x9d2d1f/27. Dust2 spawnflags=0 never enables that path.
 * Native CBaseRopePhysics vtable 0x20c8930 -> ApplyConstraints 0xaa9180
 * uses THREE passes (0xaa918a), not CRopePhysics<10>'s ten-node capacity.
 * Native gravity is -1500 at 0x85c771; -1293 in FinishInit is a think sentinel.
 */
export function sourceRopeInitialNodes(start:readonly number[],end:readonly number[],slack:number,nodeCount=10){
 if(start.length!==3||end.length!==3||![...start,...end,slack].every(Number.isFinite)||!Number.isInteger(nodeCount)||nodeCount<2||nodeCount>10)
  throw Error('Invalid original rope endpoints');
 const a=start.map(f),b=end.map(f),p=new Float32Array(nodeCount*3),prev=new Float32Array(p.length);
 const delta=a.map((v,k)=>f(v-b[k]));
 const length=Math.trunc(f(Math.sqrt(f(f(f(delta[0]*delta[0])+f(delta[1]*delta[1]))+f(delta[2]*delta[2])))));
 const spring=f(Math.max(0,f((length+slack-100)/(nodeCount-1))));
 for(let i=0;i<nodeCount;i++)for(let k=0;k<3;k++)p[i*3+k]=f(a[k]+f(f(b[k]-a[k])*f(i/(nodeCount-1))));prev.set(p);
 // Original ROPE_INITIAL_HANG runs five seconds, at the original 50 Hz.
 for(let step=0;step<250;step++)stepNodes(p,prev,a,b,spring,[0,0,0]);
 return {positions:p,previous:prev,sourceLength:length,springLength:spring};
}
export function createSourceRopeMotion(start:readonly number[],end:readonly number[],slack:number,count=10){
 const initial=sourceRopeInitialNodes(start,end,slack,count),p=initial.positions.slice(),previous=initial.previous.slice();
 // Original five-second integration holds the next (251st) position while
 // rendering an interpolation close to step 250. Keep that look-ahead state.
 stepNodes(p,previous,start,end,initial.springLength,[0,0,0]);
 const saved=p.slice(),old=previous.slice(),predicted=initial.positions.slice();let time=5,steps=251;
 return {predicted,sourceLength:initial.sourceLength,
  reset(){p.set(saved);previous.set(old);predicted.set(initial.positions);time=5;steps=251;},
  moving(){for(let i=0;i<p.length;i+=3){const dx=p[i]-previous[i],dy=p[i+1]-previous[i+1],dz=p[i+2]-previous[i+2];if(dx*dx+dy*dy+dz*dz>.03)return true;}return false;},
  advance(dt:number,wind:readonly number[]){
   if(!Number.isFinite(dt)||dt<0||dt>300||wind.length!==3||!wind.every(Number.isFinite))throw Error('Invalid bounded Source rope frame');
   time+=f(dt);let count=0;while(steps*DT<time){stepNodes(p,previous,start,end,initial.springLength,wind);steps++;count++;}
   const alpha=f((time-(steps-1)*DT)/DT);for(let i=0;i<p.length;i++)predicted[i]=f(previous[i]+f(f(p[i]-previous[i])*alpha));
   return count;
  },
 };
}
export function sourceRopeSpline(nodes:Float32Array,subdiv=2){
 const count=nodes.length/3;if(count<2||!Number.isInteger(count)||!Number.isInteger(subdiv)||subdiv<0||subdiv>8)throw Error('Invalid rope spline');
 const points:number[]=[];
 for(let i=0;i<count-1;i++)for(let n=0;n<=subdiv;n++){
  const t=n/(subdiv+1),t2=t*t,t3=t2*t;
  for(let k=0;k<3;k++){
   const p0=nodes[Math.max(0,i-1)*3+k],p1=nodes[i*3+k],p2=nodes[(i+1)*3+k],p3=nodes[Math.min(count-1,i+2)*3+k];
   points.push(f(p1+.5*(-p0+p2)*t+.5*(2*p0-5*p1+4*p2-p3)*t2+.5*(-p0+3*p1-3*p2+p3)*t3));
  }
 }
 points.push(...nodes.subarray(nodes.length-3));return new Float32Array(points);
}

/** Conservatively visit every leaf touched by the rope's bounds. Endpoint-only
 * membership can remove a visible hanging span across a leaf boundary. */
function ropeLeaves(index:SourceVisibilityIndex,box:T.Box3){
 const low=[box.min.x/SCALE,-box.max.z/SCALE,box.min.y/SCALE],high=[box.max.x/SCALE,-box.min.z/SCALE,box.max.y/SCALE];
 const center=low.map((v,k)=>(v+high[k])/2),extent=low.map((v,k)=>(high[k]-v)/2),leaves=new Set<number>(),todo=[index.head];let visited=0;
 while(todo.length){const id=todo.pop()!;if(id<0){leaves.add(-1-id);continue;}
  if(++visited>index.nodes.length*2)throw Error('Invalid rope BSP traversal');
  const node=index.nodes[id],plane=index.planes[node.plane];
  const d=center.reduce((n,v,k)=>n+v*plane[k],-plane[3]),radius=extent.reduce((n,v,k)=>n+v*Math.abs(plane[k]),0);
  if(d>=-radius)todo.push(node.children[0]);if(d<=radius)todo.push(node.children[1]);
 }
 return [...leaves];
}

type Span={rope:SourceRope;end:readonly number[];motion:ReturnType<typeof createSourceRopeMotion>;points:Float32Array;sourceLength:number;leaves:number[];clusters:number[];sky:boolean;offset:number;count:number;first:number};
export function createSourceRopesRender(options:{texture:T.Texture;visibility:SourceVisibilityIndex;skyLeafIds?:readonly number[]}){
 const index=options.visibility;if(!index.valid)throw Error('Original rope visibility unavailable');
 const textureHeight=(options.texture.image as {height:number}).height;if(!(textureHeight>0))throw Error('Original rope texture height unavailable');
 const spans:Span[]=[],skyLeaves=new Set(options.skyLeafIds??[]);
 for(const rope of SOURCE_ROPES.ropes){if(!rope.nextKey)continue;
  const end=SOURCE_ROPES.byName.get(rope.nextKey)!,motion=createSourceRopeMotion(rope.origin,end.origin,rope.slack,rope.type===0?10:rope.type===1?4:2);
  const points=sourceRopeSpline(motion.predicted,rope.subdiv),box=new T.Box3();
  for(let i=0;i<points.length;i+=3)box.expandByPoint(new T.Vector3(points[i]*SCALE,points[i+2]*SCALE,-points[i+1]*SCALE));
  box.expandByScalar(rope.width*SCALE);const leaves=ropeLeaves(index,box),clusters=[...new Set(leaves.map(l=>index.leafClusters[l]))];
  spans.push({rope,end:end.origin,motion,points,sourceLength:motion.sourceLength,leaves,clusters,sky:leaves.some(l=>skyLeaves.has(l))&&leaves.every(l=>skyLeaves.has(l)||index.leafClusters[l]<0),offset:0,count:0,first:0});
 }
 if(spans.length!==120)throw Error('Original rope network coverage differs');
 const world=new T.Group(),sky=new T.Group();world.name='Source_Original_Ropes';sky.name='Source_Original_Sky_Ropes';
 const material=new T.MeshBasicMaterial({map:options.texture,vertexColors:true,transparent:true,depthWrite:false,side:T.DoubleSide});
 material.name='cable/nuke_cable / original spline ribbon';
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
    attribute vec3 sourceRopeTangent;attribute float sourceRopeWidth;`)
   .replace('#include <begin_vertex>',`#include <begin_vertex>
    vec3 ropeView=cameraPosition-position;
    vec3 ropeSide=cross(sourceRopeTangent,ropeView);
    float ropeSideLength=length(ropeSide);
    if(ropeSideLength<0.000001)ropeSide=cross(sourceRopeTangent,vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]));
    transformed+=normalize(ropeSide)*sourceRopeWidth;`);
 };
 material.customProgramCacheKey=()=> 'source-rope-camera-ribbon-r1';
 const batches:{geometry:T.BufferGeometry;mesh:T.Mesh;spans:Span[];indices:Uint32Array}[]=[];
 for(const isSky of [false,true]){
  const selected=spans.filter(s=>s.sky===isSky);if(!selected.length)continue;
  const position:number[]=[],tangent:number[]=[],width:number[]=[],uv:number[]=[],colors:number[]=[],indices:number[]=[];
  for(const span of selected){const points=span.points,n=points.length/3,first=position.length/3;span.offset=indices.length;span.first=first;
   const uvStep=(4/span.rope.textureScale)*(span.sourceLength+span.rope.slack-100)/(((10-1)*span.rope.subdiv+1)*textureHeight);
   for(let i=0;i<n;i++){
    const at=i*3,prev=Math.max(0,i-1)*3,next=Math.min(n-1,i+1)*3;
    const point=[points[at]*SCALE,points[at+2]*SCALE,-points[at+1]*SCALE];
    const direction=[points[next]-points[prev],points[next+2]-points[prev+2],-(points[next+1]-points[prev+1])];
    for(const side of [-1,1]){position.push(...point);tangent.push(...direction);width.push(side*span.rope.width*SCALE*.5);uv.push((side+1)/2,i*uvStep);colors.push(1,1,1);}
    if(i<n-1){const a=first+i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
   }
   span.count=indices.length-span.offset;
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(position,3).setUsage(T.DynamicDrawUsage));
  geometry.setAttribute('sourceRopeTangent',new T.Float32BufferAttribute(tangent,3).setUsage(T.DynamicDrawUsage));geometry.setAttribute('sourceRopeWidth',new T.Float32BufferAttribute(width,1));
  geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  geometry.setIndex(new T.BufferAttribute(new Uint32Array(indices),1).setUsage(T.DynamicDrawUsage));geometry.computeBoundingSphere();
  const mesh=new T.Mesh(geometry,material);mesh.name=isSky?'Source_Ropes_Sky_Batch':'Source_Ropes_World_Batch';
  mesh.userData={sourceRopeIds:selected.map(s=>s.rope.hammerId),sourceOriginalSpans:selected.length};(isSky?sky:world).add(mesh);
  batches.push({geometry,mesh,spans:selected,indices:new Uint32Array(indices)});
 }
 let disposed=false,cluster:number|undefined,windEpoch:string|null=null,windTime=0,simulatedTime=0,wind:[number,number,number]=[0,0,0],resetMotion=false;
 const audit={entities:142,spans:120,chainEnds:22,nodes:1200,
  splinePoints:spans.reduce((n,s)=>n+s.points.length/3,0),triangles:batches.reduce((n,b)=>n+b.indices.length/3,0),
  worldSpans:spans.filter(s=>!s.sky).length,skySpans:spans.filter(s=>s.sky).length,drawCalls:batches.length,
  lightingBound:false,windBound:false,windSource:[0,0,0],windTime:0,physicsSteps:0,activeSpans:0,visibleWorldSpans:spans.filter(s=>!s.sky).length,
  limitations:['Uses the original Dust2 env_wind field; zero-global-wind random gusts, external impulses and rope_shake debug mode are not enabled.',
   'Camera-facing WebGL ribbon uses original width/UV/texture; native SplineRope AA screen-width smoothing is not reproduced.',
   'Float32 solver uses JS sqrt rather than original x86 rsqrtss refinement; not claimed bit-identical.']};
 return {world,sky,audit,
  setWind(value:readonly number[],levelTime:number,epoch:string){
   if(disposed)throw Error('Original rope owner disposed');
   if(value.length!==3||!value.every(Number.isFinite)||!Number.isFinite(levelTime)||levelTime<0||!epoch||
     (epoch===windEpoch&&levelTime<windTime)||levelTime-(epoch===windEpoch?windTime:0)>300)throw Error('Invalid original rope wind clock');
   if(epoch!==windEpoch){windEpoch=epoch;simulatedTime=levelTime;resetMotion=true;}
   wind=[f(value[0]),f(value[1]),f(value[2])];windTime=levelTime;audit.windBound=true;audit.windSource=[...wind];audit.windTime=levelTime;
  },
  setLighting(sample:RopeLighting){if(disposed)throw Error('Original rope owner disposed');
   const pos=new T.Vector3();for(const b of batches){const p=b.geometry.getAttribute('position'),c=b.geometry.getAttribute('color');
    for(let i=0;i<p.count;i+=2){pos.fromBufferAttribute(p,i);const value=sample(pos);if(value){c.setXYZ(i,...value);c.setXYZ(i+1,...value);}}
    c.needsUpdate=true;
   }audit.lightingBound=true;
  },
  update(camera:T.PerspectiveCamera,enabled=true){if(disposed)throw Error('Original rope owner disposed');
   const dt=windTime-simulatedTime;simulatedTime=windTime;let moving=0;
   const eye=[camera.position.x/SCALE,-camera.position.z/SCALE,camera.position.y/SCALE];
   for(const b of batches){let changed=false;const position=b.geometry.getAttribute('position'),tangent=b.geometry.getAttribute('sourceRopeTangent');
    for(const span of b.spans){
     if(resetMotion)span.motion.reset();
     const a=span.rope.origin,d=span.end.map((v,k)=>v-a[k]),sq=d.reduce((n,v)=>n+v*v,0),t=Math.max(0,Math.min(1,d.reduce((n,v,k)=>n+(eye[k]-a[k])*v,0)/sq));
     const near=eye.reduce((n,v,k)=>n+(v-a[k]-d[k]*t)**2,0)<1000*1000;
     const animate=dt>0&&(near||span.motion.moving());if(!resetMotion&&!animate)continue;
     if(animate){moving++;audit.physicsSteps+=span.motion.advance(dt,near?wind:[0,0,0]);}
     const points=sourceRopeSpline(span.motion.predicted,span.rope.subdiv);span.points=points;const box=new T.Box3();
     for(let i=0;i<points.length/3;i++){
      const at=i*3,prev=Math.max(0,i-1)*3,next=Math.min(points.length/3-1,i+1)*3;
      const x=points[at]*SCALE,y=points[at+2]*SCALE,z=-points[at+1]*SCALE;box.expandByPoint(new T.Vector3(x,y,z));
      for(let side=0;side<2;side++){const vertex=span.first+i*2+side;position.setXYZ(vertex,x,y,z);
       tangent.setXYZ(vertex,points[next]-points[prev],points[next+2]-points[prev+2],-(points[next+1]-points[prev+1]));}
     }
     box.expandByScalar(span.rope.width*SCALE);span.leaves=ropeLeaves(index,box);span.clusters=[...new Set(span.leaves.map(l=>index.leafClusters[l]))];changed=true;
    }
    if(changed){position.needsUpdate=true;tangent.needsUpdate=true;b.geometry.computeBoundingSphere();cluster=undefined;}
   }
   resetMotion=false;audit.activeSpans=moving;
   const where=findSourceLeaf(index,camera.position),key=enabled&&!where.boundary?where.cluster:-1;if(key===cluster)return;cluster=key;
   const row=key>=0?index.rows[key]:null;let visible=0;
   for(const b of batches){if(b.spans[0].sky)continue;let n=0;const idx=b.geometry.index!;
    for(const span of b.spans)if(!row||span.clusters.some(c=>c<0||(row[c>>3]&(1<<(c&7))))){
     for(let i=span.offset;i<span.offset+span.count;i++)idx.setX(n++,b.indices[i]);visible++;
    }
    idx.needsUpdate=true;b.geometry.setDrawRange(0,n);b.mesh.visible=n>0;
   }audit.visibleWorldSpans=visible;
  },
  dispose(){if(disposed)return;disposed=true;world.removeFromParent();sky.removeFromParent();world.clear();sky.clear();for(const b of batches)b.geometry.dispose();material.dispose();},
 };
}
