/** Original rifle/AWP core fire programs. Their original smoke and sparks run
 * in source-muzzle-children.ts, attached by both owning renderers. Core fire
 * numerics and native-verified blend recipes are retained. */
import {prepareSourcePistolParticleGraph,sourcePistolParticleParameters,type SourceParticleNativeDefaults} from './source-pistol-particles-graph';
import {sourcePistolParticleRandomValue} from './source-pistol-particles-random';

export const SOURCE_RIFLE_MUZZLE_PARTICLES_VERSION='csgo-assaultrifle-muzzle-12426148-r1';
export const SOURCE_RIFLE_MUZZLE_ROOT='weapon_muzzle_flash_assaultrifle';
/** The original child that owns the visible sprite flash. */
export const SOURCE_RIFLE_MUZZLE_FLASH_SYSTEM='weapon_muzzle_flash_assaultrifle_vent';
/** The original material the flash draws with, and the original texture it names. */
export const SOURCE_RIFLE_MUZZLE_MATERIAL='materials/particle/particle_muzzleflashx.vmt';
export const SOURCE_RIFLE_MUZZLE_TEXTURE='materials/effects/muzzleflashx.vtf';
export const SOURCE_RIFLE_MUZZLE_LIMITATIONS=[
 '`weapon_muzzle_flash_assaultrifle_vent`, its sibling `weapon_muzzle_flash_assaultrifle_main` (the rolling flame), `_main`\'s own child `weapon_muzzle_flash_assaultrifle_glow` and the dispatcher\'s other flame `weapon_muzzle_flash_assualtrifle_flame` are simulated. The same original system also dispatches `weapon_muzzle_flash_smoke_small2` and both `weapon_shell_eject_smoke_assrifle*` children; their original smoke programs now execute in source-muzzle-children.ts with original atlases and dual-sequence materials.',
 'The original evaluates its smoothed noise field over absolute world time for the vent sprite radius. That field is not reproduced; the value comes from the original scalar table at the authoritative shot seed inside the original 5..7 output range, so both endpoints agree without sharing a clock.',
 'The flame\'s `Sequence Random` asks for sequence 5..18 of a sheet that holds five sequences (ids 0..4). That is not a reading error: the pistol core, which this build already runs and verified against the original machine code, asks the same sheet for the same range, and the original\'s own CSheet fixup aliases a sequence the sheet does not contain to its first. The flame therefore resolves to sequence 0 exactly as the pistol core does.',
 'The flame\'s placement along its path uses the end control point the dispatcher itself sets (local X 17.5) with the path ordinals spread over the particles it maps, so the last one lands on that point; the random spawn offset is added on the same axis. The original\'s own `distance maximum` of 19 is exactly that 17.5 plus the offset\'s 1.5 maximum, which is what fixes both readings. The remaining flame motion fields the original leaves at zero are asserted, not skipped.',
 'The flame\'s `Rotation Yaw Flip Random` is applied as a horizontal mirror of the sprite, the only flip a screen-aligned sprite has; the original\'s native flip flag is not read here.',
 'The original dispatcher\'s first simulation step scheduling and the exact per-initializer RNG call order are not executed; each system emits its original particle count with the original parameter ranges.',
 'SpriteCard depth feathering is available when the scene binds a completed matching-camera depth pass. Native compressed destination-alpha/HDR encoding is adapted to the web depth target.',
]as const;

/** One original vent particle: anchored on the muzzle, no velocity, screen aligned. */
export type SourceRifleMuzzleParticle={id:number;born:number;life:number;radius:number;alpha:number;rotation:number;
  offset:[number,number,number];fadeDuration:number};
export type SourceRifleMuzzleSample=SourceRifleMuzzleParticle&{age:number;currentAlpha:number};
export type SourceRifleMuzzleSeeds={vent:number};
type Graph=ReturnType<typeof prepareSourcePistolParticleGraph>;
export type GraphPhase='initializers'|'operators'|'emitters'|'renderers'|'children'|'forces'|'constraints';
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
/** Original operators store their numbers as float32, so every derived value here is
 * rounded the same way the original's own arithmetic is. */
const f2=Math.fround,lerp=(a:number,b:number,t:number)=>f2(f2(a)+f2(f2(f2(b)-f2(a))*f2(t)));
const number=(values:Record<string,unknown>,key:string)=>{const v=values[key];if(typeof v!=='number'||!Number.isFinite(v))throw Error('Missing original rifle muzzle number: '+key);return v;};
const flag=(values:Record<string,unknown>,key:string)=>{const v=values[key];if(typeof v!=='boolean')throw Error('Missing original rifle muzzle flag: '+key);return v;};
const vector=(values:Record<string,unknown>,key:string)=>{const v=values[key];if(!Array.isArray(v)||v.length!==3||!v.every(n=>typeof n==='number'&&Number.isFinite(n)))throw Error('Missing original rifle muzzle vector: '+key);return v as number[];};
/** Original colours are RGBA in 0..255, with the alpha the system's own alpha
 * operators overwrite. */
const rgba=(values:Record<string,unknown>,key:string)=>{const v=values[key];if(!Array.isArray(v)||v.length!==4||!v.every(n=>typeof n==='number'&&Number.isFinite(n)))throw Error('Missing original rifle muzzle colour: '+key);return v as number[];};

/** Reads only the vent's original configuration. Every phase is enumerated, so
 * an original graph change fails closed instead of being partially applied. */
export function createSourceRifleMuzzleProgram(graph:Graph,native:SourceParticleNativeDefaults){
 const system=SOURCE_RIFLE_MUZZLE_FLASH_SYSTEM;
 // A phase entry is identified by the original operator's own function name, and by
 // the element's name for the reference-only entries (children, forces).
 const names=(phase:GraphPhase)=>graph.phase(system,phase).map(e=>String(e.attributes.functionName??e.name));
 const exact=(phase:GraphPhase,expected:readonly string[])=>{
  const actual=names(phase);
  if(actual.length!==expected.length||actual.some((v,i)=>v!==expected[i]))
   throw Error(`Unsupported original rifle muzzle ${phase}: ${actual.join(', ')||'none'}`);
 };
 exact('emitters',['emit_instantaneously']);
 exact('initializers',['Position Within Sphere Random','Rotation Random','Lifetime Random','Remap Noise to Scalar','Alpha Random']);
 exact('operators',['Movement Basic','Lifespan Decay','Alpha Fade Out Random']);
 exact('renderers',['render_animated_sprites']);
 exact('forces',[]);exact('constraints',[]);
 // The vent parents the original rolling flame. That child and every sibling of
 // the vent stay in the shipped graph as data; this port never draws them.
 const children=names('children');
 const values=(phase:GraphPhase,fn:string)=>{
  const found=graph.phase(system,phase).filter(e=>e.attributes.functionName===fn);
  if(found.length!==1)throw Error('Original rifle muzzle operator absent: '+fn);
  const resolved=sourcePistolParticleParameters(found[0],native);
  if(resolved.unknownOverrides.length)throw Error('Unknown original rifle muzzle override: '+resolved.unknownOverrides.join(', '));
  return resolved.values;
 };
 const element=graph.systems.get(system);
 // The vent is one instant screen-aligned sprite drawn with one original
 // material; anything else in its original definition fails closed instead of
 // being approximated.
 const material=String(element?.attributes.material??'').replace(/\\/g,'/').toLowerCase();
 if(material!==SOURCE_RIFLE_MUZZLE_MATERIAL.replace('materials/',''))throw Error('Unsupported original rifle muzzle material: '+material);
 const emitter=values('emitters','emit_instantaneously'),sphere=values('initializers','Position Within Sphere Random'),
  rotation=values('initializers','Rotation Random'),life=values('initializers','Lifetime Random'),
  noise=values('initializers','Remap Noise to Scalar'),alpha=values('initializers','Alpha Random'),
  movement=values('operators','Movement Basic'),fade=values('operators','Alpha Fade Out Random'),
  renderer=values('renderers','render_animated_sprites');
 const count=number(emitter,'num_to_emit');
 if(count<1||count>16||!Number.isInteger(count))throw Error('Unsupported original rifle muzzle emission count');
 if(number(emitter,'emission_start_time')!==0)throw Error('Unsupported original rifle muzzle emission time');
 if(number(sphere,'control_point_number')!==0)throw Error('Unsupported original rifle muzzle control point');
 if(number(sphere,'speed_min')!==0||number(sphere,'speed_max')!==0
  ||vector(sphere,'speed_in_local_coordinate_system_min').some(v=>v!==0)
  ||vector(sphere,'speed_in_local_coordinate_system_max').some(v=>v!==0))
  throw Error('Unsupported original rifle muzzle spawn velocity');
 // With the original's zero spawn velocity and zero gravity the original
 // Movement Basic leaves the sprite where it spawned, whatever its drag is.
 if(vector(movement,'gravity').some(v=>v!==0))throw Error('Unsupported original rifle muzzle gravity');
 if(number(movement,'drag')<0)throw Error('Unsupported original rifle muzzle drag');
 if(number(noise,'output field')!==3)throw Error('Unsupported original rifle muzzle noise output field');
 if(number(noise,'time noise coordinate scale')<0||number(noise,'spatial noise coordinate scale')<0)
  throw Error('Unsupported original rifle muzzle noise scale');
 if(flag(fade,'proportional 0/1')!==false)throw Error('Unsupported original rifle muzzle fade mode');
 if(number(rotation,'rotation_initial')!==0)throw Error('Unsupported original rifle muzzle rotation base');
 if(number(renderer,'orientation_type')!==0||flag(renderer,'animation_fit_lifetime')!==false||flag(renderer,'use animation rate as FPS')!==false)
  throw Error('Unsupported original rifle muzzle renderer mode');
 const distanceMin=number(sphere,'distance_min'),distanceMax=number(sphere,'distance_max'),
  rotationMin=number(rotation,'rotation_offset_min'),rotationMax=number(rotation,'rotation_offset_max'),
  lifetimeMin=number(life,'lifetime_min'),lifetimeMax=number(life,'lifetime_max'),
  radiusMin=number(noise,'output minimum'),radiusMax=number(noise,'output maximum'),
  alphaMin=number(alpha,'alpha_min'),alphaMax=number(alpha,'alpha_max'),
  fadeMin=number(fade,'fade out time min'),fadeMax=number(fade,'fade out time max'),start=number(emitter,'emission_start_time');
 if(lifetimeMin<=0||lifetimeMax<lifetimeMin||distanceMin<0||distanceMax<distanceMin
  ||radiusMax<radiusMin||alphaMax<alphaMin||fadeMin<=0||fadeMax<fadeMin
  ||alphaMin<0||alphaMax>255||rotationMax<rotationMin)throw Error('Invalid original rifle muzzle range');
 const f=Math.fround,lerp=(a:number,b:number,t:number)=>f(f(a)+f(f(f(b)-f(a))*f(t)));
 const table=(seed:number,offset:number)=>sourcePistolParticleRandomValue((seed+offset)&4095);
 const flip=flag(rotation,'randomly_flip_direction');
 const particle=(index:number,seed:number):SourceRifleMuzzleParticle=>{
  // Original order: the sphere initializer, then rotation, lifetime and alpha,
  // and the noise-remapped radius. Each value is an entry of the original table.
  const direction:[number,number,number]=[table(seed,1)*2-1,table(seed,2)*2-1,table(seed,3)*2-1];
  const length=Math.hypot(direction[0],direction[1],direction[2])||1,distance=lerp(distanceMin,distanceMax,table(seed,4));
  const angle=f((rotationMin+(rotationMax-rotationMin)*table(seed,0))*Math.PI/180);
  return {id:index,born:start,life:lerp(lifetimeMin,lifetimeMax,table(seed,5)),
   radius:lerp(radiusMin,radiusMax,table(seed,7)),
   alpha:lerp(f(alphaMin*f(1/255)),f(alphaMax*f(1/255)),table(seed,8)),
   rotation:flip&&table(seed,6)<.5?-angle:angle,
   offset:[direction[0]/length*distance,direction[1]/length*distance,direction[2]/length*distance],
   fadeDuration:lerp(fadeMin,fadeMax,table(seed,9))};
 };
 return {version:SOURCE_RIFLE_MUZZLE_PARTICLES_VERSION,limitations:SOURCE_RIFLE_MUZZLE_LIMITATIONS,system,
  texture:SOURCE_RIFLE_MUZZLE_TEXTURE,material:SOURCE_RIFLE_MUZZLE_MATERIAL,
  /** Original spawn radius, rotation window, life and fade, for the audit. */
  configuration:{count,start,distanceMin,distanceMax,rotationMin,rotationMax,lifetimeMin,lifetimeMax,radiusMin,radiusMax,
   alphaMin,alphaMax,fadeMin,fadeMax,randomlyFlipDirection:flip,animationRate:number(renderer,'animation rate'),
   /** The original children of the vent this port deliberately does not run. */
   unsimulatedChildren:children},
  emit(seeds:SourceRifleMuzzleSeeds):SourceRifleMuzzleParticle[]{
   if(!Number.isInteger(seeds.vent)||seeds.vent<0||seeds.vent>4095)throw Error('Original rifle muzzle seed outside the original table');
   return Array.from({length:count},(_,index)=>particle(index,seeds.vent));
  }};
}

/** Alpha over age. The original `Alpha Fade Out Random` here spans the whole
 * lifetime, is not proportional, and is eased; the eased branch is the same one
 * verified against the original machine code for the pistol main/core. */
export function sampleSourceRifleMuzzleParticles(particles:readonly SourceRifleMuzzleParticle[],seconds:number){
 if(!Number.isFinite(seconds))throw Error('Invalid rifle muzzle particle clock');
 return particles.flatMap(p=>{
  const age=seconds-p.born;if(age<0||age>=p.life)return[];
  const f=clamp((age-(p.life-p.fadeDuration))/p.fadeDuration),smooth=f*f*(3-2*f);
  return[{...p,age,currentAlpha:Math.max(0,p.alpha*(1-smooth))}];
 });
}

/** The original rolling flame `weapon_muzzle_flash_assaultrifle_main`: eight
 * instant sprites spread along the dispatcher's own control point path, drawn with
 * `fire_particle_4.vmt` (addself, overbright 6) from that texture's sheet. */
export const SOURCE_RIFLE_MUZZLE_FLAME_SYSTEM='weapon_muzzle_flash_assaultrifle_main';
export const SOURCE_RIFLE_MUZZLE_FLAME_MATERIAL='materials/particle/fire_particle_4/fire_particle_4.vmt';
export const SOURCE_RIFLE_MUZZLE_FLAME_TEXTURE='materials/particle/fire_particle_4/fire_particle_4.vtf';
/** The rifle dispatcher's other flame: `weapon_muzzle_flash_assualtrifle_flame`, a
 * childless continuously emitted flame on the AWP chain's shape. The original file spells
 * it `assualtrifle`, and that is the name looked up. It shares `fire_particle_4`'s
 * material and sheet with the rolling flame above. */
export const SOURCE_RIFLE_MUZZLE_CONTINUOUS_SYSTEM='weapon_muzzle_flash_assualtrifle_flame';
export const SOURCE_RIFLE_MUZZLE_CONTINUOUS_MATERIAL='materials/particle/fire_particle_4/fire_particle_4.vmt';
export const SOURCE_RIFLE_MUZZLE_CONTINUOUS_TEXTURE='materials/particle/fire_particle_4/fire_particle_4.vtf';
export const SOURCE_RIFLE_MUZZLE_CONTINUOUS_LIMITATIONS=[
 '`weapon_muzzle_flash_assualtrifle_flame` is simulated: a childless continuous emitter, nine sprites over its own 7.5 ms, swept along the effect local +X from each particle\'s own birth time and drawn with the original `fire_particle_4` addself-overbright material from that texture\'s original sheet.',
 '`Movement Lock to Control Point` is asserted to the configuration in which it cannot move anything: control point 0, all six of its fade times 1, `distance fade range` 0 and `lock rotation` off. Its own fields say the lock keeps the particle at a distance from the control point rather than collapsing it onto one, and this port anchors a burst at a fixed world point for its whole life, so a full lock cannot change a position. A configuration that is not that one is refused.',
 'The original evaluates the sphere initializer with its own rejection sampling; this port draws three uniform components and normalises them, the same adapter the already-ported vent uses, inside the original 0..0.5 unit distance range.',
 'The original depthblend flame requests scene depth through setSourceSpriteCardDepth; no depth fade runs until that owner binds its matching-camera completed pass.',
]as const;
/** One original flame particle. `distance` is its distance to the effect's first
 * control point in original units, which is what the original remaps into its
 * radius and then into its alpha. */
export type SourceRifleMuzzleFlameParticle={id:number;born:number;life:number;radius:number;alpha:number;rotation:number;
  color:[number,number,number];sequence:number;distance:number;offsetX:number;fadeOutDuration:number;
  yawFlipped:boolean};
export type SourceRifleMuzzleFlameSample=SourceRifleMuzzleFlameParticle&{age:number;currentAlpha:number;
  currentRadius:number};

/** The dispatcher's own control point, in original units and in the effect's local
 * space. The flame's path is the straight line from control point 0 (the effect's
 * own origin) to the point its path initializer names. */
function sourceRifleMuzzleControlPoint(graph:Graph,native:SourceParticleNativeDefaults,wanted:number){
 const system=SOURCE_RIFLE_MUZZLE_ROOT,operators=graph.phase(system,'operators');
 if(operators.length!==1||operators[0].attributes.functionName!=='Set Control Point Positions')
  throw Error('Unsupported original rifle muzzle dispatcher');
 const resolved=sourcePistolParticleParameters(operators[0],native);
 if(resolved.unknownOverrides.length)throw Error('Unknown original rifle muzzle dispatcher override: '+resolved.unknownOverrides.join(', '));
 const values=resolved.values;
 if(flag(values,'Set positions in world space')!==false)
  throw Error('Unsupported original rifle muzzle control point space');
 for(const prefix of ['First','Second','Third','Fourth']){
  if(number(values,prefix+' Control Point Number')!==wanted)continue;
  if(number(values,prefix+' Control Point Parent')!==0)
   throw Error('Unsupported original rifle muzzle control point parent');
  return vector(values,prefix+' Control Point Location');
 }
 throw Error('Original rifle muzzle control point absent: '+wanted);
}

/** Reads only `_main`'s original configuration, and the dispatcher's control point
 * its path ends on. Every phase is enumerated, so a changed original graph fails
 * closed instead of being partially applied. */
export function createSourceRifleMuzzleFlameProgram(graph:Graph,native:SourceParticleNativeDefaults){
 const system=SOURCE_RIFLE_MUZZLE_FLAME_SYSTEM;
 const names=(phase:GraphPhase)=>graph.phase(system,phase).map(e=>String(e.attributes.functionName??e.name));
 const exact=(phase:GraphPhase,expected:readonly string[])=>{
  const actual=names(phase);
  if(actual.length!==expected.length||actual.some((v,i)=>v!==expected[i]))
   throw Error(`Unsupported original rifle muzzle flame ${phase}: ${actual.join(', ')||'none'}`);
 };
 exact('emitters',['emit_instantaneously']);
 exact('initializers',['Sequence Random','Rotation Random','Alpha Random','Position Modify Offset Random',
  'Color Random','Rotation Yaw Flip Random','Position Along Path Sequential',
  'Remap Initial Distance to Control Point to Scalar','Lifetime Random','Remap Initial Scalar']);
 exact('operators',['Movement Basic','Lifespan Decay','Alpha Fade Out Random','Radius Scale']);
 exact('renderers',['render_animated_sprites']);
 exact('forces',[]);exact('constraints',[]);
 // `_main` parents the glow, which this build already draws as its own batch.
 exact('children',[SOURCE_RIFLE_MUZZLE_GLOW_SYSTEM]);
 const values=(phase:GraphPhase,fn:string)=>{
  const found=graph.phase(system,phase).filter(e=>e.attributes.functionName===fn);
  if(found.length!==1)throw Error('Original rifle muzzle flame operator absent: '+fn);
  const resolved=sourcePistolParticleParameters(found[0],native);
  if(resolved.unknownOverrides.length)throw Error('Unknown original rifle muzzle flame override: '+resolved.unknownOverrides.join(', '));
  return resolved.values;
 };
 const element=graph.systems.get(system);
 const material=String(element?.attributes.material??'').replace(/\\/g,'/').toLowerCase();
 // The original block omits this material's extension; the export resolved it and
 // recorded why, and the resolution is what is checked here.
 if(material!==SOURCE_RIFLE_MUZZLE_FLAME_MATERIAL.replace('materials/',''))
  throw Error('Unsupported original rifle muzzle flame material: '+material);
 const emitter=values('emitters','emit_instantaneously'),sequence=values('initializers','Sequence Random'),
  rotation=values('initializers','Rotation Random'),alpha=values('initializers','Alpha Random'),
  offset=values('initializers','Position Modify Offset Random'),color=values('initializers','Color Random'),
  yaw=values('initializers','Rotation Yaw Flip Random'),path=values('initializers','Position Along Path Sequential'),
  distance=values('initializers','Remap Initial Distance to Control Point to Scalar'),
  life=values('initializers','Lifetime Random'),scalar=values('initializers','Remap Initial Scalar'),
  movement=values('operators','Movement Basic'),fade=values('operators','Alpha Fade Out Random'),
  scale=values('operators','Radius Scale'),renderer=values('renderers','render_animated_sprites');
 const count=number(emitter,'num_to_emit');
 if(count<1||count>64||!Number.isInteger(count))throw Error('Unsupported original rifle muzzle flame emission count');
 if(number(emitter,'emission_start_time')!==0)throw Error('Unsupported original rifle muzzle flame emission time');
 // `Movement Basic` leaves the flame where the path put it: the original's gravity
 // is zero and its spawn velocity is zero.
 if(vector(movement,'gravity').some(v=>v!==0))throw Error('Unsupported original rifle muzzle flame gravity');
 if(number(movement,'drag')<0)throw Error('Unsupported original rifle muzzle flame drag');
 if(vector(offset,'offset min')[1]!==0||vector(offset,'offset min')[2]!==0||vector(offset,'offset max')[1]!==0
  ||vector(offset,'offset max')[2]!==0||number(offset,'control_point_number')!==0
  ||flag(offset,'offset in local space 0/1')!==true||flag(offset,'offset proportional to radius 0/1')!==false)
  throw Error('Unsupported original rifle muzzle flame spawn offset');
 if(number(rotation,'rotation_initial')!==0)throw Error('Unsupported original rifle muzzle flame rotation base');
 if(number(yaw,'Flip Percentage')!==.5)throw Error('Unsupported original rifle muzzle flame yaw flip rate');
 if(number(color,'tint_perc')!==0||number(color,'output field')!==6)
  throw Error('Unsupported original rifle muzzle flame colour mode');
 // The path is a straight line from control point 0 to control point 1: the original
 // leaves both the bulge and the maximum distance at zero.
 if(flag(path,'Use sequential CP pairs between start and end point')!==false||flag(path,'Save Offset')!==false
  ||number(path,'bulge')!==0||number(path,'maximum distance')!==0||flag(path,'restart behavior (0 = bounce, 1 = loop )')!==true)
  throw Error('Unsupported original rifle muzzle flame path mode');
 const pathStart=number(path,'start control point number'),pathEnd=number(path,'end control point number');
 if(pathStart!==0||pathEnd!==1)throw Error('Unsupported original rifle muzzle flame path control points');
 const mapped=number(path,'particles to map from start to end');
 // The path has to cover exactly the particles that are emitted, or the ordinal that
 // places a particle is undefined; the original's own numbers agree here.
 if(mapped!==count)throw Error('Unsupported original rifle muzzle flame path mapping');
 const endPoint=sourceRifleMuzzleControlPoint(graph,native,pathEnd),pathLength=endPoint[0];
 // The path runs along the effect's local +X and the original leaves the other two
 // axes of its end control point at zero.
 if(endPoint[1]!==0||endPoint[2]!==0||!(pathLength>0))throw Error('Unsupported original rifle muzzle flame path direction');
 if(number(distance,'control point')!==0||number(distance,'output field')!==3)
  throw Error('Unsupported original rifle muzzle flame distance remap');
 if(number(scalar,'input field')!==3||number(scalar,'output field')!==7||flag(scalar,'only active within specified input range')!==false
  ||flag(scalar,'output is scalar of initial random range')!==true)
  throw Error('Unsupported original rifle muzzle flame scalar remap');
 if(flag(fade,'proportional 0/1')!==false||flag(fade,'ease in and out')!==true)
  throw Error('Unsupported original rifle muzzle flame fade mode');
 if(flag(scale,'ease_in_and_out')!==false||number(scale,'scale_bias')!==.5||number(scale,'start_time')<0
  ||number(scale,'end_time')>1||number(scale,'end_time')<=number(scale,'start_time'))
  throw Error('Unsupported original rifle muzzle flame radius scale');
 if(number(renderer,'orientation_type')!==0||flag(renderer,'animation_fit_lifetime')!==false
  ||flag(renderer,'use animation rate as FPS')!==false)
  throw Error('Unsupported original rifle muzzle flame renderer mode');
 const distanceMin=number(distance,'distance minimum'),distanceMax=number(distance,'distance maximum'),
  radiusMin=number(distance,'output minimum'),radiusMax=number(distance,'output maximum'),
  alphaLo=number(scalar,'output minimum'),alphaHi=number(scalar,'output maximum'),
  scalarMin=number(scalar,'input minimum'),scalarMax=number(scalar,'input maximum'),
  offsetMin=vector(offset,'offset min')[0],offsetMax=vector(offset,'offset max')[0],
  lifetimeMin=number(life,'lifetime_min'),lifetimeMax=number(life,'lifetime_max'),
  rotationMin=number(rotation,'rotation_offset_min'),rotationMax=number(rotation,'rotation_offset_max'),
  alphaMin=number(alpha,'alpha_min'),alphaMax=number(alpha,'alpha_max'),
  fadeMin=number(fade,'fade out time min'),fadeMax=number(fade,'fade out time max'),
  sequenceMin=number(sequence,'sequence_min'),sequenceMax=number(sequence,'sequence_max'),
  scaleStart=number(scale,'start_time'),scaleEnd=number(scale,'end_time'),
  scaleLo=number(scale,'radius_start_scale'),scaleHi=number(scale,'radius_end_scale'),
  flip=flag(rotation,'randomly_flip_direction');
 if(lifetimeMin<=0||lifetimeMax<lifetimeMin||distanceMin!==0||distanceMax<distanceMin
  ||radiusMax>radiusMin||alphaMax<alphaMin||alphaMin<0||alphaMax>255||fadeMin<=0||fadeMax<fadeMin
  ||rotationMax<rotationMin||offsetMin<0||offsetMax<offsetMin||scalarMax<=scalarMin||alphaHi<alphaLo
  ||radiusMax!==scalarMin)
  throw Error('Invalid original rifle muzzle flame range');
 const color1=rgba(color,'color1'),color2=rgba(color,'color2');
 const f=Math.fround,lerp=(a:number,b:number,t:number)=>f(f(a)+f(f(f(b)-f(a))*f(t)));
 const table=(seed:number,slot:number)=>sourcePistolParticleRandomValue((seed+slot)&4095);
 const flame=(index:number,seed:number):SourceRifleMuzzleFlameParticle=>{
  // The original dispatcher runs one initializer over the whole batch before moving to
  // the next, so each of these draws is one per particle: slot*count+index. The vent has
  // a single particle, which is why its slots and these differ only by that term.
  const draw=(slot:number)=>table(seed,slot*count+index);
  // The drawing initializers in the original's own order: sequence, rotation, alpha,
  // spawn offset, colour, yaw flip, then lifetime. The path and the two remaps compute
  // from values already placed and draw nothing. `Alpha Random` is drawn here because the
  // original's scalar remap scales it rather than replacing it.
  const angle=f((rotationMin+(rotationMax-rotationMin)*draw(1))*Math.PI/180),
   offsetX=lerp(offsetMin,offsetMax,draw(3)),tint=draw(4),
   alphaDraw=lerp(f2(alphaMin*f(1/255)),f2(alphaMax*f(1/255)),draw(2));
  // The path ordinals run from the start control point to the end one over
  // `particles to map` particles, so the last one sits exactly on the end point.
  const along=f(pathLength*f(index/(count-1))),distanceToStart=f(along+offsetX),
   radius=lerp(radiusMin,radiusMax,clamp(f(f(distanceToStart-distanceMin)/f(distanceMax-distanceMin))));
  return {id:index,born:0,life:lerp(lifetimeMin,lifetimeMax,draw(6)),
   radius,
   // `Remap Initial Scalar` reads the original's radius field and writes its alpha field
   // with `output is scalar of initial random range` set, so it scales the particle's own
   // `Alpha Random` draw by how close that particle is to the muzzle.
   alpha:sourceParticleRemapScalar(radius,alphaDraw,{minimum:scalarMin,maximum:scalarMax,
    outputMinimum:alphaLo,outputMaximum:alphaHi,scalesInitialValue:true}),
   rotation:flip&&draw(5)<.5?-angle:angle,
   color:[0,1,2].map(i=>f(lerp(f(color1[i]*f(1/255)),f(color2[i]*f(1/255)),tint)))as[number,number,number],
   sequence:Math.floor(lerp(sequenceMin,sequenceMax+1,draw(0))),
   distance:distanceToStart,offsetX,fadeOutDuration:lerp(fadeMin,fadeMax,draw(7)),
   yawFlipped:draw(8)<f(number(yaw,'Flip Percentage'))};
 };
 return {version:SOURCE_RIFLE_MUZZLE_PARTICLES_VERSION,limitations:SOURCE_RIFLE_MUZZLE_LIMITATIONS,system,
  texture:SOURCE_RIFLE_MUZZLE_FLAME_TEXTURE,material:SOURCE_RIFLE_MUZZLE_FLAME_MATERIAL,
  /** The original path, radius and alpha windows, for the audit. */
  configuration:{count,mapped,pathLength,endPoint,offsetMin,offsetMax,lifetimeMin,lifetimeMax,
   rotationMin,rotationMax,alphaMin,alphaMax,fadeMin,fadeMax,sequenceMin,sequenceMax,
   distanceMin,distanceMax,radiusMin,radiusMax,scalarMin,scalarMax,alphaLo,alphaHi,
   scaleStart,scaleEnd,scaleLo,scaleHi,color1,color2,randomlyFlipDirection:flip,
   animationRate:number(renderer,'animation rate')},
  emit(seeds:SourceRifleMuzzleSeeds):SourceRifleMuzzleFlameParticle[]{
   if(!Number.isInteger(seeds.vent)||seeds.vent<0||seeds.vent>4095)
    throw Error('Original rifle muzzle seed outside the original table');
   return Array.from({length:count},(_,index)=>flame(index,seeds.vent));
  }};
}

/** Alpha and radius over age for the flame. Alpha fades through the original
 * `Alpha Fade Out Random` eased branch; the radius runs through the original
 * `Radius Scale`, which holds its start scale until its own start time. */
export function sampleSourceRifleMuzzleFlameParticles(particles:readonly SourceRifleMuzzleFlameParticle[],seconds:number,
 scale:{startTime:number;endTime:number;startScale:number;endScale:number}){
 if(!Number.isFinite(seconds))throw Error('Invalid rifle muzzle flame clock');
 const span=scale.endTime-scale.startTime;
 if(!(span>0))throw Error('Invalid rifle muzzle flame radius scale window');
 return particles.flatMap(p=>{
  const age=seconds-p.born;if(age<0||age>=p.life)return[];
  const fade=clamp((age-(p.life-p.fadeOutDuration))/p.fadeOutDuration),smooth=fade*fade*(3-2*fade);
  const t=clamp((age/p.life-scale.startTime)/span);
  return[{...p,age,currentAlpha:Math.max(0,p.alpha*(1-smooth)),
   currentRadius:f2(p.radius*lerp(scale.startScale,scale.endScale,t))}];
 });
}

/** The original AWP third-person muzzle, which is the hunting rifle's continuous flame
 * plus its glow.
 *
 * `items_game.txt` names `weapon_muzzle_flash_awp` for the AWP's third-person flash, and
 * that original system is a pure dispatcher: it adds `weapon_muzzle_flash_smoke_small`,
 * `weapon_muzzle_flash_smoke_small3`, `weapon_muzzle_flash_huntingrifle_main` and
 * `weapon_shell_eject_smoke_awp3`, and it sets **no control points at all** (unlike the
 * assault rifle's dispatcher). The flame's own children are the two sparks systems and
 * `weapon_muzzle_flash_huntingrifle_glow`.
 *
 * Unlike the rifle's `_main`, this flame is emitted continuously: 1200 per second for
 * 7.5 ms, so nine particles whose birth time drives all four of its remaps — position
 * along the barrel, radius, alpha and lifetime. */
export const SOURCE_AWP_MUZZLE_ROOT='weapon_muzzle_flash_awp';
export const SOURCE_AWP_MUZZLE_FLAME_SYSTEM='weapon_muzzle_flash_huntingrifle_main';
export const SOURCE_AWP_MUZZLE_GLOW_SYSTEM='weapon_muzzle_flash_huntingrifle_glow';
export const SOURCE_AWP_MUZZLE_FLAME_MATERIAL='materials/particle/fire_particle_4/fire_particle_4.vmt';
export const SOURCE_AWP_MUZZLE_FLAME_TEXTURE='materials/particle/fire_particle_4/fire_particle_4.vtf';
export const SOURCE_AWP_MUZZLE_GLOW_MATERIAL='materials/particle/particle_glow_04_additive.vmt';
export const SOURCE_AWP_MUZZLE_GLOW_TEXTURE='materials/particle/particle_glow_04.vtf';
/** Every immediate fire child now has an executor; sustained weapon_muzzle_smoke heat is a separate system. */
export const SOURCE_AWP_MUZZLE_UNSIMULATED:readonly string[]=[];
export const SOURCE_AWP_MUZZLE_LIMITATIONS=[
 '`weapon_muzzle_flash_huntingrifle_main` and its child `weapon_muzzle_flash_huntingrifle_glow` are simulated. The same original dispatcher also adds `weapon_muzzle_flash_smoke_small`, `weapon_muzzle_flash_smoke_small3` and `weapon_shell_eject_smoke_awp3`, and the flame adds `weapon_muzzle_flash_sparks2`/`sparks4`; those smoke/trail programs now execute through source-muzzle-children.ts using the original smoke and spark textures.',
 '`Movement Lock to Control Point` is asserted to the configuration in which it cannot move anything: control point 0, all six of its fade times 1, `distance fade range` 0 and `lock rotation` off. Its own fields say the lock keeps the particle at a distance from the control point rather than collapsing it onto one, and this port anchors a burst at a fixed world point for its whole life, so a full lock cannot change a position. A configuration that is not that one is refused.',
 'The original evaluates the sphere initializer with its own rejection sampling; this port draws three uniform components and normalises them, the same adapter the already-ported vent uses, inside the original 0..0.5 unit distance range.',
 'The scene owner supplies matching-camera depth. Native scheduling/RNG call order, environmental Color Random tint and visibility-proxy occlusion queries remain bounded web adapters; original material flags and decoded sheets execute.',
]as const;

/** One original AWP muzzle particle. `distance` is its position along the effect's own
 * local +X in original units: the flame's remap writes it from the particle's birth time,
 * so the burst sweeps forward as it is emitted. */
export type SourceAwpMuzzleParticle={id:number;born:number;life:number;radius:number;alpha:number;rotation:number;
  color:[number,number,number];sequence:number;distance:number;offset:[number,number,number];
  colorFadeStart:number;colorFadeEnd:number;colorFadeTarget:[number,number,number];colorFadeEased:boolean;
  fadesColor:boolean};
export type SourceAwpMuzzleSample=SourceAwpMuzzleParticle&{age:number;currentAlpha:number;
  currentColor:[number,number,number]};
/** The AWP's own chain indexes the same original table under its own seed. */
export type SourceAwpMuzzleSeeds={awp:number};
/** A burst cursor for a continuously emitted effect: the original scalar-table index its
 * own system draws from. Each effect names its own field in its spec, so one effect's
 * cursor cannot be handed to another. */
export type SourceMuzzleSeed=Readonly<Record<string,number>>;

/** The original `Movement Lock to Control Point`, asserted to the configuration in which
 * it cannot change a position. Its fields describe a lock *strength* (a start and end
 * fade, an exponent, and the distance range over which it fades), which only means
 * anything if the particle keeps its own distance from the control point; these effects'
 * dispatchers set no control points, and this port holds a burst's control point fixed
 * for the burst's whole life, so a full lock has nothing to move. Anything else — a
 * partial lock, a distance-dependent one, or a locked rotation — is refused. */
function assertMuzzleMovementLock(values:Record<string,unknown>,label:string){
 const system=` ${label} movement lock`;
 if(number(values,'control_point_number')!==0||number(values,'distance fade range')!==0)
  throw Error('Unsupported original'+system);
 for(const key of ['start_fadeout_min','start_fadeout_max','start_fadeout_exponent','end_fadeout_min',
  'end_fadeout_max','end_fadeout_exponent'])if(number(values,key)!==1)throw Error('Unsupported original'+system);
 if(flag(values,'lock rotation')!==false)throw Error('Unsupported original'+system);
}

/** Reads one of the effect's remaps by the field it writes, and checks the field index the
 * rest of this build reads it back from: `input field` 8 is the particle's birth time,
 * output 0 is position, 3 is radius, 7 is alpha and 1 is lifetime (the index this build's
 * own executed `Lifetime Random` writes). */
function muzzleRemap(graph:Graph,native:SourceParticleNativeDefaults,system:string,label:string,outputField:number){
 const found=graph.phase(system,'initializers')
  .filter(e=>/^remap /i.test(String(e.attributes.functionName)));
 const resolved=found.map(e=>sourcePistolParticleParameters(e,native))
  .filter(row=>number(row.values,'output field')===outputField);
 if(resolved.length!==1)throw Error(`Unsupported original ${label} remap to field ${outputField}`);
 const row=resolved[0];
 if(row.unknownOverrides.length)throw Error(`Unknown original ${label} remap override: ${row.unknownOverrides.join(', ')}`);
 const values=row.values;
 if(number(values,'input field')!==8)throw Error(`Unsupported original ${label} remap input field`);
 return {values,minimum:number(values,'input minimum'),maximum:number(values,'input maximum'),
  outputMinimum:values['output minimum'] as number|number[],outputMaximum:values['output maximum'] as number|number[],
  // With this flag on the original scales the target field's own initial random value
  // rather than writing the mapped value in; the build's own executed code shows both
  // branches, which is why the flag is read per remap instead of assumed.
  scalesInitialValue:flag(values,'output is scalar of initial random range')};
}

/** A continuously emitted muzzle effect: an emitter that runs for a duration, one
 * mid-effect remap per written field, and a renderer. Only the effect's identity is
 * carried here; every number is read from the staged graph inside the shared reader, so
 * a spec can never disagree with the original it claims to be. */
type MuzzleContinuousSpec={system:string;material:string;texture:string;label:string;
  fadesColor:boolean;children:readonly string[];limitations:readonly string[];
  /** The field name of this effect's own burst cursor, so a caller cannot hand one
   * effect another's seed. */
  seedField:string};

/** Shared reader for every continuously emitted muzzle effect this port draws (the AWP's
 * hunting-rifle flame and glow, the rifle's own `_flame`). Each phase is enumerated and
 * every original number is read from the staged graph, so a changed original definition
 * fails closed instead of being partially applied. */
function createMuzzleContinuousProgram(graph:Graph,native:SourceParticleNativeDefaults,spec:MuzzleContinuousSpec){
 const system=spec.system,label=spec.label;
 const names=(phase:GraphPhase)=>graph.phase(system,phase).map(e=>String(e.attributes.functionName??e.name));
 const exact=(phase:GraphPhase,expected:readonly string[])=>{
  const actual=names(phase);
  if(actual.length!==expected.length||actual.some((v,i)=>v!==expected[i]))
   throw Error(`Unsupported original ${label} ${phase}: ${actual.join(', ')||'none'}`);
 };
 const colourFade=spec.fadesColor?['Color Fade']:[];
 exact('emitters',['emit_continuously']);
 exact('initializers',['Position Within Sphere Random','Sequence Random','Rotation Random',
  ...(spec.fadesColor?['Lifetime Random']:[]),'Alpha Random','Position Modify Offset Random','Color Random',
  'remap scalar to vector','remap initial scalar','remap initial scalar',...(spec.fadesColor?[]:['remap initial scalar'])]);
 exact('operators',['Movement Basic','Lifespan Decay','Movement Lock to Control Point',...colourFade]);
 exact('renderers',['render_animated_sprites']);
 exact('forces',[]);exact('constraints',[]);exact('children',[...spec.children]);
 const values=(phase:GraphPhase,fn:string)=>{
  const found=graph.phase(system,phase).filter(e=>e.attributes.functionName===fn);
  if(found.length!==1)throw Error(`Original ${label} operator absent: ${fn}`);
  const resolved=sourcePistolParticleParameters(found[0],native);
  if(resolved.unknownOverrides.length)throw Error(`Unknown original ${label} override: ${resolved.unknownOverrides.join(', ')}`);
  return resolved.values;
 };
 const element=graph.systems.get(system);
  const raw=String(element?.attributes.material??''),canonical=(value:string)=>{
   let path=value.replace(/\\/g,'/').toLowerCase();
   if(!path.startsWith('materials/'))path='materials/'+path;
   return path.endsWith('.vmt')?path:path+'.vmt';
  };
  // A block may name its material without the extension; the export resolved it and
  // recorded why, and that record is what is checked here rather than a re-derived path.
  const recorded=graph.data.materialResolutions?.find(row=>row.systemValue===raw);
  const material=canonical(recorded?recorded.resolved:raw);
  if(material!==spec.material)throw Error(`Unsupported original ${label} material: ${material}`);
 const emitter=values('emitters','emit_continuously'),sphere=values('initializers','Position Within Sphere Random'),
  sequence=values('initializers','Sequence Random'),rotation=values('initializers','Rotation Random'),
  alpha=values('initializers','Alpha Random'),offset=values('initializers','Position Modify Offset Random'),
  color=values('initializers','Color Random'),movement=values('operators','Movement Basic'),
  lock=values('operators','Movement Lock to Control Point'),renderer=values('renderers','render_animated_sprites');
 if(number(emitter,'emission_start_time')!==0)throw Error(`Unsupported original ${label} emission time`);
 const rate=number(emitter,'emission_rate'),duration=number(emitter,'emission_duration');
 // The original emits continuously for its duration, so a burst holds the rate over that
 // duration, whole particles only -- the same idealisation the already-ported continuous
 // pistol core uses. The epsilon keeps a float32 product that lands a hair below its
 // integer from losing a particle (1200 x 0.0075 = 8.9999998); a genuinely fractional
 // product floors (500 x 0.0075 = 3.75 -> 3), which is declared in the limitations.
 const count=Math.floor(rate*duration+1e-6);
 if(!(rate>0)||!(duration>0)||count<1||count>64)
  throw Error(`Unsupported original ${label} emission`);
 if(vector(movement,'gravity').some(v=>v!==0)||number(movement,'drag')!==0)
  throw Error(`Unsupported original ${label} motion`);
 assertMuzzleMovementLock(lock,label);
 if(number(sphere,'control_point_number')!==0
  ||vector(sphere,'speed_in_local_coordinate_system_min').some(v=>v!==0)
  ||vector(sphere,'speed_in_local_coordinate_system_max').some(v=>v!==0))
  throw Error(`Unsupported original ${label} spawn velocity`);
 if(number(offset,'control_point_number')!==0||flag(offset,'offset in local space 0/1')!==true
  ||flag(offset,'offset proportional to radius 0/1')!==false
  ||vector(offset,'offset min').some((v,i)=>i>0&&v!==0)||vector(offset,'offset max').some((v,i)=>i>0&&v!==0))
  throw Error(`Unsupported original ${label} spawn offset`);
 if(number(rotation,'rotation_initial')!==0)throw Error(`Unsupported original ${label} rotation base`);
 if(number(color,'tint_perc')!==0||number(color,'output field')!==6)
  throw Error(`Unsupported original ${label} colour mode`);
 if(number(renderer,'orientation_type')!==0||flag(renderer,'animation_fit_lifetime')!==false
  ||flag(renderer,'use animation rate as FPS')!==false)throw Error(`Unsupported original ${label} renderer mode`);
 const position=muzzleRemap(graph,native,system,label,0),radius=muzzleRemap(graph,native,system,label,3),
  alphaRemap=muzzleRemap(graph,native,system,label,7),lifeRemap=spec.fadesColor?null:muzzleRemap(graph,native,system,label,1);
 if(!Array.isArray(position.outputMinimum)||!Array.isArray(position.outputMaximum)
  ||position.outputMinimum.length!==3||position.outputMaximum.length!==3
  ||position.outputMinimum.some((v,i)=>i>0&&v!==0)||position.outputMaximum.some((v,i)=>i>0&&v!==0))
  throw Error(`Unsupported original ${label} position remap`);
 if(typeof radius.outputMinimum!=='number'||typeof radius.outputMaximum!=='number'
  ||typeof alphaRemap.outputMinimum!=='number'||typeof alphaRemap.outputMaximum!=='number')
  throw Error(`Unsupported original ${label} scalar remap`);
 // The original's own executed code: the radius and lifetime remaps write their mapped
 // value in, and the alpha remap scales the particle's own `Alpha Random` draw.
 if(radius.scalesInitialValue||lifeRemap?.scalesInitialValue)
  throw Error(`Unsupported original ${label} scalar remap mode`);
 if(!alphaRemap.scalesInitialValue)throw Error(`Unsupported original ${label} alpha remap mode`);
 const life=spec.fadesColor?values('initializers','Lifetime Random'):null;
 if(!spec.fadesColor&&(!lifeRemap||typeof lifeRemap.outputMinimum!=='number'||typeof lifeRemap.outputMaximum!=='number'))
  throw Error(`Unsupported original ${label} lifetime remap`);
 // The emission window, the colour pair and the spawn offset are read from the graph
 // rather than taken on trust, so there is nothing a caller could disagree with.
 const sequenceMin=number(sequence,'sequence_min'),sequenceMax=number(sequence,'sequence_max'),
  alphaMin=number(alpha,'alpha_min'),alphaMax=number(alpha,'alpha_max'),
  offsetMin=vector(offset,'offset min')[0],offsetMax=vector(offset,'offset max')[0],
  colour1=rgba(color,'color1'),colour2=rgba(color,'color2'),
  fade=spec.fadesColor?values('operators','Color Fade'):null,
  fadeTarget=fade?rgba(fade,'color_fade'):[0,0,0,255]as number[],
  fadeStart=fade?number(fade,'fade_start_time'):1,fadeEnd=fade?number(fade,'fade_end_time'):1;
 if(sequenceMax<sequenceMin||!(alphaMax>=alphaMin)||!(offsetMax>=offsetMin))
  throw Error(`Invalid original ${label} emission window`);
 if(fade&&(number(fade,'output field')!==6||fadeStart<0||fadeEnd!==1))
  throw Error(`Unsupported original ${label} colour fade`);
 if(life&&(number(life,'lifetime_min')<=0||number(life,'lifetime_max')<number(life,'lifetime_min')))
  throw Error(`Invalid original ${label} lifetime`);
 if(!(position.maximum>position.minimum)||!(radius.maximum>radius.minimum)||!(alphaRemap.maximum>alphaRemap.minimum))
  throw Error(`Invalid original ${label} remap window`);
 if(number(sphere,'distance_min')<0||number(sphere,'distance_max')<number(sphere,'distance_min'))
  throw Error(`Invalid original ${label} spawn distance`);
 const f=f2,lerpScale=(a:number,b:number,t:number)=>f(f(a)+f(f(f(b)-f(a))*f(t))),
  table=(seed:number,slot:number)=>sourcePistolParticleRandomValue((seed+slot)&4095),
  window=(row:ReturnType<typeof muzzleRemap>,birth:number)=>clamp(f(f(birth-f(row.minimum))/f(f(row.maximum)-f(row.minimum))));
 const particle=(index:number,seed:number,birth:number):SourceAwpMuzzleParticle=>{
  // The original runs one initializer over the whole batch before the next, and each
  // initializer takes its own draws; the slot advances in that order, which is the same
  // discipline the already-ported continuous pistol core follows.
  let slot=0;
  const draw=()=>table(seed,(slot++)*count+index);
  // `Position Within Sphere Random`: three uniform components normalised into the
  // original's own distance range (the same adapter the ported vent uses).
  const direction:[number,number,number]=[draw()*2-1,draw()*2-1,draw()*2-1],
   length=Math.hypot(direction[0],direction[1],direction[2])||1,
   sphereDistance=lerpScale(number(sphere,'distance_min'),number(sphere,'distance_max'),draw());
  const sequenceSeed=draw(),rotationSeed=draw(),
   flipSeed=flag(rotation,'randomly_flip_direction')?draw():1,
   lifetimeSeed=life?draw():0;
  // `Alpha Random`'s draw is kept: the alpha remap scales it rather than replacing it.
  const alphaSeed=draw(),offsetSeed=draw(),tint=draw();
  const angle=f((number(rotation,'rotation_offset_min')
    +(number(rotation,'rotation_offset_max')-number(rotation,'rotation_offset_min'))*rotationSeed)*Math.PI/180),
   // The four remaps all read the particle's own birth time, so a continuously emitted
   // burst sweeps forward and thins out as it is born.
   along=lerpScale((position.outputMinimum as number[])[0],(position.outputMaximum as number[])[0],window(position,birth)),
   // `Position Modify Offset Random` adds its own offset on the same local axes.
   fixed=lerpScale(offsetMin,offsetMax,offsetSeed),
   scale=f(sphereDistance/length);
  return {id:index,born:birth,
   life:life?lerpScale(number(life,'lifetime_min'),number(life,'lifetime_max'),lifetimeSeed)
    :sourceParticleRemapScalar(birth,0,{minimum:lifeRemap!.minimum,maximum:lifeRemap!.maximum,
     outputMinimum:lifeRemap!.outputMinimum as number,outputMaximum:lifeRemap!.outputMaximum as number,
     scalesInitialValue:lifeRemap!.scalesInitialValue}),
   radius:sourceParticleRemapScalar(birth,0,{minimum:radius.minimum,maximum:radius.maximum,
    outputMinimum:radius.outputMinimum as number,outputMaximum:radius.outputMaximum as number,
    scalesInitialValue:radius.scalesInitialValue}),
   alpha:sourceParticleRemapScalar(birth,
    lerpScale(f(alphaMin*f(1/255)),f(alphaMax*f(1/255)),alphaSeed),
    {minimum:alphaRemap.minimum,maximum:alphaRemap.maximum,outputMinimum:alphaRemap.outputMinimum as number,
     outputMaximum:alphaRemap.outputMaximum as number,scalesInitialValue:alphaRemap.scalesInitialValue}),
   rotation:flipSeed<.5?-angle:angle,
   color:[0,1,2].map(i=>f(lerpScale(f(colour1[i]*f(1/255)),f(colour2[i]*f(1/255)),tint)))as[number,number,number],
   sequence:Math.floor(lerpScale(sequenceMin,sequenceMax+1,sequenceSeed)),
   distance:along,
   // Local +X is the barrel, +Y is left and +Z is up, exactly Source's particle axes.
   offset:[f(fixed+f(direction[0]*scale)),f(direction[1]*scale),f(direction[2]*scale)],
   colorFadeStart:fadeStart,colorFadeEnd:fadeEnd,
   colorFadeTarget:[0,1,2].map(i=>f((fadeTarget[i])*f(1/255)))as[number,number,number],
   colorFadeEased:fade?flag(fade,'ease_in_and_out'):false,fadesColor:spec.fadesColor};
 };
 const increment=f(duration/count);
 return {system,texture:spec.texture,material:spec.material,limitations:spec.limitations,
  /** The original emission, windows and colour pair, for the audit. */
  configuration:{count,rate,duration,increment,sequenceMin,sequenceMax,
   alphaMin,alphaMax,offsetMin,offsetMax,
   sphereMin:number(sphere,'distance_min'),sphereMax:number(sphere,'distance_max'),
   positionMinimum:position.outputMinimum,positionMaximum:position.outputMaximum,
   radiusMinimum:radius.outputMinimum,radiusMaximum:radius.outputMaximum,
   alphaMinimum:alphaRemap.outputMinimum,alphaMaximum:alphaRemap.outputMaximum,
   lifetimeMinimum:life?number(life,'lifetime_min'):(lifeRemap!.outputMinimum as number),
   lifetimeMaximum:life?number(life,'lifetime_max'):(lifeRemap!.outputMaximum as number),
   fadeStart,fadeEnd,colour1,colour2,animationRate:number(renderer,'animation rate')},
  emit(seeds:SourceMuzzleSeed):SourceAwpMuzzleParticle[]{
   const seed=seeds[spec.seedField];
   if(!Number.isInteger(seed)||seed<0||seed>4095)
    throw Error(`Original ${label} seed outside the original table`);
   return Array.from({length:count},(_,index)=>particle(index,seed,f(Math.min(duration,increment*(index+1)))));
  }};
}

export function createSourceAwpMuzzleFlameProgram(graph:Graph,native:SourceParticleNativeDefaults){
 return createMuzzleContinuousProgram(graph,native,{system:SOURCE_AWP_MUZZLE_FLAME_SYSTEM,
  material:SOURCE_AWP_MUZZLE_FLAME_MATERIAL,texture:SOURCE_AWP_MUZZLE_FLAME_TEXTURE,label:'AWP muzzle flame',
  fadesColor:false,children:['weapon_muzzle_flash_sparks2',SOURCE_AWP_MUZZLE_GLOW_SYSTEM,'weapon_muzzle_flash_sparks4'],
  limitations:SOURCE_AWP_MUZZLE_LIMITATIONS,seedField:'awp'});
}

/** The rifle's own `weapon_muzzle_flash_assualtrifle_flame`, the AWP flame's twin: the
 * same childless continuous emitter of `fire_particle_4` on the same shape of chain, with
 * its own numbers (alpha 100..120, its own `color1`, and the radius remap down to 8). The
 * spelling in the original's own file is `assualtrifle`, and that spelling is what is
 * looked up rather than the rifle dispatcher's `assaultrifle`. */
export function createSourceRifleMuzzleContinuousFlameProgram(graph:Graph,native:SourceParticleNativeDefaults){
 return createMuzzleContinuousProgram(graph,native,{system:SOURCE_RIFLE_MUZZLE_CONTINUOUS_SYSTEM,
  material:SOURCE_RIFLE_MUZZLE_CONTINUOUS_MATERIAL,texture:SOURCE_RIFLE_MUZZLE_CONTINUOUS_TEXTURE,
  label:'rifle muzzle continuous flame',fadesColor:false,children:[],
  limitations:SOURCE_RIFLE_MUZZLE_CONTINUOUS_LIMITATIONS,seedField:'vent'});
}

export function createSourceAwpMuzzleGlowProgram(graph:Graph,native:SourceParticleNativeDefaults){
 return createMuzzleContinuousProgram(graph,native,{system:SOURCE_AWP_MUZZLE_GLOW_SYSTEM,
  material:SOURCE_AWP_MUZZLE_GLOW_MATERIAL,texture:SOURCE_AWP_MUZZLE_GLOW_TEXTURE,label:'AWP muzzle glow',
  fadesColor:true,children:[],limitations:SOURCE_AWP_MUZZLE_LIMITATIONS,seedField:'awp'});
}

/** Alpha and colour over age. Neither of these systems fades its alpha out: the flame's
 * alpha comes from its own birth-time remap and the glow's `Color Fade` only runs its
 * colour to the original target, so both hold their alpha for the particle's whole life
 * and disappear with it. */
export function sampleSourceAwpMuzzleParticles(particles:readonly SourceAwpMuzzleParticle[],seconds:number){
 if(!Number.isFinite(seconds))throw Error('Invalid AWP muzzle particle clock');
 return particles.flatMap(p=>{
  const age=seconds-p.born;if(age<0||age>=p.life)return[];
  return[{...p,age,currentAlpha:p.alpha,
   currentColor:p.fadesColor
    ?sourceParticleColorFade(p.color,p.colorFadeTarget,age,p.life,p.colorFadeStart,p.colorFadeEnd,p.colorFadeEased)
    :p.color}];
 });
}
/** The original `Remap Initial Scalar`.
 *
 * Its `output is scalar of initial random range` field decides between two behaviours,
 * and this build's own executed code shows both branches: the rifle's continuous flame
 * has a radius remap with the flag off that wrote 15 down to 1 outright, and an alpha
 * remap with the flag on that multiplied the particle's `Alpha Random` draw by the
 * remapped 0.5 down to 0 (0.4643 x 0.4583 = 0.2128). So with the flag on the mapped value
 * scales the field's own initial random value, and with it off the mapped value is written
 * straight in. `input` is the field the remap reads and `initialValue` the target field's
 * own initial value; both are only ever taken from the graph. */
export function sourceParticleRemapScalar(input:number,initialValue:number,
 window:{minimum:number;maximum:number;outputMinimum:number;outputMaximum:number;scalesInitialValue:boolean}){
 if(![input,initialValue,window.minimum,window.maximum,window.outputMinimum,window.outputMaximum].every(Number.isFinite)
  ||!(window.maximum>window.minimum))throw Error('Invalid original scalar remap input');
 const t=clamp(f2(f2(input-window.minimum)/f2(window.maximum-window.minimum))),
  mapped=lerp(window.outputMinimum,window.outputMaximum,t);
 return window.scalesInitialValue?f2(initialValue*mapped):mapped;
}

/** The original child of `weapon_muzzle_flash_assaultrifle_main` that puts the
 * bright flare at the muzzle: one instant sprite, no motion, one frame. */
export const SOURCE_RIFLE_MUZZLE_GLOW_SYSTEM='weapon_muzzle_flash_assaultrifle_glow';
export const SOURCE_RIFLE_MUZZLE_GLOW_MATERIAL='materials/particle/particle_flares/particle_flare_004.vmt';
export const SOURCE_RIFLE_MUZZLE_GLOW_TEXTURE='materials/particle/particle_flares/particle_flare_004.vtf';

/** One original glow particle: a screen-aligned flare at the muzzle, held still by
 * `Movement Basic` (the original leaves gravity and drag at their zero defaults). */
export type SourceRifleMuzzleGlowParticle={id:number;born:number;life:number;radius:number;alpha:number;rotation:number;
  sequence:number;color:[number,number,number];fadeOutDuration:number;colorFadeStart:number;colorFadeEnd:number;
  colorFadeTarget:[number,number,number];colorFadeEased:boolean};
export type SourceRifleMuzzleGlowSample=SourceRifleMuzzleGlowParticle&{age:number;currentAlpha:number;
  currentColor:[number,number,number]};

/** The original `Color Fade` operator, which is Valve's `C_OP_ColorInterpolate`: a
 * particle goes from the colour it had at `fade_start_time` to `color_fade`, and
 * reaches it at `fade_end_time`. Both times are fractions of the particle's lifetime
 * (the build's own defaults are 0 and 1, i.e. the whole life) and the original eases
 * the interpolation by default. */
export function sourceParticleColorFade(initial:readonly[number,number,number],target:readonly[number,number,number],
 age:number,life:number,start:number,end:number,eased:boolean):[number,number,number]{
 if(!Number.isFinite(age)||!Number.isFinite(life)||life<=0||!Number.isFinite(start)||!Number.isFinite(end)||end<start)
  throw Error('Invalid original particle colour fade window');
 const span=end-start,t=eased?(f=>f*f*(3-2*f))(clamp((age/life-start)/span)):clamp((age/life-start)/span);
 return [0,1,2].map(i=>f2(lerp(initial[i],target[i],t)))as[number,number,number];
}

/** Reads only the glow's original configuration, with every phase enumerated so an
 * original graph change fails closed instead of being partially applied. */
export function createSourceRifleMuzzleGlowProgram(graph:Graph,native:SourceParticleNativeDefaults){
 const system=SOURCE_RIFLE_MUZZLE_GLOW_SYSTEM;
 const names=(phase:GraphPhase)=>graph.phase(system,phase).map(e=>String(e.attributes.functionName??e.name));
 const exact=(phase:GraphPhase,expected:readonly string[])=>{
  const actual=names(phase);
  if(actual.length!==expected.length||actual.some((v,i)=>v!==expected[i]))
   throw Error(`Unsupported original rifle muzzle glow ${phase}: ${actual.join(', ')||'none'}`);
 };
 exact('emitters',['emit_instantaneously']);
 exact('initializers',['Sequence Random','Rotation Random','Lifetime Random','Color Random','Alpha Random',
  'Position Within Box Random']);
 exact('operators',['Movement Basic','Lifespan Decay','Color Fade','Alpha Fade Out Random']);
 exact('renderers',['render_animated_sprites']);
 exact('forces',[]);exact('constraints',[]);exact('children',[]);
 const values=(phase:GraphPhase,fn:string)=>{
  const found=graph.phase(system,phase).filter(e=>e.attributes.functionName===fn);
  if(found.length!==1)throw Error('Original rifle muzzle glow operator absent: '+fn);
  const resolved=sourcePistolParticleParameters(found[0],native);
  if(resolved.unknownOverrides.length)throw Error('Unknown original rifle muzzle glow override: '+resolved.unknownOverrides.join(', '));
  return resolved.values;
 };
 const element=graph.systems.get(system);
 const material=String(element?.attributes.material??'').replace(/\\/g,'/').toLowerCase();
 if(material!==SOURCE_RIFLE_MUZZLE_GLOW_MATERIAL.replace('materials/',''))
  throw Error('Unsupported original rifle muzzle glow material: '+material);
 const emitter=values('emitters','emit_instantaneously'),sequence=values('initializers','Sequence Random'),
  rotation=values('initializers','Rotation Random'),life=values('initializers','Lifetime Random'),
  color=values('initializers','Color Random'),alpha=values('initializers','Alpha Random'),
  box=values('initializers','Position Within Box Random'),movement=values('operators','Movement Basic'),
  fade=values('operators','Color Fade'),alphaFade=values('operators','Alpha Fade Out Random'),
  renderer=values('renderers','render_animated_sprites');
 const count=number(emitter,'num_to_emit');
 if(count<1||count>16||!Number.isInteger(count))throw Error('Unsupported original rifle muzzle glow emission count');
 if(number(emitter,'emission_start_time')!==0)throw Error('Unsupported original rifle muzzle glow emission time');
 // A box with a volume would need the operator's local/world rule; the original here
 // is the zero default, so the flare sits on the control point with no offset.
 if(vector(box,'min').some(v=>v!==0)||vector(box,'max').some(v=>v!==0)
  ||number(box,'control point number')!==0||flag(box,'use local space')!==false)
  throw Error('Unsupported original rifle muzzle glow spawn box');
 if(vector(movement,'gravity').some(v=>v!==0)||number(movement,'drag')!==0)
  throw Error('Unsupported original rifle muzzle glow motion');
 if(number(rotation,'rotation_initial')!==0)throw Error('Unsupported original rifle muzzle glow rotation base');
  if(number(fade,'output field')!==6)throw Error('Unsupported original rifle muzzle glow colour fade output field');
 if(flag(alphaFade,'proportional 0/1')!==false)throw Error('Unsupported original rifle muzzle glow fade mode');
 if(number(renderer,'orientation_type')!==0||flag(renderer,'animation_fit_lifetime')!==false
  ||flag(renderer,'use animation rate as FPS')!==false)throw Error('Unsupported original rifle muzzle glow renderer mode');
 const radius=number(element?.attributes??{},'radius');
 const lifetimeMin=number(life,'lifetime_min'),lifetimeMax=number(life,'lifetime_max'),
  rotationMin=number(rotation,'rotation_offset_min'),rotationMax=number(rotation,'rotation_offset_max'),
  alphaMin=number(alpha,'alpha_min'),alphaMax=number(alpha,'alpha_max'),
  fadeMin=number(alphaFade,'fade out time min'),fadeMax=number(alphaFade,'fade out time max'),
  color1=rgba(color,'color1'),color2=rgba(color,'color2'),
  fadeTarget=rgba(fade,'color_fade'),fadeStart=number(fade,'fade_start_time'),fadeEnd=number(fade,'fade_end_time'),
  sequenceMin=number(sequence,'sequence_min'),sequenceMax=number(sequence,'sequence_max');
 if(lifetimeMin<=0||lifetimeMax<lifetimeMin||radius<=0||alphaMin<0||alphaMax>255||alphaMax<alphaMin
  ||rotationMax<rotationMin||fadeMin<=0||fadeMax<=0||fadeStart<0||fadeEnd!==1)
  throw Error('Invalid original rifle muzzle glow range');
 const table=(seed:number,offset:number)=>sourcePistolParticleRandomValue((seed+offset)&4095);
 const flip=flag(rotation,'randomly_flip_direction'),eased=flag(fade,'ease_in_and_out');
 const p=(index:number,seed:number):SourceRifleMuzzleGlowParticle=>{
  const angle=f2((rotationMin+(rotationMax-rotationMin)*table(seed,10))*Math.PI/180);
  const tint=table(seed,11);
  return {id:index,born:0,life:lerp(lifetimeMin,lifetimeMax,table(seed,12)),radius,
   alpha:lerp(f2(alphaMin*f2(1/255)),f2(alphaMax*f2(1/255)),table(seed,13)),
   rotation:flip&&table(seed,14)<.5?-angle:angle,
   sequence:Math.floor(lerp(sequenceMin,sequenceMax+1,table(seed,15))),
   color:[0,1,2].map(i=>f2(lerp(f2(color1[i]*f2(1/255)),f2(color2[i]*f2(1/255)),tint)))as[number,number,number],
   fadeOutDuration:lerp(fadeMin,fadeMax,table(seed,16)),colorFadeStart:fadeStart,colorFadeEnd:fadeEnd,
   colorFadeTarget:[0,1,2].map(i=>f2(fadeTarget[i]*f2(1/255)))as[number,number,number],colorFadeEased:eased};
 };
 return {version:SOURCE_RIFLE_MUZZLE_PARTICLES_VERSION,limitations:SOURCE_RIFLE_MUZZLE_LIMITATIONS,system,
  texture:SOURCE_RIFLE_MUZZLE_GLOW_TEXTURE,material:SOURCE_RIFLE_MUZZLE_GLOW_MATERIAL,
  /** The original flare radius, alpha, colour window and colour fade, for the audit. */
  configuration:{count,radius,lifetimeMin,lifetimeMax,rotationMin,rotationMax,alphaMin,alphaMax,fadeMin,fadeMax,
   sequenceMin,sequenceMax,color1,color2,fadeTarget,fadeStart,fadeEnd,colorFadeEased:eased,
   randomlyFlipDirection:flip,animationRate:number(renderer,'animation rate')},
  emit(seeds:SourceRifleMuzzleSeeds):SourceRifleMuzzleGlowParticle[]{
   if(!Number.isInteger(seeds.vent)||seeds.vent<0||seeds.vent>4095)throw Error('Original rifle muzzle seed outside the original table');
   return Array.from({length:count},(_,index)=>p(index,seeds.vent));
  }};
}

/** Alpha and colour over age for the glow. The colour runs through the original
 * `Color Fade`; the alpha through the same eased `Alpha Fade Out Random` branch the
 * vent uses. */
export function sampleSourceRifleMuzzleGlowParticles(particles:readonly SourceRifleMuzzleGlowParticle[],seconds:number){
 if(!Number.isFinite(seconds))throw Error('Invalid rifle muzzle glow clock');
 return particles.flatMap(p=>{
  const age=seconds-p.born;if(age<0||age>=p.life)return[];
  const f=clamp((age-(p.life-p.fadeOutDuration))/p.fadeOutDuration),smooth=f*f*(3-2*f);
  return[{...p,age,currentAlpha:Math.max(0,p.alpha*(1-smooth)),
   currentColor:sourceParticleColorFade(p.color,p.colorFadeTarget,age,p.life,p.colorFadeStart,p.colorFadeEnd,p.colorFadeEased)}];
 });
}
