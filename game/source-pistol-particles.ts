import {createSourcePistolParticleRandom,sourcePistolParticleRandomValue,type SourcePistolParticleSeeds} from './source-pistol-particles-random';
import {decodeSourcePistolParticleSheet,prepareSourcePistolParticleGraph,sourcePistolParticleParameters,type SourceParticleNativeDefaults} from './source-pistol-particles-graph';

export const SOURCE_PISTOL_PARTICLES_VERSION='csgo-pistol-main-core-12426148-r2';
export const SOURCE_PISTOL_PARTICLE_LIMITATIONS=[
 'The original 4096-float scalar RNG table and initializer order are reproduced. Collection seed assignment is a deterministic browser adapter; original allocation address/Plat_MSTime() and game trigger phase are not reproduced.',
 'Core emission still uses the verified 8-particle first batch. Sub-7ms first simulation steps and later partial-batch RNG scheduling are not reproduced.',
 'The original minimum-rendered-frames simulation gate is reproduced; full game trigger and actual render-call scheduling remain outside this module.',
 'Main/core only. Sparks, muzzle smoke, shell-eject smoke and fallback systems are preserved as data but not simulated.',
 'Core SpriteCard depth feathering and native HDR/tone mapping are not restored; opaque-scene depth is still tested.',
 'The 512-sample fire-sheet lookup and sequence aliases are verified; other sheets and SpriteCard feature combinations are not rendered.',
]as const;
export type SourcePistolParticle={id:number;system:'main'|'core';born:number;life:number;forwardOffset:number;forwardSpeed:number;radius:number;alpha:number;rotation:number;color:[number,number,number];sequence:number;fadeDuration:number};
export type SourcePistolParticleSample=SourcePistolParticle&{age:number;distance:number;currentRadius:number;currentAlpha:number};
export type SourcePistolParticleSheet=ReturnType<typeof decodeSourcePistolParticleSheet>;
type Graph=ReturnType<typeof prepareSourcePistolParticleGraph>;
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const number=(v:unknown,name:string)=>{if(typeof v!=='number'||!Number.isFinite(v))throw Error('Missing original particle number: '+name);return v;};
const vector=(v:unknown,name:string)=>{if(!Array.isArray(v)||v.length!==3||!v.every(n=>typeof n==='number'&&Number.isFinite(n)))throw Error('Missing original particle vector: '+name);return v as [number,number,number];};

/** Only this build's main/core configurations are accepted. Values come from
 * PCF overrides plus original client unpack getters, never visual tuning. */
export function createSourcePistolParticleProgram(graph:Graph,native:SourceParticleNativeDefaults){
 function parameters(system:string,phase:'emitters'|'initializers'|'operators'|'renderers',name:string){
  const found=graph.phase('weapon_muzzle_flash_pistol_'+system,phase).filter(e=>e.attributes.functionName===name);
  if(!found.length)throw Error('Original particle operator absent: '+name);
  return found.map(e=>sourcePistolParticleParameters(e,native).values);
 }
 function one(system:string,phase:'emitters'|'initializers'|'operators'|'renderers',name:string){return parameters(system,phase,name)[0];}
 const main={sequence:one('main','initializers','Sequence Random'),emitter:one('main','emitters','emit_instantaneously'),life:one('main','initializers','Lifetime Random'),alpha:one('main','initializers','Alpha Random'),
  rotation:one('main','initializers','Rotation Random'),position:one('main','initializers','Position Within Sphere Random'),fade:one('main','operators','Alpha Fade Out Random'),scale:one('main','operators','Radius Scale')};
 const core={alpha:one('core','initializers','Alpha Random'),emitter:one('core','emitters','emit_continuously'),life:one('core','initializers','Lifetime Random'),rotation:one('core','initializers','Rotation Random'),
  color:one('core','initializers','Color Random'),sequence:one('core','initializers','Sequence Random'),fade:one('core','operators','Alpha Fade Out Random'),
  position:one('core','initializers','Remap Scalar to Vector'),remaps:parameters('core','initializers','Remap Initial Scalar')};
 // These constraints are deliberately narrow: unsupported graph changes fail closed.
 for(const system of ['main','core']){
  const movement=one(system,'operators','Movement Basic'),renderer=one(system,'renderers','render_animated_sprites');
  if(vector(movement.gravity,'gravity').some(v=>v!==0)||movement.drag!==0||renderer.orientation_type!==0||renderer.animation_fit_lifetime!==false||renderer['use animation rate as FPS']!==false)throw Error('Unsupported original main/core operator mode');
 }
 if(main.scale.start_time!==0||main.scale.end_time!==1||main.scale.radius_start_scale!==1||main.scale.radius_end_scale!==.25||main.scale.ease_in_and_out!==false)throw Error('Unsupported original main radius mode');
 const coreRadius=core.remaps.find(r=>r['output field']===3)!,coreAlpha=core.remaps.find(r=>r['output field']===7)!;
 if(!coreRadius||!coreAlpha||core.position['input field']!==8||core.position['output field']!==0||core.position['use local system']!==true)throw Error('Unsupported original core remap');
 const get=(v:Record<string,unknown>,key:string)=>number(v[key],key);
 const f=Math.fround,lerp=(a:number,b:number,t:number)=>f(f(a)+f(f(f(b)-f(a))*f(t)));
 const scalar=(v:Record<string,unknown>,birth:number)=>lerp(get(v,'output minimum'),get(v,'output maximum'),clamp(f(f(birth-get(v,'input minimum'))/f(get(v,'input maximum')-get(v,'input minimum')))));
 let presentationSeed=0;
 function emitWithSeeds(seeds:SourcePistolParticleSeeds){
  return emitSystems(createSourcePistolParticleRandom(seeds.main),createSourcePistolParticleRandom(seeds.core),seeds);
 }
 function emitSystems(mainRandom:()=>number,coreRandom:()=>number,seeds?:SourcePistolParticleSeeds):SourcePistolParticle[]{
  const sample=(random:()=>number)=>{const x=random();if(!Number.isFinite(x)||x<0||x>=1)throw Error('Particle random sample outside [0,1)');return f(x);};
  const between=(random:()=>number,v:Record<string,unknown>,a:string,b:string)=>lerp(get(v,a),get(v,b),sample(random));
  const rotation=(random:()=>number,v:Record<string,unknown>)=>{
   const lo=f(get(v,'rotation_offset_min')*Math.PI/180),hi=f(get(v,'rotation_offset_max')*Math.PI/180),initial=f(get(v,'rotation_initial')*Math.PI/180);
   const angle=f(initial+lerp(lo,hi,sample(random)));return v.randomly_flip_direction&&sample(random)<.5?-angle:angle;
  };
  const alpha=(random:()=>number,v:Record<string,unknown>)=>lerp(f(get(v,'alpha_min')*f(1/255)),f(get(v,'alpha_max')*f(1/255)),sample(random));
  const blank=(system:'main'|'core',id:number,born:number):SourcePistolParticle=>({id,system,born,life:0,forwardOffset:0,forwardSpeed:0,radius:5,alpha:1,rotation:0,color:[1,1,1],sequence:0,fadeDuration:0});
  const mainParticles=Array.from({length:get(main.emitter,'num_to_emit')},(_,i)=>blank('main',i,get(main.emitter,'emission_start_time')));
  // Original scalar dispatcher 0xd444d0: the complete batch runs once per
  // initializer, including RNG draws for constant ranges and overwritten fields.
  for(const p of mainParticles)p.sequence=Math.floor(lerp(get(main.sequence,'sequence_min'),get(main.sequence,'sequence_max')+1,sample(mainRandom)));
  for(const p of mainParticles)p.rotation=rotation(mainRandom,main.rotation);
  for(const p of mainParticles)p.life=between(mainRandom,main.life,'lifetime_min','lifetime_max');
  for(const p of mainParticles)p.alpha=alpha(mainRandom,main.alpha);
  for(const p of mainParticles){
   for(let i=0;i<3;i++)sample(mainRandom); // Original sphere helper, radius zero.
   const lo=vector(main.position.speed_in_local_coordinate_system_min,'speed min'),hi=vector(main.position.speed_in_local_coordinate_system_max,'speed max');
   p.forwardSpeed=lerp(lo[0],hi[0],sample(mainRandom));sample(mainRandom);sample(mainRandom);
   p.fadeDuration=get(main.fade,'fade out time min');
  }
  const start=get(core.emitter,'emission_start_time'),duration=get(core.emitter,'emission_duration'),count=Math.floor(get(core.emitter,'emission_rate')*duration),increment=f(duration/count);
  let birth=f(start);
  const coreParticles=Array.from({length:count},(_,i)=>{birth=f(birth+increment);return blank('core',mainParticles.length+i,Math.min(start+duration,birth));});
  for(const p of coreParticles)p.sequence=Math.floor(lerp(get(core.sequence,'sequence_min'),get(core.sequence,'sequence_max')+1,sample(coreRandom)));
  for(const p of coreParticles)p.rotation=rotation(coreRandom,core.rotation);
  for(const p of coreParticles)p.alpha=alpha(coreRandom,core.alpha);
  for(const p of coreParticles){const t=sample(coreRandom),a=core.color.color1 as number[],b=core.color.color2 as number[];
   p.color=[0,1,2].map(i=>lerp(f(a[i]*f(1/255)),f(b[i]*f(1/255)),t))as[number,number,number];
  }
  for(const p of coreParticles)p.life=between(coreRandom,core.life,'lifetime_min','lifetime_max');
  const positionLo=vector(core.position['output minimum'],'core position min'),positionHi=vector(core.position['output maximum'],'core position max'),reciprocal=f(1/f(get(core.position,'input maximum')-get(core.position,'input minimum')));
  for(const p of coreParticles){
   const t=clamp(f(f(p.born-get(core.position,'input minimum'))*reciprocal));p.forwardOffset=lerp(positionLo[0],positionHi[0],t);
  }
  for(const p of coreParticles)p.radius=scalar(coreRadius,p.born);
  for(const p of coreParticles)p.alpha=scalar(coreAlpha,p.born);
  // Fade is an operator lookup, not an initializer draw: original particle ID
  // is (seed+ordinal)&4095; operator #2 contributes 2*17 to its table index.
  for(let i=0;i<coreParticles.length;i++)coreParticles[i].fadeDuration=lerp(get(core.fade,'fade out time min'),get(core.fade,'fade out time max'),seeds?sourcePistolParticleRandomValue((2*(seeds.core&4095)+i+34)&4095):sample(coreRandom));
  return [...mainParticles,...coreParticles];
 }
 return {
  version:SOURCE_PISTOL_PARTICLES_VERSION,limitations:SOURCE_PISTOL_PARTICLE_LIMITATIONS,
  animationRates:{main:get(one('main','renderers','render_animated_sprites'),'animation rate'),core:get(one('core','renderers','render_animated_sprites'),'animation rate')},
  emitWithSeeds,
  /** Existing unit-sample callback is retained. Omission uses original table
   * with an explicit deterministic presentation seed, never Math.random. */
  emit(random?:(()=>number)|SourcePistolParticleSeeds):SourcePistolParticle[]{return typeof random==='function'?emitSystems(random,random):emitWithSeeds(random??{main:++presentationSeed,core:presentationSeed});},
 };

}

/** Original 0xd0e3d0 linear Radius Scale and 0xd2c3c0 eased fade branch.
 * Compared to independent original binary execution in native-operators.json. */
export function sampleSourcePistolParticles(particles:readonly SourcePistolParticle[],seconds:number):SourcePistolParticleSample[]{
 if(!Number.isFinite(seconds))throw Error('Invalid particle clock');
 return particles.flatMap(p=>{
  const age=seconds-p.born;if(age<0||age>=p.life)return[];
  const f=clamp((age-(p.life-p.fadeDuration))/p.fadeDuration),smooth=f*f*(3-2*f);
  return[{...p,age,distance:p.forwardOffset+age*p.forwardSpeed,currentRadius:p.radius*(p.system==='main'?1-.75*clamp(age/p.life):1),currentAlpha:Math.max(0,p.alpha*(1-smooth))}];
 });
}

/** Missing sequences alias the first valid sequence in the original CSheet
 * fixup (0xf63d22..0xf64296), verified for every native slot 0..63. */
export function sourcePistolParticleSheetFrame(sheet:SourcePistolParticleSheet,sequence:number,age:number,animationRate:number){
 const selected=sheet.sequences.find(s=>s.id===sequence)??[...sheet.sequences].sort((a,b)=>a.id-b.id)[0];
 const rawSample=Math.trunc(Math.fround(Math.fround(age)*Math.fround(animationRate*512))),lookupSample=selected.flags?Math.min(511,Math.max(0,rawSample)):Math.max(0,rawSample)&511;
 let cursor=lookupSample/512*selected.duration,index=0;
 // Native interpolation retains the previous knot on an exact boundary.
 while(index<selected.frames.length-1&&cursor>selected.frames[index].duration){cursor-=selected.frames[index].duration;index++;}
 let nextIndex=(index+1)%selected.frames.length,blend=clamp(cursor/selected.frames[index].duration);
 if(lookupSample===0){nextIndex=index;blend=1;}
 if(selected.flags&&index===selected.frames.length-1){nextIndex=index;blend=1;}
 return {requestedSequence:sequence,resolvedSequence:selected.id,index,nextIndex,lookupSample,
  blend,uv0:selected.frames[index].images[0],uv1:selected.frames[nextIndex].images[0]};
}
