import {Group,SRGBColorSpace,TextureLoader,Vector3,type Texture} from 'three';
import {decodeSourcePistolParticleSheet,prepareSourcePistolParticleGraph,type SourceParticleNativeDefaults} from './source-pistol-particles-graph';
import {createSourcePistolParticleProgram,sampleSourcePistolParticles,sourcePistolParticleSheetFrame,type SourcePistolParticle} from './source-pistol-particles';
import {configureSourceParticleTexture,createSourceSpriteCardBatch} from './source-sprite-card';
import resources from './source-pistol-particle-resources.json';
import {sourceSha256} from './source-sha256';
import {createSourcePistolParticleClock} from './source-pistol-particles-clock';
import type {SourcePistolParticleSeeds} from './source-pistol-particles-random';

export type SourcePistolParticleMuzzle={position:{x:number;y:number;z:number};forward:{x:number;y:number;z:number}};
/** The original `particle_muzzleflash4.vmt` is additive, and the original
 * `fire_particle_4.vmt` is addself with overbright 6. */
function batch(texture:Texture,core:boolean,capacity:number,unit:number){
 return createSourceSpriteCardBatch({name:core?'original-pistol-core':'original-pistol-main',texture,capacity,
  additive:!core,addSelf:core?1:0,overbright:core?6:1,depthBlend:core,sourceUnitMetres:unit});
}

/** Caller adds group to the same world as the already-converted muzzle pose.
 * Position is in world metres, forward is attachment +X. Source units are
 * converted once (.0254); do not put the group below the scaled viewmodel. */
export async function loadSourcePistolParticleRenderer(baseUrl:string,options:{capacity?:number;sourceUnitMetres?:number;signal?:AbortSignal}={}){
 const capacity=options.capacity??128,unit=options.sourceUnitMetres??.0254,signal=options.signal;
 if(!Number.isInteger(capacity)||capacity<12||capacity>4096||!Number.isFinite(unit)||unit<=0)throw Error('Invalid pistol particle renderer capacity/units');
 const base=baseUrl.endsWith('/')?baseUrl:baseUrl+'/',hashVerified:Record<string,boolean>={};
 const bytes=async(name:string)=>{
  const row=resources.find(r=>r.path===name);if(!row)throw Error('Unverified original particle resource '+name);
  const r=await fetch(base+name,{signal});if(!r.ok)throw Error('Original pistol particles HTTP '+r.status+' '+name);
  const b=new Uint8Array(await r.arrayBuffer());
  if(b.byteLength!==row.bytes||await sourceSha256(b,signal)!==row.sha256)throw Error('Original pistol particles SHA mismatch '+name);
  hashVerified[name]=true;return b;
 },json=async(name:string)=>JSON.parse(new TextDecoder().decode(await bytes(name)));
 const [raw,native]=await Promise.all([json('graph.json'),json('native-defaults.json')]);
 const graph=prepareSourcePistolParticleGraph(raw),program=createSourcePistolParticleProgram(graph,native as SourceParticleNativeDefaults);
 const main=graph.data.textures.find(t=>t.source==='materials/effects/muzzleflash4.vtf')!,core=graph.data.textures.find(t=>t.source==='materials/particle/fire_particle_4/fire_particle_4.vtf')!;
 if(!main||!core)throw Error('Original main/core textures absent');
 const resource=core.resources.find(r=>r.sheetFile)?.sheetFile;if(!resource)throw Error('Original fire sheet absent');
 const sheet=decodeSourcePistolParticleSheet(await bytes(resource.path)),loader=new TextureLoader(),textures:Texture[]=[];
 try{
  const loaded=await Promise.allSettled([main,core].map(async(t,index)=>{
   const data=await bytes(t.images[0].file.path),url=URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>],{type:'image/png'}));
   try{const texture=await loader.loadAsync(url);textures[index]=texture;
    configureSourceParticleTexture(texture,SRGBColorSpace);
   }finally{URL.revokeObjectURL(url);}
  }));
  for(const result of loaded)if(result.status==='rejected')throw result.reason;
  signal?.throwIfAborted();
 }catch(error){textures.forEach(t=>t.dispose());throw error;}
 const batches={main:batch(textures[0],false,capacity,unit),core:batch(textures[1],true,capacity,unit)},group=new Group();group.name='original-pistol-main-core';group.add(batches.main.mesh,batches.core.mesh);
 const bursts:{born:number;lastUpdate:number;clocks:Record<'main'|'core',ReturnType<typeof createSourcePistolParticleClock>>;particles:SourcePistolParticle[];origin:Vector3;forward:Vector3}[]=[];
 let disposed=false;
 return {group,program,graph,sheet,hashVerified,
  /** The root runtime owns suppressed/un-suppressed choice and authoritative
   * fire events. This API renders weapon_muzzle_flash_pistol main/core only. */
  fire(muzzle:SourcePistolParticleMuzzle,nowSeconds:number,random?:(()=>number)|SourcePistolParticleSeeds){
   if(disposed)throw Error('Pistol particle renderer disposed');
   const origin=new Vector3().copy(muzzle.position),forward=new Vector3().copy(muzzle.forward);
   if(!Number.isFinite(nowSeconds)||![...origin.toArray(),...forward.toArray()].every(Number.isFinite)||forward.lengthSq()<1e-10)throw Error('Invalid original muzzle transform');
   forward.normalize();bursts.push({born:nowSeconds,lastUpdate:nowSeconds,clocks:{main:createSourcePistolParticleClock('main'),core:createSourcePistolParticleClock('core')},particles:program.emit(random),origin,forward});
   // Capacity is explicit and observable; never silently turn excess shots
   // into a generic replacement effect.
   return bursts.length;
  },
  update(nowSeconds:number){
   if(disposed)throw Error('Pistol particle renderer disposed');
   if(!Number.isFinite(nowSeconds))throw Error('Invalid pistol particle clock');
   const counts={main:0,core:0},proof=[];let dropped=0;
   for(let i=bursts.length-1;i>=0;i--)if(Object.values(bursts[i].clocks).every(c=>c.snapshot().time>.1))bursts.splice(i,1);
   for(const burst of bursts){
    // Repeated same-time updates do not consume the native first-frame gate.
    if(nowSeconds<burst.lastUpdate){for(const clock of Object.values(burst.clocks))clock.reset();burst.lastUpdate=burst.born;}
    const delta=Math.max(0,nowSeconds-burst.lastUpdate);burst.lastUpdate=nowSeconds;
    for(const clock of Object.values(burst.clocks))clock.advance(delta);
    for(const system of ['main','core']as const)for(const p of sampleSourcePistolParticles(burst.particles.filter(p=>p.system===system),burst.clocks[system].snapshot().time)){
    const b=batches[p.system],index=counts[p.system];if(index>=capacity){dropped++;continue;}counts[p.system]++;
    const position=burst.origin.clone().addScaledVector(burst.forward,p.distance*unit);
    b.set('particleCenter',index,position.toArray());b.set('particleRadius',index,[p.currentRadius*unit]);b.set('particleRotation',index,[p.rotation]);b.set('particleTint',index,[...p.color,p.currentAlpha]);
    const frame=p.system==='core'?sourcePistolParticleSheetFrame(sheet,p.sequence,p.age,program.animationRates.core):{uv0:[0,0,1,1],uv1:[0,0,1,1],blend:0,index:0,resolvedSequence:0};
    b.set('particleUV0',index,frame.uv0);b.set('particleUV1',index,frame.uv1);b.set('particleBlend',index,[frame.blend]);
    proof.push({id:p.id,system:p.system,age:p.age,position:position.toArray(),radius:p.currentRadius*unit,alpha:p.currentAlpha,frame:frame.index,sequence:frame.resolvedSequence});
   }
   }
   batches.main.finish(counts.main);batches.core.finish(counts.core);return {counts,dropped,particles:proof,clocks:bursts.map(b=>({main:b.clocks.main.snapshot(),core:b.clocks.core.snapshot()}))};
  },
  clear(){bursts.length=0;batches.main.finish(0);batches.core.finish(0);},
  dispose(){if(disposed)return;disposed=true;bursts.length=0;group.removeFromParent();batches.main.dispose();batches.core.dispose();textures.forEach(t=>t.dispose());},
 };
}
