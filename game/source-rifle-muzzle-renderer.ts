/** The original `weapon_muzzle_flash_assaultrifle_vent` drawn in the world.
 *
 * One original instant sprite per shot, on the weapon's own `muzzle_flash`
 * attachment, with the original additive material and the original 128×128
 * `effects/muzzleflashx` texture. The graph, the native operator defaults and the
 * decoded texture are fetched by name and SHA-256; nothing here is guessed from
 * a system or material name.
 */
import {Group,SRGBColorSpace,TextureLoader,Vector3,type Texture} from 'three';
import {decodeSourcePistolParticleSheet,prepareSourcePistolParticleGraph,type SourceParticleFile,type SourceParticleNativeDefaults} from './source-pistol-particles-graph';
import {sourcePistolParticleSheetFrame} from './source-pistol-particles';
import {configureSourceParticleTexture,createSourceSpriteCardBatch} from './source-sprite-card';
import {createSourceRifleMuzzleProgram,createSourceRifleMuzzleGlowProgram,createSourceRifleMuzzleFlameProgram,createSourceRifleMuzzleContinuousFlameProgram,SOURCE_RIFLE_MUZZLE_TEXTURE,SOURCE_RIFLE_MUZZLE_GLOW_TEXTURE,SOURCE_RIFLE_MUZZLE_FLAME_TEXTURE,sampleSourceRifleMuzzleParticles,sampleSourceRifleMuzzleGlowParticles,sampleSourceRifleMuzzleFlameParticles,sampleSourceAwpMuzzleParticles,type SourceAwpMuzzleParticle,type SourceRifleMuzzleSeeds} from './source-rifle-muzzle-particles';
import resources from './source-muzzle-particle-resources.json';
import {sourceSha256} from './source-sha256';
import {loadSourceMuzzleChildrenRenderer} from './source-muzzle-children-renderer';

/** One original texture this port draws, and the sheet resource the export recorded
 * beside it when the texture is an atlas rather than a single frame. */
type LoadedTexture={texture:Texture;sheetFile:SourceParticleFile|null};

/** The world weapon's own muzzle frame. Source's particle space is +X forward, +Y left
 * and +Z up, so a spawn offset with lateral parts needs `up` as well as `forward`. */
export type SourceMuzzleAnchor={position:{x:number;y:number;z:number};forward:{x:number;y:number;z:number};
  up?:{x:number;y:number;z:number};sourcePosition?:[number,number,number];worldForward?:{x:number;y:number;z:number};worldUp?:{x:number;y:number;z:number}};
type Burst={born:number;lastUpdate:number;time:number;origin:Vector3;forward:Vector3;side:Vector3;up:Vector3;
  particles:ReturnType<ReturnType<typeof createSourceRifleMuzzleProgram>['emit']>;
  glow:ReturnType<ReturnType<typeof createSourceRifleMuzzleGlowProgram>['emit']>;
  flame:ReturnType<ReturnType<typeof createSourceRifleMuzzleFlameProgram>['emit']>;
  continuous:SourceAwpMuzzleParticle[]};

/** `weapon_muzzle_flash_assaultrifle_vent` in the world: one sprite per shot. */
export async function loadSourceRifleMuzzleRenderer(baseUrl:string,options:{capacity?:number;sourceUnitMetres?:number;signal?:AbortSignal}={}){
 const capacity=options.capacity??64,unit=options.sourceUnitMetres??.0254,signal=options.signal;
 if(!Number.isInteger(capacity)||capacity<4||capacity>2048||!Number.isFinite(unit)||unit<=0)throw Error('Invalid rifle muzzle renderer capacity/units');
 const base=baseUrl.endsWith('/')?baseUrl:baseUrl+'/',hashVerified:Record<string,boolean>={};
 const bytes=async(name:string)=>{
  const row=resources.find(r=>r.path===name);if(!row)throw Error('Unverified original muzzle particle resource '+name);
  const r=await fetch(base+name,{signal});if(!r.ok)throw Error('Original muzzle particles HTTP '+r.status+' '+name);
  const b=new Uint8Array(await r.arrayBuffer());
  if(b.byteLength!==row.bytes||await sourceSha256(b,signal)!==row.sha256)throw Error('Original muzzle particles SHA mismatch '+name);
  hashVerified[name]=true;return b;
 },json=async(name:string)=>JSON.parse(new TextDecoder().decode(await bytes(name)));
 const [raw,native]=await Promise.all([json('graph.json'),json('native-defaults.json')]);
 const graph=prepareSourcePistolParticleGraph(raw),program=createSourceRifleMuzzleProgram(graph,native as SourceParticleNativeDefaults),
  glow=createSourceRifleMuzzleGlowProgram(graph,native as SourceParticleNativeDefaults),
  flame=createSourceRifleMuzzleFlameProgram(graph,native as SourceParticleNativeDefaults),
  continuous=createSourceRifleMuzzleContinuousFlameProgram(graph,native as SourceParticleNativeDefaults);
 // The vent and the flare each draw one single-frame original texture. The flame
 // draws a sheet: the atlas is the texture's own image and the frame rects come from
 // the original sheet resource the export decoded and staged beside it.
 const loadTexture=async(source:string,label:string,sheet:boolean)=>{
  const entry=graph.data.textures.find(t=>t.source===source);
  if(!entry)throw Error('Original '+label+' texture absent');
  const resources=entry.resources.filter(r=>r.sheetFile);
  if(entry.frames!==1||entry.frameDecodeStatus!=='complete'||entry.images.length!==1
   ||(sheet?resources.length!==1:entry.resources.some(r=>r.sheetFile)))
   throw Error('Unsupported original '+label+' texture');
  const loader=new TextureLoader();
  const data=await bytes(entry.images[0].file.path),url=URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>],{type:'image/png'}));
  try{return {texture:await loader.loadAsync(url),sheetFile:resources[0]?.sheetFile??null};}finally{URL.revokeObjectURL(url);}
 };
 const children=await loadSourceMuzzleChildrenRenderer(graph,native as SourceParticleNativeDefaults,bytes,{family:'rifle',unit,capacity,signal});
 let loaded:LoadedTexture|null=null,glowLoaded:LoadedTexture|null=null,flameLoaded:LoadedTexture|null=null;
 try{
  loaded=await loadTexture(SOURCE_RIFLE_MUZZLE_TEXTURE,'rifle muzzle',false);
  glowLoaded=await loadTexture(SOURCE_RIFLE_MUZZLE_GLOW_TEXTURE,'rifle muzzle glow',false);
  flameLoaded=await loadTexture(SOURCE_RIFLE_MUZZLE_FLAME_TEXTURE,'rifle muzzle flame',true);
  signal?.throwIfAborted();
 }catch(error){children.dispose();loaded?.texture.dispose();glowLoaded?.texture.dispose();flameLoaded?.texture.dispose();throw error;}
 if(!loaded||!glowLoaded||!flameLoaded?.sheetFile)throw Error('Original rifle muzzle textures absent');
 // The runtime decodes the sheet itself from the staged original bytes; the frame the
 // flame draws is resolved through the same verified CSheet fixup the pistol core uses.
 const flameSheet=decodeSourcePistolParticleSheet(await bytes(flameLoaded.sheetFile.path));
 const batch=createSourceSpriteCardBatch({name:'original-assaultrifle-muzzle',
  // `particle_muzzleflashx.vmt`: $additive 1, $depthblend 0, no $addself.
  texture:configureSourceParticleTexture(loaded.texture,SRGBColorSpace),capacity,additive:true,addSelf:0,overbright:1});
 // `particle_flare_004.vmt` is the same additive recipe, with the flare's own texture.
 const glowBatch=createSourceSpriteCardBatch({name:'original-assaultrifle-muzzle-glow',
  texture:configureSourceParticleTexture(glowLoaded.texture,SRGBColorSpace),capacity,additive:true,addSelf:0,overbright:1});
 // `fire_particle_4.vmt` is addself with overbright 6 and no `$additive`.
 const flameBatch=createSourceSpriteCardBatch({name:'original-assaultrifle-muzzle-flame',
  texture:configureSourceParticleTexture(flameLoaded.texture,SRGBColorSpace),capacity,additive:false,addSelf:1,overbright:6,depthBlend:true,sourceUnitMetres:unit});
 // The dispatcher's other flame is the same original material and sheet, so it draws with
 // the same recipe; it gets its own batch because it is its own original system.
 const continuousBatch=createSourceSpriteCardBatch({name:'original-assaultrifle-muzzle-continuous-flame',
  texture:configureSourceParticleTexture(flameLoaded.texture,SRGBColorSpace),capacity,additive:false,addSelf:1,overbright:6,depthBlend:true,sourceUnitMetres:unit});
 const group=new Group();group.name='original-assaultrifle-muzzle';group.add(batch.mesh,glowBatch.mesh,flameBatch.mesh,continuousBatch.mesh);
 group.add(children.group);
 const bursts:Burst[]=[];
 let disposed=false;
 return {group,children,program,glow,flame,continuous,flameSheet,graph,hashVerified,
  /** The root runtime owns the authoritative shot; this renders the vent, the glow,
   * the rolling flame and the continuous flame of the original systems. */
  fire(anchor:SourceMuzzleAnchor,nowSeconds:number,seeds:SourceRifleMuzzleSeeds){
   if(disposed)throw Error('Rifle muzzle renderer disposed');
   const origin=new Vector3().copy(anchor.position),forward=new Vector3().copy(anchor.forward);
   const up=new Vector3(...(anchor.up?[anchor.up.x,anchor.up.y,anchor.up.z]:[0,1,0]));
   if(!Number.isFinite(nowSeconds)||!origin.toArray().every(Number.isFinite)||!forward.toArray().every(Number.isFinite)
    ||forward.lengthSq()<1e-10||up.lengthSq()<1e-10)throw Error('Invalid original rifle muzzle transform');
   forward.normalize();up.normalize();
   // Source's particle space is +X forward, +Y left, +Z up: `left = up x forward`.
   const left=new Vector3().crossVectors(up,forward).normalize(),vertical=new Vector3().crossVectors(forward,left).normalize();
   bursts.push({born:nowSeconds,lastUpdate:nowSeconds,time:0,origin,forward,side:left,up:vertical,particles:program.emit(seeds),
    glow:glow.emit(seeds),flame:flame.emit(seeds),continuous:continuous.emit(seeds)});
   children.fire(anchor,nowSeconds,seeds.vent);
   // Capacity is explicit and observable; excess shots are reported, never
   // folded into one sprite.
   return bursts.length;
  },
  update(nowSeconds:number){
   if(disposed)throw Error('Rifle muzzle renderer disposed');
   if(!Number.isFinite(nowSeconds))throw Error('Invalid rifle muzzle particle clock');
   const longest=bursts.reduce((max,burst)=>Math.max(max,...burst.particles.map(p=>p.life),...burst.glow.map(p=>p.life),
    ...burst.flame.map(p=>p.life),...burst.continuous.map(p=>p.life),0),0);
   for(let i=bursts.length-1;i>=0;i--)if(bursts[i].time>longest)bursts.splice(i,1);
   let count=0,glowCount=0,flameCount=0,continuousCount=0,dropped=0;
   const proof=[],glowProof=[],flameProof=[],continuousProof=[];
   for(const burst of bursts){
    // Repeated same-time updates do not advance the original age.
    if(nowSeconds<burst.lastUpdate)burst.lastUpdate=burst.born;
    burst.time=Math.fround(burst.time+Math.max(0,nowSeconds-burst.lastUpdate));burst.lastUpdate=nowSeconds;
    for(const particle of sampleSourceRifleMuzzleParticles(burst.particles,burst.time)){
     if(count>=capacity){dropped++;continue;}
     const index=count++,position=burst.origin.clone();
     position.x+=particle.offset[0]*unit;position.y+=particle.offset[1]*unit;position.z+=particle.offset[2]*unit;
     batch.set('particleCenter',index,position.toArray());
     batch.set('particleRadius',index,[particle.radius*unit]);
     batch.set('particleRotation',index,[particle.rotation]);
     batch.set('particleTint',index,[1,1,1,particle.currentAlpha]);
     // One original frame: the whole texture, no sequence lookup.
     batch.set('particleUV0',index,[0,0,1,1]);batch.set('particleUV1',index,[0,0,1,1]);batch.set('particleBlend',index,[0]);
     proof.push({id:particle.id,age:particle.age,position:position.toArray(),radius:particle.radius*unit,
      alpha:particle.currentAlpha,rotation:particle.rotation,anchor:burst.origin.toArray(),
      forward:burst.forward.toArray()});
    }
    for(const particle of sampleSourceRifleMuzzleGlowParticles(burst.glow,burst.time)){
     if(glowCount>=capacity){dropped++;continue;}
     const index=glowCount++,position=burst.origin.clone();
     // The original spawn box is the zero default, so the flare sits on the muzzle.
     glowBatch.set('particleCenter',index,position.toArray());
     glowBatch.set('particleRadius',index,[particle.radius*unit]);
     glowBatch.set('particleRotation',index,[particle.rotation]);
     // The original `Color Fade` drives the flare's rgb, which the tint carries.
     glowBatch.set('particleTint',index,[particle.currentColor[0],particle.currentColor[1],particle.currentColor[2],particle.currentAlpha]);
     glowBatch.set('particleUV0',index,[0,0,1,1]);glowBatch.set('particleUV1',index,[0,0,1,1]);glowBatch.set('particleBlend',index,[0]);
     glowProof.push({id:particle.id,age:particle.age,position:position.toArray(),radius:particle.radius*unit,
      alpha:particle.currentAlpha,color:particle.currentColor,rotation:particle.rotation,
      anchor:burst.origin.toArray(),forward:burst.forward.toArray()});
    }
    for(const particle of sampleSourceRifleMuzzleFlameParticles(burst.flame,burst.time,
     {startTime:flame.configuration.scaleStart,endTime:flame.configuration.scaleEnd,
      startScale:flame.configuration.scaleLo,endScale:flame.configuration.scaleHi})){
     if(flameCount>=capacity){dropped++;continue;}
     const index=flameCount++,position=burst.origin.clone().addScaledVector(burst.forward,particle.distance*unit);
     flameBatch.set('particleCenter',index,position.toArray());
     flameBatch.set('particleRadius',index,[particle.currentRadius*unit]);
     flameBatch.set('particleRotation',index,[particle.rotation]);
     flameBatch.set('particleTint',index,[particle.color[0],particle.color[1],particle.color[2],particle.currentAlpha]);
     // The frame comes from the original sheet through the verified CSheet fixup; the
     // original's own yaw flip mirrors the sprite horizontally.
     const frame=sourcePistolParticleSheetFrame(flameSheet,particle.sequence,particle.age,flame.configuration.animationRate);
     const flip=(uv:number[])=>particle.yawFlipped?[uv[2],uv[1],uv[0],uv[3]]:uv;
     flameBatch.set('particleUV0',index,flip(frame.uv0));flameBatch.set('particleUV1',index,flip(frame.uv1));
     flameBatch.set('particleBlend',index,[frame.blend]);
     flameProof.push({id:particle.id,age:particle.age,position:position.toArray(),radius:particle.currentRadius*unit,
      alpha:particle.currentAlpha,color:particle.color,rotation:particle.rotation,distance:particle.distance,
      requestedSequence:frame.requestedSequence,sequence:frame.resolvedSequence,frame:frame.index,yawFlipped:particle.yawFlipped,
      anchor:burst.origin.toArray(),forward:burst.forward.toArray()});
    }
    for(const particle of sampleSourceAwpMuzzleParticles(burst.continuous,burst.time)){
     if(continuousCount>=capacity){dropped++;continue;}
     const index=continuousCount++,
      // The sweep along +X and the spawn offset are both in the control point's own
      // frame, whose +X is the barrel, +Y is left and +Z is up.
      position=burst.origin.clone()
       .addScaledVector(burst.forward,(particle.distance+particle.offset[0])*unit)
       .addScaledVector(burst.side,particle.offset[1]*unit)
       .addScaledVector(burst.up,particle.offset[2]*unit);
     continuousBatch.set('particleCenter',index,position.toArray());
     continuousBatch.set('particleRadius',index,[particle.radius*unit]);
     continuousBatch.set('particleRotation',index,[particle.rotation]);
     continuousBatch.set('particleTint',index,[particle.color[0],particle.color[1],particle.color[2],particle.currentAlpha]);
     const frame=sourcePistolParticleSheetFrame(flameSheet,particle.sequence,particle.age,continuous.configuration.animationRate);
     continuousBatch.set('particleUV0',index,frame.uv0);continuousBatch.set('particleUV1',index,frame.uv1);
     continuousBatch.set('particleBlend',index,[frame.blend]);
     continuousProof.push({id:particle.id,age:particle.age,position:position.toArray(),radius:particle.radius*unit,
      alpha:particle.currentAlpha,color:particle.color,rotation:particle.rotation,distance:particle.distance,
      requestedSequence:frame.requestedSequence,sequence:frame.resolvedSequence,frame:frame.index,
      anchor:burst.origin.toArray(),forward:burst.forward.toArray()});
    }
   }
   batch.finish(count);glowBatch.finish(glowCount);flameBatch.finish(flameCount);continuousBatch.finish(continuousCount);
   return {count,glowCount,flameCount,continuousCount,dropped,particles:proof,glow:glowProof,flame:flameProof,
    continuous:continuousProof,children:children.update(nowSeconds),bursts:bursts.length};
  },
  clear(){children.clear();bursts.length=0;batch.finish(0);glowBatch.finish(0);flameBatch.finish(0);continuousBatch.finish(0);},
  dispose(){if(disposed)return;disposed=true;children.dispose();bursts.length=0;group.removeFromParent();batch.dispose();glowBatch.dispose();
   flameBatch.dispose();continuousBatch.dispose();loaded?.texture.dispose();glowLoaded?.texture.dispose();flameLoaded?.texture.dispose();},
 };
}
