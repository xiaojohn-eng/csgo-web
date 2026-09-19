/** Muzzle dispatcher's original smoke and spark children. PCF numbers are read
 * with this build's executed native defaults. Movement's recurrence is measured
 * in research/source-movement-basic-apply.json; spawn previous-position seeding
 * and Velocity Noise are checked by scripts/probe-source-child-initializers.py.
 * We use a deterministic 60 Hz effect clock, while native scheduling/RNG call
 * order remain adapters. Smoke spatial noise uses effect-local coordinates when
 * the caller does not supply original Source-space coordinates. */
import {sourcePistolParticleParameters, type SourceParticleNativeDefaults, type prepareSourcePistolParticleGraph} from './source-pistol-particles-graph';
import {sourcePistolParticleRandomValue} from './source-pistol-particles-random';
import {sourceParticleNoise} from './source-particle-noise';
export type SourceParticleVec3=[number,number,number];
type Graph=ReturnType<typeof prepareSourcePistolParticleGraph>;
type Values=Record<string,unknown>;
const f=Math.fround,clamp=(x:number)=>Math.max(0,Math.min(1,x));
const mix=(a:number,b:number,t:number)=>f(f(a)+f(f(b-a)*f(t)));
const num=(v:Values,k:string)=>{const x=v[k];if(typeof x!=='number'||!Number.isFinite(x))throw Error('Missing original child number '+k);return x;};
const vec=(v:Values,k:string)=>{const x=v[k];if(!Array.isArray(x)||x.length!==3||!x.every(Number.isFinite))throw Error('Missing original child vector '+k);return x as SourceParticleVec3;};
const bias=(x:number,b:number)=>b===.5?x:Math.pow(clamp(x),Math.log(b)/Math.log(.5));
const ease=(x:number)=>x*x*(3-2*x);
export const SOURCE_MUZZLE_CHILD_SYSTEMS={rifle:['weapon_muzzle_flash_smoke_small2','weapon_shell_eject_smoke_assrifle2','weapon_shell_eject_smoke_assrifle3'],
 awp:['weapon_muzzle_flash_smoke_small','weapon_muzzle_flash_smoke_small3','weapon_shell_eject_smoke_awp3','weapon_muzzle_flash_sparks2','weapon_muzzle_flash_sparks4'],grenade:['explosion_child_distort01c','explosion_child_smoke03e','explosion_child_smoke07b','explosion_child_smoke_bottom','explosion_child_smoke03d_ring']} as const;
const supportedInitializers=['Position Within Sphere Random','Sequence Random','Sequence Two Random','Rotation Random','Lifetime Random','Remap Noise to Scalar','Position Modify Warp Random','Alpha Random','Position Modify Offset Random','Color Random','Rotation Yaw Flip Random','Radius Random','Trail Length Random','Velocity Noise','Position Along Ring'];
const supportedOperators=['Movement Basic','Lifespan Decay','Radius Scale','Alpha Fade Out Random','Alpha Fade In Random',"Set Control Point To Particles' Center",'Rotation Basic','Color Fade','Rotation Spin Roll'];
export type SourceMuzzleChildParticle={id:number;born:number;life:number;radius:number;alpha:number;rotation:number;sequence:number;sequence2:number;yawFlipped:boolean;color:SourceParticleVec3;position:SourceParticleVec3;velocity:SourceParticleVec3;trailLength:number;fadeIn:number;fadeOut:number;trajectory:SourceParticleVec3[]};
/** One original Verlet update. interval is the previous integration interval;
 * first previous position is P-V/30 (measured with the original initializer). */
export function sourceParticleMovementBasic(position:readonly number[],previous:readonly number[],gravity:readonly number[],drag:number,dt:number,interval:number):SourceParticleVec3{
 const factor=f(f(Math.pow(Math.max(0,1-Math.max(drag,0)),30*dt))*f(dt/interval));
 return position.map((p,i)=>f(f(p+f(f(p-previous[i])*factor))+f(f(gravity[i]*dt)*dt))) as SourceParticleVec3;
}
/** Native 0xced250 uses these three noise-coordinate offsets at
 * 0x110cfbc..0x110cfd0; first component uses the unshifted point. */
export function sourceMuzzleVelocityNoise(position:SourceParticleVec3,born:number,parameters:Values):SourceParticleVec3{
 const offset=vec(parameters,'Spatial Coordinate Offset'),spatial=num(parameters,'Spatial Noise Coordinate Scale'),time=f(f(born+num(parameters,'Time Coordinate Offset'))*num(parameters,'Time Noise Coordinate Scale'));
 const p=position.map((v,i)=>f(f(f(v+offset[i])*spatial)+time));
 const shifts=[[0,0,0],[100000.5,300000.25,9000001],[110000.25,310000.75,9100000]];
 const lo=vec(parameters,'output minimum'),hi=vec(parameters,'output maximum');
 return shifts.map((s,i)=>{let n=sourceParticleNoise(f(p[0]+s[0]),f(p[1]+s[1]),f(p[2]+s[2]));if(vec(parameters,'Absolute Value')[i])n=Math.abs(n);if(vec(parameters,'Invert Abs Value')[i])n=1-n;return mix(lo[i],hi[i],vec(parameters,'Absolute Value')[i]?n:f(f(n+1)*.5));})as SourceParticleVec3;
}
/** Executed native Color Random (0xd00c60 / 0xced000): byte endpoints become
 * floats once; cached CP lighting is clamped, amplified and blended in that
 * space. SpriteCard applies the original compiled gamma 2.2 conversion;
 * Three's piecewise sRGB conversion must not be applied here as well. */
export function sourceParticleColorRandom(parameters:Values,random:number,lightingColor?:SourceParticleVec3):SourceParticleVec3{
 const a=parameters.color1 as number[],b=parameters.color2 as number[];
 const base=a.slice(0,3).map((x,i)=>mix(f(x/255),f(b[i]/255),random)) as SourceParticleVec3;
 if(!lightingColor||num(parameters,'tint_perc')===0)return base;
 const lo=parameters['tint clamp min'] as number[],hi=parameters['tint clamp max'] as number[],mode=num(parameters,'tint blend mode');
 const light=lightingColor.map((v,i)=>f(f(Math.max(lo[i],Math.min(hi[i],v)))*f(f(1/255)*num(parameters,'light amplification amount'))));
 return base.map((x,i)=>{const y=light[i];let target:number;
  switch(mode){case 0:target=y;break;case 1:target=y<.5?f(f(2*y)*x):f(1+f(f(2*f(y-1))*f(1-x)));break;case 2:target=Math.min(x,y);break;case 3:target=Math.max(x,y);break;case 4:target=f(x*y);break;default:throw Error('Unsupported native particle tint blend mode');}
  return Math.min(1,mix(x,target,num(parameters,'tint_perc')));
 }) as SourceParticleVec3;
}
export function createSourceMuzzleChildProgram(graph:Graph,native:SourceParticleNativeDefaults,system:string){
 if(!Object.values(SOURCE_MUZZLE_CHILD_SYSTEMS).some(names=>(names as readonly string[]).includes(system)))throw Error('Unsupported original muzzle child '+system);
 const phases=['emitters','initializers','operators','renderers','forces','constraints','children']as const;
 const byPhase=Object.fromEntries(phases.map(phase=>[phase,graph.phase(system,phase).map(e=>{const p=sourcePistolParticleParameters(e,native);if(p.unknownOverrides.length)throw Error('Unknown original child override '+p.unknownOverrides.join(','));return {name:String(e.attributes.functionName??e.name),values:p.values};})]));
 for(const phase of ['constraints','children'])if(byPhase[phase].length)throw Error('Unsupported original child '+phase);
 for(const [phase,supported]of [['initializers',supportedInitializers],['operators',supportedOperators]]as const)for(const row of byPhase[phase])if(!supported.includes(row.name))throw Error('Unsupported original child '+row.name);
 for(const row of byPhase.forces)if(!['random force','time varying force'].includes(row.name))throw Error('Unsupported original child force '+row.name);
 const pick=(phase:string,name:string,required=false)=>{const rows=byPhase[phase].filter(e=>e.name===name);if(rows.length>1||required&&rows.length!==1)throw Error('Original child operator absent/duplicate '+name);return rows[0]?.values;};
 if(byPhase.emitters.length!==1||!['emit_instantaneously','emit_continuously'].includes(byPhase.emitters[0].name))throw Error('Unsupported original child emitter');
 const spark=system.includes('sparks');if(byPhase.renderers.length!==1||byPhase.renderers[0].name!==(spark?'render_sprite_trail':'render_animated_sprites'))throw Error('Unsupported original child renderer');
 const emitter=byPhase.emitters[0].values,renderer=byPhase.renderers[0].values,movement=pick('operators','Movement Basic')??{gravity:[0,0,0],drag:0};
 const continuous=byPhase.emitters[0].name==='emit_continuously',maxParticles=Number(graph.systems.get(system)?.attributes.max_particles??2048);
 const count=continuous?Math.floor(num(emitter,'emission_rate')*num(emitter,'emission_duration')):Math.min(maxParticles,num(emitter,'num_to_emit'));
 if(!Number.isInteger(count)||count<1||count>2048||num(emitter,'emission_start_time')<0)throw Error('Unsupported original child emission');
 const materialName='materials/'+String(graph.systems.get(system)?.attributes.material).replace(/\\/g,'/').toLowerCase();
 const material=graph.data.materials.find(m=>m.source===materialName);if(!material)throw Error('Original muzzle child material absent');
 const shader=material.definition.spritecard?'spritecard':material.definition.refract?'refract':null;
 if(!shader)throw Error('Unsupported original child material shader');const materialValues=material.definition[shader] as Record<string,string>;
 const texture=material.textures.find(t=>t.parameter.at(-1)===(shader==='refract'?'$normalmap':'$basetexture'))?.source;if(!texture)throw Error('Original child texture absent');
 const sphere=pick('initializers','Position Within Sphere Random')??{distance_min:0,distance_max:0,distance_bias:[1,1,1],distance_bias_absolute_value:[0,0,0],'bias in local system':true,control_point_number:0,speed_min:0,speed_max:0,speed_random_exponent:1,speed_in_local_coordinate_system_min:[0,0,0],speed_in_local_coordinate_system_max:[0,0,0],'scale cp (distance/speed/local speed)':-1},warp=pick('initializers','Position Modify Warp Random'),offset=pick('initializers','Position Modify Offset Random');
 if(num(sphere,'control_point_number')!==0||num(sphere,'scale cp (distance/speed/local speed)')!==-1)throw Error('Unsupported original child sphere frame');
 if(warp&&(num(warp,'control point number')!==0||num(warp,'warp transition time (treats min/max as start/end sizes)')!==0||warp['reverse warp (0/1)']!==false))throw Error('Unsupported original child warp');
 if(offset&&(num(offset,'control_point_number')!==0||offset['offset proportional to radius 0/1']!==false))throw Error('Unsupported original child offset');
 const radiusScale=pick('operators','Radius Scale'),fadeIn=pick('operators','Alpha Fade In Random'),fadeOut=pick('operators','Alpha Fade Out Random'),colorFade=pick('operators','Color Fade');
 const configuration={count,spark,shader,renderer,movement,material:materialValues,texture,phases:byPhase,maxParticles,continuous};
 function emit(seed:number,context:{lightingColor?:SourceParticleVec3;born?:number;sourcePosition?:SourceParticleVec3;noiseTransform?:(p:SourceParticleVec3)=>SourceParticleVec3;gravity?:SourceParticleVec3;worldToLocal?:(v:SourceParticleVec3)=>SourceParticleVec3}={}):SourceMuzzleChildParticle[]{
  if(!Number.isInteger(seed)||seed<0||seed>4095)throw Error('Original child seed outside original table');
  let cursor=0;const rnd=()=>sourcePistolParticleRandomValue((seed+cursor++)&4095);
  const draw=(v:Values,k0:string,k1:string,exponent=1)=>mix(num(v,k0),num(v,k1),Math.pow(rnd(),exponent));
  const drawVec=(v:Values,k0:string,k1:string)=>vec(v,k0).map((a,i)=>mix(a,vec(v,k1)[i],rnd()))as SourceParticleVec3;
  const countMin=continuous?-1:num(emitter,'num_to_emit_minimum');const actualCount=countMin<0?count:Math.min(maxParticles,Math.floor(countMin+rnd()*(num(emitter,'num_to_emit')-countMin+1)));
  return Array.from({length:actualCount},(_,id)=>{
   // The sphere's original rejection sphere, then directional bias normalisation.
   let direction:SourceParticleVec3=[0,0,0],length=0;
   do{direction=[rnd()*2-1,rnd()*2-1,rnd()*2-1];length=Math.hypot(...direction);}while(length>1||length<1e-8);
   direction=direction.map((v,i)=>(vec(sphere,'distance_bias_absolute_value')[i]?Math.abs(v):v)*vec(sphere,'distance_bias')[i])as SourceParticleVec3;
   length=Math.hypot(...direction);direction=direction.map(v=>v/length)as SourceParticleVec3;
   const distance=draw(sphere,'distance_min','distance_max'),speed=draw(sphere,'speed_min','speed_max',num(sphere,'speed_random_exponent'));
   let position=direction.map(v=>f(v*distance))as SourceParticleVec3;
   let velocity=drawVec(sphere,'speed_in_local_coordinate_system_min','speed_in_local_coordinate_system_max').map((v,i)=>f(v+direction[i]*speed))as SourceParticleVec3;
   const particle:SourceMuzzleChildParticle={id,born:num(emitter,'emission_start_time')+(continuous?(id+1)/num(emitter,'emission_rate'):0),life:0,radius:Number(graph.systems.get(system)?.attributes.radius??1),alpha:1,rotation:0,sequence:0,sequence2:0,yawFlipped:false,color:[1,1,1],position,velocity,trailLength:0,fadeIn:0,fadeOut:0,trajectory:[]};
   for(const row of byPhase.initializers){const v=row.values;
    switch(row.name){
     case'Position Within Sphere Random':break;
     case'Position Along Ring':{
      if(num(v,'control point number')!==0||num(v,'min initial speed')!==0||num(v,'max initial speed')!==0||[num(v,'yaw'),num(v,'roll'),num(v,'pitch')].some(x=>x!==0)||v['even distribution']!==true)throw Error('Unsupported original ring frame/speed');
      let jitter:SourceParticleVec3;do{jitter=[rnd()*2-1,rnd()*2-1,rnd()*2-1];}while(Math.hypot(...jitter)>1);
      const total=num(v,'even distribution count')>0?num(v,'even distribution count'):actualCount;
      position=sourceParticleRingPosition(num(v,'initial radius'),num(v,'thickness'),jitter,id,total);velocity=[0,0,0];break;
     }
     case'Sequence Random':case'Sequence Two Random':{const value=Math.min(num(v,'sequence_max'),Math.floor(num(v,'sequence_min')+rnd()*(num(v,'sequence_max')-num(v,'sequence_min')+1)));if(row.name==='Sequence Random')particle.sequence=value;else particle.sequence2=value;break;}
     case'Rotation Random':particle.rotation=(num(v,'rotation_initial')+draw(v,'rotation_offset_min','rotation_offset_max',num(v,'rotation_random_exponent')))*Math.PI/180*(v.randomly_flip_direction&&rnd()<.5?-1:1);break;
     case'Lifetime Random':particle.life=draw(v,'lifetime_min','lifetime_max',num(v,'lifetime_random_exponent'));break;
     case'Radius Random':particle.radius=draw(v,'radius_min','radius_max',num(v,'radius_random_exponent'));break;
     case'Alpha Random':particle.alpha=draw(v,'alpha_min','alpha_max',num(v,'alpha_random_exponent'))/255;break;
     case'Trail Length Random':particle.trailLength=draw(v,'length_min','length_max',num(v,'length_random_exponent'));break;
     case'Rotation Yaw Flip Random':particle.yawFlipped=rnd()<num(v,'Flip Percentage');break;
     case'Color Random':particle.color=sourceParticleColorRandom(v,rnd(),context.lightingColor);break;
     case'Position Modify Warp Random':{const w=drawVec(v,'warp min','warp max');position=position.map((x,i)=>f(x*w[i]))as SourceParticleVec3;velocity=velocity.map((x,i)=>f(x*w[i]))as SourceParticleVec3;break;}
     case'Position Modify Offset Random':{const d=drawVec(v,'offset min','offset max');position=position.map((x,i)=>f(x+d[i]))as SourceParticleVec3;break;}
     case'Remap Noise to Scalar':{if(num(v,'output field')!==3)throw Error('Unsupported child noise output');const origin=context.noiseTransform?.(position)??position.map((x,i)=>f(x+(context.sourcePosition?.[i]??0)));const p=origin.map((x,i)=>f(x+vec(v,'spatial coordinate offset')[i]));const time=(context.born??0)*num(v,'time noise coordinate scale')+num(v,'time coordinate offset');const spatial=num(v,'spatial noise coordinate scale');let n=sourceParticleNoise(...p.map(x=>f(x*spatial+time))as SourceParticleVec3);if(v['absolute value'])n=Math.abs(n);if(v['invert absolute value'])n=1-n;particle.radius=mix(num(v,'output minimum'),num(v,'output maximum'),v['absolute value']?n:(n+1)*.5);break;}
     case'Velocity Noise':{const world=context.noiseTransform?.(position)??position.map((x,i)=>x+(context.sourcePosition?.[i]??0))as SourceParticleVec3;const n=sourceMuzzleVelocityNoise(world,context.born??0,v);velocity=velocity.map((x,i)=>f(x+n[i]))as SourceParticleVec3;break;}
    }
   }
   particle.position=position;particle.velocity=velocity;
   if(fadeIn)particle.fadeIn=draw(fadeIn,'fade in time min','fade in time max',num(fadeIn,'fade in time exponent'))*(fadeIn['proportional 0/1']?particle.life:1);
   if(fadeOut)particle.fadeOut=draw(fadeOut,'fade out time min','fade out time max',num(fadeOut,'fade out time exponent'))*(fadeOut['proportional 0/1']?particle.life:1);
   let previous=position.map((p,i)=>f(p-f(velocity[i]/30)))as SourceParticleVec3,current=position,interval=1/30;
   particle.trajectory.push(current);
   for(let t=0;t<(byPhase.operators.some(o=>o.name==='Movement Basic')?Math.ceil(particle.life*60):0);t++){let acceleration=[...(context.gravity??vec(movement,'gravity'))]as SourceParticleVec3;for(const force of byPhase.forces){const raw=force.name==='random force'?drawVec(force.values,'min force','max force'):vec(force.values,'starting force').map((a,i)=>mix(a,vec(force.values,'ending force')[i],clamp((t/60+particle.born-num(force.values,'time to start transition'))/(num(force.values,'time to end transition')-num(force.values,'time to start transition')))))as SourceParticleVec3,value=context.worldToLocal?.(raw)??raw;acceleration=acceleration.map((v,i)=>f(v+value[i]))as SourceParticleVec3;}const next=sourceParticleMovementBasic(current,previous,acceleration,num(movement,'drag'),1/60,interval);previous=current;current=next;interval=1/60;particle.trajectory.push(current);}
   return particle;
  });
 }
 function sample(particles:readonly SourceMuzzleChildParticle[],seconds:number){
  if(!Number.isFinite(seconds))throw Error('Invalid original child clock');
  return particles.flatMap(p=>{const age=seconds-p.born;if(age<0||age>=p.life)return[];const fraction=age/p.life;
   const index=Math.min(p.trajectory.length-1,Math.floor(age*60)),t=age*60-Math.floor(age*60),a=p.trajectory[index],b=p.trajectory[Math.min(index+1,p.trajectory.length-1)];
   const position=a.map((v,i)=>mix(v,b[i],t))as SourceParticleVec3,velocity=a.map((v,i)=>f((b[i]-v)*60))as SourceParticleVec3;
   let alpha=p.alpha;if(p.fadeOut>0){let x=clamp((age-(p.life-p.fadeOut))/p.fadeOut);x=fadeOut?.['ease in and out']?ease(x):bias(x,num(fadeOut!,'fade bias'));alpha*=1-x;}if(p.fadeIn>0)alpha*=ease(clamp(age/p.fadeIn));
   let radius=p.radius;if(radiusScale){let x=clamp((fraction-num(radiusScale,'start_time'))/(num(radiusScale,'end_time')-num(radiusScale,'start_time')));x=radiusScale.ease_in_and_out?ease(x):bias(x,num(radiusScale,'scale_bias'));radius*=mix(num(radiusScale,'radius_start_scale'),num(radiusScale,'radius_end_scale'),x);}
   let color=p.color;if(colorFade){let t=clamp((fraction-num(colorFade,'fade_start_time'))/(num(colorFade,'fade_end_time')-num(colorFade,'fade_start_time')));if(colorFade.ease_in_and_out)t=ease(t);color=color.map((c,i)=>mix(c,(colorFade.color_fade as number[])[i]/255,t))as SourceParticleVec3;}
   const spin=pick('operators','Rotation Spin Roll');const rotation=p.rotation+(spin?num(spin,'spin_rate_degrees')*Math.PI/180*age:0);
   return[{...p,rotation,age,currentAlpha:alpha,currentRadius:radius,currentColor:color,currentPosition:position,currentVelocity:velocity}];
  });
 }
 return{system,material:materialName,configuration,emit,sample};
}
/** Native Position Along Ring starts at one angular increment, and its thickness
 * is a 3D rejection-sphere offset (it is not just radial annulus thickness). */
export function sourceParticleRingPosition(radius:number,thickness:number,jitter:SourceParticleVec3,index:number,count:number):SourceParticleVec3{
 const angle=f(f(Math.PI*2/count)*f(index+1));return[f(f(Math.cos(angle)*radius)+f(jitter[0]*thickness)),f(f(Math.sin(angle)*radius)+f(jitter[1]*thickness)),f(jitter[2]*thickness)];
}
export type SourceMuzzleChildProgram=ReturnType<typeof createSourceMuzzleChildProgram>;
