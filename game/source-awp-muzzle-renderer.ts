/** The original AWP third-person muzzle drawn in the world.
 *
 * `weapon_muzzle_flash_awp` adds the hunting rifle's continuous flame and that flame's
 * glow. The flame is nine sprites over 7.5 ms swept along the effect's own local +X from
 * the particle's birth time, drawn with `fire_particle_4.vmt` (addself, overbright 6) from
 * that texture's sheet; the glow is three additive sprites of `particle_glow_04` with the
 * original `Color Fade`. Both original programs, the original graph and the original
 * textures are fetched by name and SHA-256; nothing here is guessed from a name.
 *
 * A burst holds its own world anchor for its whole life, which is what lets the asserted
 * full `Movement Lock to Control Point` be a no-op: it can only follow a control point,
 * and this port's control point does not move.
 */
import {Group,SRGBColorSpace,TextureLoader,Vector3,type Texture} from 'three';
import {decodeSourcePistolParticleSheet,prepareSourcePistolParticleGraph,type SourceParticleFile,type SourceParticleNativeDefaults} from './source-pistol-particles-graph';
import {sourcePistolParticleSheetFrame} from './source-pistol-particles';
import {configureSourceParticleTexture,createSourceSpriteCardBatch} from './source-sprite-card';
import {createSourceAwpMuzzleFlameProgram,createSourceAwpMuzzleGlowProgram,SOURCE_AWP_MUZZLE_FLAME_TEXTURE,SOURCE_AWP_MUZZLE_GLOW_TEXTURE,sampleSourceAwpMuzzleParticles,type SourceAwpMuzzleParticle,type SourceAwpMuzzleSeeds} from './source-rifle-muzzle-particles';
import resources from './source-muzzle-particle-resources.json';
import {sourceSha256} from './source-sha256';
import {loadSourceMuzzleChildrenRenderer} from './source-muzzle-children-renderer';

/** The world weapon's own muzzle frame: where the effect sits, which way its local +X
 * points, and (when the caller has it) which way its local +Y points. Source's particle
 * space is +X forward, +Y left, +Z up, so the lateral part of a spawn offset needs both. */
export type SourceAwpMuzzleAnchor={position:{x:number;y:number;z:number};forward:{x:number;y:number;z:number};
  up?:{x:number;y:number;z:number};sourcePosition?:[number,number,number];worldForward?:{x:number;y:number;z:number};worldUp?:{x:number;y:number;z:number}};

type Burst={born:number;lastUpdate:number;time:number;origin:Vector3;forward:Vector3;side:Vector3;up:Vector3;
  flame:SourceAwpMuzzleParticle[];glow:SourceAwpMuzzleParticle[]};
type LoadedTexture={texture:Texture;sheetFile:SourceParticleFile|null};

export async function loadSourceAwpMuzzleRenderer(baseUrl:string,options:{capacity?:number;sourceUnitMetres?:number;signal?:AbortSignal}={}){
 const capacity=options.capacity??64,unit=options.sourceUnitMetres??.0254,signal=options.signal;
 if(!Number.isInteger(capacity)||capacity<4||capacity>2048||!Number.isFinite(unit)||unit<=0)
  throw Error('Invalid AWP muzzle renderer capacity/units');
 const base=baseUrl.endsWith('/')?baseUrl:baseUrl+'/',hashVerified:Record<string,boolean>={};
 const bytes=async(name:string)=>{
  const row=resources.find(r=>r.path===name);if(!row)throw Error('Unverified original AWP muzzle resource '+name);
  const r=await fetch(base+name,{signal});if(!r.ok)throw Error('Original AWP muzzle HTTP '+r.status+' '+name);
  const b=new Uint8Array(await r.arrayBuffer());
  if(b.byteLength!==row.bytes||await sourceSha256(b,signal)!==row.sha256)throw Error('Original AWP muzzle SHA mismatch '+name);
  hashVerified[name]=true;return b;
 },json=async(name:string)=>JSON.parse(new TextDecoder().decode(await bytes(name)));
 const [raw,native]=await Promise.all([json('graph.json'),json('native-defaults.json')]);
 const graph=prepareSourcePistolParticleGraph(raw),defaults=native as SourceParticleNativeDefaults,
  flame=createSourceAwpMuzzleFlameProgram(graph,defaults),glow=createSourceAwpMuzzleGlowProgram(graph,defaults);
 const loadTexture=async(source:string,label:string,sheet:boolean):Promise<LoadedTexture>=>{
  const entry=graph.data.textures.find(t=>t.source===source);
  if(!entry)throw Error('Original '+label+' texture absent');
  const sheets=entry.resources.filter(r=>r.sheetFile);
  if(entry.frames!==1||entry.frameDecodeStatus!=='complete'||entry.images.length!==1
   ||(sheet?sheets.length!==1:entry.resources.some(r=>r.sheetFile)))
   throw Error('Unsupported original '+label+' texture');
  const loader=new TextureLoader();
  const data=await bytes(entry.images[0].file.path),url=URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>],{type:'image/png'}));
  try{return {texture:await loader.loadAsync(url),sheetFile:sheets[0]?.sheetFile??null};}finally{URL.revokeObjectURL(url);}
 };
 const children=await loadSourceMuzzleChildrenRenderer(graph,native as SourceParticleNativeDefaults,bytes,{family:'awp',unit,capacity,signal});
 let flameLoaded:LoadedTexture|null=null,glowLoaded:LoadedTexture|null=null;
 try{
  flameLoaded=await loadTexture(SOURCE_AWP_MUZZLE_FLAME_TEXTURE,'AWP muzzle flame',true);
  glowLoaded=await loadTexture(SOURCE_AWP_MUZZLE_GLOW_TEXTURE,'AWP muzzle glow',false);
  signal?.throwIfAborted();
 }catch(error){children.dispose();flameLoaded?.texture.dispose();glowLoaded?.texture.dispose();throw error;}
 if(!flameLoaded?.sheetFile||!glowLoaded)throw Error('Original AWP muzzle textures absent');
 const flameSheet=decodeSourcePistolParticleSheet(await bytes(flameLoaded.sheetFile.path));
 // `fire_particle_4.vmt` is addself with overbright 6; `particle_glow_04_additive.vmt` is
 // the original additive unlitgeneric.
 const flameBatch=createSourceSpriteCardBatch({name:'original-awp-muzzle-flame',
  texture:configureSourceParticleTexture(flameLoaded.texture,SRGBColorSpace),capacity,additive:false,addSelf:1,overbright:6,depthBlend:true,sourceUnitMetres:unit});
 const glowBatch=createSourceSpriteCardBatch({name:'original-awp-muzzle-glow',
  texture:configureSourceParticleTexture(glowLoaded.texture,SRGBColorSpace),capacity,additive:true,addSelf:0,overbright:1});
 const group=new Group();group.name='original-awp-muzzle';group.add(flameBatch.mesh,glowBatch.mesh);
 group.add(children.group);
 const bursts:Burst[]=[];
 let disposed=false;
 return {group,children,flame,glow,flameSheet,graph,hashVerified,
  /** The root runtime owns the authoritative shot; this draws the hunting rifle's
   * continuous flame and its glow. */
  fire(anchor:SourceAwpMuzzleAnchor,nowSeconds:number,seeds:SourceAwpMuzzleSeeds){
   if(disposed)throw Error('AWP muzzle renderer disposed');
   const origin=new Vector3().copy(anchor.position),forward=new Vector3().copy(anchor.forward);
   const up=new Vector3(...(anchor.up?[anchor.up.x,anchor.up.y,anchor.up.z]:[0,1,0]));
   if(!Number.isFinite(nowSeconds)||!origin.toArray().every(Number.isFinite)||!forward.toArray().every(Number.isFinite)
    ||forward.lengthSq()<1e-10||up.lengthSq()<1e-10)throw Error('Invalid original AWP muzzle transform');
   forward.normalize();up.normalize();
   // Source's particle space is +X forward, +Y left, +Z up: `left = up x forward`.
   const left=new Vector3().crossVectors(up,forward).normalize(),vertical=new Vector3().crossVectors(forward,left).normalize();
   bursts.push({born:nowSeconds,lastUpdate:nowSeconds,time:0,origin,forward,side:left,up:vertical,
    flame:flame.emit(seeds),glow:glow.emit(seeds)});
   children.fire(anchor,nowSeconds,seeds.awp);
   return bursts.length;
  },
  update(nowSeconds:number){
   if(disposed)throw Error('AWP muzzle renderer disposed');
   if(!Number.isFinite(nowSeconds))throw Error('Invalid AWP muzzle particle clock');
   const longest=bursts.reduce((max,burst)=>Math.max(max,
    ...burst.flame.map(p=>p.life),...burst.glow.map(p=>p.life),0),0);
   for(let i=bursts.length-1;i>=0;i--)if(bursts[i].time>longest)bursts.splice(i,1);
   let flameCount=0,glowCount=0,dropped=0;const flameProof=[],glowProof=[];
   for(const burst of bursts){
    if(nowSeconds<burst.lastUpdate)burst.lastUpdate=burst.born;
    burst.time=Math.fround(burst.time+Math.max(0,nowSeconds-burst.lastUpdate));burst.lastUpdate=nowSeconds;
    const place=(particle:SourceAwpMuzzleParticle)=>{
     // The sweep along +X and the spawn offset are both in the control point's own frame,
     // whose +X is the barrel, +Y is left and +Z is up.
     return burst.origin.clone()
      .addScaledVector(burst.forward,(particle.distance+particle.offset[0])*unit)
      .addScaledVector(burst.side,particle.offset[1]*unit)
      .addScaledVector(burst.up,particle.offset[2]*unit);
    };
    for(const particle of sampleSourceAwpMuzzleParticles(burst.flame,burst.time)){
     if(flameCount>=capacity){dropped++;continue;}
     const index=flameCount++,position=place(particle);
     flameBatch.set('particleCenter',index,position.toArray());
     flameBatch.set('particleRadius',index,[particle.radius*unit]);
     flameBatch.set('particleRotation',index,[particle.rotation]);
     flameBatch.set('particleTint',index,[particle.color[0],particle.color[1],particle.color[2],particle.currentAlpha]);
     const frame=sourcePistolParticleSheetFrame(flameSheet,particle.sequence,particle.age,flame.configuration.animationRate);
     flameBatch.set('particleUV0',index,frame.uv0);flameBatch.set('particleUV1',index,frame.uv1);
     flameBatch.set('particleBlend',index,[frame.blend]);
     flameProof.push({id:particle.id,age:particle.age,position:position.toArray(),radius:particle.radius*unit,
      alpha:particle.currentAlpha,color:particle.color,rotation:particle.rotation,distance:particle.distance,
      requestedSequence:frame.requestedSequence,sequence:frame.resolvedSequence,frame:frame.index,
      anchor:burst.origin.toArray(),forward:burst.forward.toArray()});
    }
    for(const particle of sampleSourceAwpMuzzleParticles(burst.glow,burst.time)){
     if(glowCount>=capacity){dropped++;continue;}
     const index=glowCount++,position=place(particle);
     glowBatch.set('particleCenter',index,position.toArray());
     glowBatch.set('particleRadius',index,[particle.radius*unit]);
     glowBatch.set('particleRotation',index,[particle.rotation]);
     glowBatch.set('particleTint',index,[particle.currentColor[0],particle.currentColor[1],particle.currentColor[2],particle.currentAlpha]);
     // The glow's own texture is a single frame, so the whole sheet is the frame.
     glowBatch.set('particleUV0',index,[0,0,1,1]);glowBatch.set('particleUV1',index,[0,0,1,1]);glowBatch.set('particleBlend',index,[0]);
     glowProof.push({id:particle.id,age:particle.age,position:position.toArray(),radius:particle.radius*unit,
      alpha:particle.currentAlpha,color:particle.currentColor,rotation:particle.rotation,distance:particle.distance,
      anchor:burst.origin.toArray(),forward:burst.forward.toArray()});
    }
   }
   flameBatch.finish(flameCount);glowBatch.finish(glowCount);
   return {flameCount,glowCount,dropped,flame:flameProof,glow:glowProof,children:children.update(nowSeconds),bursts:bursts.length};
  },
  clear(){children.clear();bursts.length=0;flameBatch.finish(0);glowBatch.finish(0);},
  dispose(){if(disposed)return;disposed=true;children.dispose();bursts.length=0;group.removeFromParent();flameBatch.dispose();glowBatch.dispose();
   flameLoaded?.texture.dispose();glowLoaded?.texture.dispose();},
 };
}
