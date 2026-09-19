/** Shared original rifle/AWP smoke and trails. Textures/sheets pass through the
 * owning renderer's SHA verified loader; no generated radial smoke texture. */
import {Group,SRGBColorSpace,TextureLoader,Vector3,Color,type Texture} from 'three';
import {createSourceMuzzleChildProgram,SOURCE_MUZZLE_CHILD_SYSTEMS,type SourceMuzzleChildParticle,type SourceParticleVec3} from './source-muzzle-children';
import {decodeSourcePistolParticleSheet,type prepareSourcePistolParticleGraph,type SourceParticleNativeDefaults} from './source-pistol-particles-graph';
import {sourcePistolParticleSheetFrame} from './source-pistol-particles';
import {configureSourceParticleTexture,createSourceSpriteCardBatch} from './source-sprite-card';
type Graph=ReturnType<typeof prepareSourcePistolParticleGraph>;
type Anchor={position:{x:number;y:number;z:number};forward:{x:number;y:number;z:number};up?:{x:number;y:number;z:number};sourcePosition?:SourceParticleVec3;worldForward?:{x:number;y:number;z:number};worldUp?:{x:number;y:number;z:number};lightingColor?:SourceParticleVec3};
type Burst={born:number;origin:Vector3;forward:Vector3;side:Vector3;up:Vector3;worldUp:Vector3;particles:SourceMuzzleChildParticle[][]};
export async function loadSourceMuzzleChildrenRenderer(graph:Graph,native:SourceParticleNativeDefaults,bytes:(path:string)=>Promise<Uint8Array>,options:{family:'rifle'|'awp'|'grenade';unit:number;capacity:number;signal?:AbortSignal}){
 const {unit,capacity,family}=options,group=new Group();group.name='original-'+family+'-muzzle-children';
 const programs=SOURCE_MUZZLE_CHILD_SYSTEMS[family].map(system=>createSourceMuzzleChildProgram(graph,native,system)).filter(p=>p.configuration.shader==='spritecard');
 const textures=new Map<string,{texture:Texture;sheet:ReturnType<typeof decodeSourcePistolParticleSheet>|null}>();
 try{for(const program of programs){const source=program.configuration.texture;if(textures.has(source))continue;
  const entry=graph.data.textures.find(t=>t.source===source);if(!entry||entry.frames!==1||entry.images.length!==1||entry.frameDecodeStatus!=='complete')throw Error('Original child image absent '+source);
  const data=await bytes(entry.images[0].file.path),url=URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>],{type:'image/png'}));let texture:Texture;
  try{texture=configureSourceParticleTexture(await new TextureLoader().loadAsync(url),SRGBColorSpace);}finally{URL.revokeObjectURL(url);}
  // Track the texture before reading its sheet, so a missing sheet cannot leak it.
  const loaded={texture,sheet:null as ReturnType<typeof decodeSourcePistolParticleSheet>|null};textures.set(source,loaded);
  const sheet=entry.resources.find(r=>r.sheetFile)?.sheetFile;if(sheet)loaded.sheet=decodeSourcePistolParticleSheet(await bytes(sheet.path));
 }options.signal?.throwIfAborted();}catch(error){for(const t of textures.values())t.texture.dispose();throw error;}
 const batches=programs.map(program=>{const c=program.configuration,m=c.material,r=c.renderer,number=(key:string,fallback:number)=>Number(m[key]??fallback);
  const visibility=Number(r['Visibility Proxy Input Control Point Number'])>=0?{distance:[Number(r['Visibility input distance minimum']),Number(r['Visibility input distance maximum'])]as[number,number],alpha:[Number(r['Visibility Alpha Scale minimum']),Number(r['Visibility Alpha Scale maximum'])]as[number,number],radius:[Number(r['Visibility Radius Scale minimum']),Number(r['Visibility Radius Scale maximum'])]as[number,number]}:undefined;
  const batch=createSourceSpriteCardBatch({name:program.system,texture:textures.get(c.texture)!.texture,capacity,additive:number('$additive',0)===1,addSelf:number('$addself',0),overbright:number('$overbrightfactor',1),dualSequence:number('$dualsequence',0)===1,maxLum2:number('$maxlumframeblend2',0)===1,sequenceZoom:number('$zoomanimateseq2',1),sizeFade:[number('$startfadesize',10),number('$endfadesize',20)],depthBlend:number('$depthblend',0)===1,depthBlendScale:number('$depthblendscale',50),sourceUnitMetres:unit,orientationType:Number(r.orientation_type??0)as 0|1,trails:c.spark,visibility});group.add(batch.mesh);return batch;
 });
 const bursts:Burst[]=[];let disposed=false;
 return{group,programs,batches,
  fire(anchor:Anchor,now:number,seed:number){if(disposed)throw Error('Original muzzle child renderer disposed');
   const origin=new Vector3().copy(anchor.position),forward=new Vector3().copy(anchor.forward).normalize(),up=new Vector3().copy(anchor.up??{x:0,y:1,z:0}).normalize(),side=new Vector3().crossVectors(up,forward).normalize(),vertical=new Vector3().crossVectors(forward,side).normalize();
   const physicalForward=new Vector3().copy(anchor.worldForward??forward).normalize(),physicalUp=new Vector3().copy(anchor.worldUp??up).normalize(),physicalSide=new Vector3().crossVectors(physicalUp,physicalForward).normalize(),physicalVertical=new Vector3().crossVectors(physicalForward,physicalSide).normalize();
   if(!Number.isFinite(now)||!origin.toArray().every(Number.isFinite)||![...forward.toArray(),...up.toArray(),...physicalForward.toArray(),...physicalUp.toArray()].every(Number.isFinite)||side.lengthSq()<.5||physicalSide.lengthSq()<.5)throw Error('Invalid original muzzle child frame');
   const particles=programs.map((program,i)=>{const g=program.configuration.movement.gravity as number[];if(g[0]!==0||g[1]!==0)throw Error('Unsupported muzzle child gravity axes');return program.emit((seed+i*271)&4095,{born:0,lightingColor:anchor.lightingColor,sourcePosition:anchor.sourcePosition,noiseTransform:anchor.sourcePosition?(p)=>{const d=physicalForward.clone().multiplyScalar(p[0]).addScaledVector(physicalSide,p[1]).addScaledVector(physicalVertical,p[2]);return[anchor.sourcePosition![0]+d.x,anchor.sourcePosition![1]-d.z,anchor.sourcePosition![2]+d.y];}:undefined,gravity:[g[2]*physicalForward.y,g[2]*physicalSide.y,g[2]*physicalVertical.y],worldToLocal:(v)=>{const w=new Vector3(v[0],v[2],-v[1]);return[w.dot(physicalForward),w.dot(physicalSide),w.dot(physicalVertical)];}});});
   const worldUp=forward.clone().multiplyScalar(physicalForward.y).addScaledVector(side,physicalSide.y).addScaledVector(vertical,physicalVertical.y);
   bursts.push({born:now,origin,forward,side,up:vertical,worldUp,particles});
   return Math.max(0,...particles.flatMap(ps=>ps.map(p=>p.born+p.life)));
  },
  update(now:number){if(disposed)throw Error('Original muzzle child renderer disposed');if(!Number.isFinite(now))throw Error('Invalid child clock');
   for(let i=bursts.length-1;i>=0;i--)if(bursts[i].particles.every(ps=>ps.every(p=>now-bursts[i].born>=p.life+p.born)))bursts.splice(i,1);
   const counts=programs.map(()=>0);let dropped=0;const proof:Record<string,unknown>[]=[];
   for(const burst of bursts)for(const [i,program]of programs.entries()){
    const texture=textures.get(program.configuration.texture)!,batch=batches[i],renderer=program.configuration.renderer;
    for(const p of program.sample(burst.particles[i],now-burst.born)){if(counts[i]>=capacity){dropped++;continue;}const index=counts[i]++;
     const place=(v:SourceParticleVec3)=>burst.origin.clone().addScaledVector(burst.forward,v[0]*unit).addScaledVector(burst.side,v[1]*unit).addScaledVector(burst.up,v[2]*unit);
     const position=place(p.currentPosition);let radius=p.currentRadius,tail=position.clone();
     if(program.configuration.spark){const velocity=new Vector3(...p.currentVelocity),speed=velocity.length(),fade=Number(renderer['length fade in time']);let length=speed*p.trailLength*(fade>0?Math.min(1,p.age/fade):1);length=Math.min(Number(renderer['max length']),Math.max(Number(renderer['min length']),length));if(renderer['constrain radius to length'])radius=Math.min(radius,length);const localTail=p.currentPosition.map((v,j)=>v-(speed>0?p.currentVelocity[j]/speed*length:0))as SourceParticleVec3;tail=place(localTail);}
     const colour=new Color().setRGB(...p.currentColor);
     batch.set('particleWorldUp',index,burst.worldUp.toArray());batch.set('particleYaw',index,[p.yawFlipped?Math.PI:0]);batch.set('particleCenter',index,position.toArray());batch.set('particleTail',index,tail.toArray());batch.set('particleRadius',index,[radius*unit]);batch.set('particleRotation',index,[p.rotation]);batch.set('particleTint',index,[colour.r,colour.g,colour.b,p.currentAlpha]);
     let frame:ReturnType<typeof sourcePistolParticleSheetFrame>|null=null,frame2:ReturnType<typeof sourcePistolParticleSheetFrame>|null=null;
     const flip=(uv:number[])=>p.yawFlipped&&Number(renderer.orientation_type??0)!==1?[uv[2],uv[1],uv[0],uv[3]]:uv;
     if(texture.sheet){const age=renderer.animation_fit_lifetime?p.age/p.life:p.age;frame=sourcePistolParticleSheetFrame(texture.sheet,p.sequence,age,Number(renderer['animation rate']));frame2=sourcePistolParticleSheetFrame(texture.sheet,p.sequence2,p.age,Number(renderer['second sequence animation rate']));}
     batch.set('particleUV0',index,flip(frame?.uv0??[0,0,1,1]));batch.set('particleUV1',index,flip(frame?.uv1??[0,0,1,1]));batch.set('particleBlend',index,[frame?.blend??0]);batch.set('particleUV20',index,flip(frame2?.uv0??[0,0,1,1]));batch.set('particleUV21',index,flip(frame2?.uv1??[0,0,1,1]));batch.set('particleBlend2',index,[frame2?.blend??0]);
     proof.push({orientationType:Number(renderer.orientation_type??0),worldUp:burst.worldUp.toArray(),system:program.system,id:p.id,age:p.age,life:p.life,born:p.born,position:position.toArray(),tail:tail.toArray(),radius:radius*unit,alpha:p.currentAlpha,color:p.currentColor,sequence:frame?.resolvedSequence??0,sequence2:frame2?.resolvedSequence??0,frame:frame?.index??0,frame2:frame2?.index??0,anchor:burst.origin.toArray()});
    }
   }
   batches.forEach((batch,i)=>batch.finish(counts[i]));return{counts:Object.fromEntries(programs.map((p,i)=>[p.system,counts[i]])),particles:proof,dropped,bursts:bursts.length};
  },
  clear(){bursts.length=0;batches.forEach(batch=>batch.finish(0));},
  dispose(){if(disposed)return;disposed=true;bursts.length=0;group.removeFromParent();batches.forEach(batch=>batch.dispose());for(const t of textures.values())t.texture.dispose();},
 };
}
