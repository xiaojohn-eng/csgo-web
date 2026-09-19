import fs from 'node:fs';import {beforeAll,afterEach,describe,expect,it,vi} from 'vitest';
import {prepareSourceCharacterPose,sampleSourceCharacterPose,interpolateSourcePoseInput,type SourceCharacterPoseIndex,type SourceGrenadeThrowStyle,type SourcePoseParameters} from '../game/source-character-pose';
import {createSourcePoseDriver} from '../game/source-player-contract';
import {Simulation,initPhysics} from '../game/simulation';
import {EMPTY_INPUT,type Player} from '../game/types';
import type {SourceScenario} from '../game/source-scenario';
const folder='.reference-assets/source-exports/character-t/continuous',available=fs.existsSync(`${folder}/pose-data.json`);
const test=available?it:it.skip;let index:SourceCharacterPoseIndex;
const id='csgo-t-ak-12426148:b2106b26a407d0fa';
beforeAll(()=>{if(available){const data=JSON.parse(fs.readFileSync(`${folder}/pose-data.json`,'utf8'));
 const bytes=fs.readFileSync(`${folder}/frames.f64.bin`);index=prepareSourceCharacterPose(data,bytes);}});
const player=(patch:Partial<Player>={})=>({x:0,y:-3,z:0,yaw:0,pitch:0,grounded:true,crouch:false,shotIdle:10,sourcePoseVersion:id,...patch}) as Player;
const parameters:SourcePoseParameters={move_x:0,move_y:0,body_yaw:0,body_pitch:0};
// The original T release/preparation variant indices. Shoot_GREN1: 14 frames
// @30fps delta layers; Shoot_GREN2/3: 19 frames @30fps delta layers; the
// Upper_GREN pin-pull wrappers: 61/33/21/61/25 frames @30fps with the two
// original Aim_GREN + HandPos_GREN auto-layers. All float32 fade times are the
// original 0.20000000298023224s each way.
const VARIANTS={Run:829,Walk:830,Idle:831,Crouch_Idle:832,Crouch_Walk:833} as const;
const GREN2={Run:834,Walk:835,Idle:836,Crouch_Idle:837,Crouch_Walk:838} as const;
const GREN3={Run:931,Walk:932,Idle:933,Crouch_Idle:934,Crouch_Walk:935} as const;
const PREP={Run:824,Walk:825,Idle:826,Crouch_Idle:827,Crouch_Walk:828} as const;
const RATE=30/13,GREN23_RATE=30/18,DT=1/60,FADE=0.20000000298023224;
const PREP_RATE={Idle:30/60,Walk:30/32,Run:30/20,Crouch_Idle:30/60,Crouch_Walk:30/24} as const;
const quaternionDelta=(poseA:{quaternions:Float64Array},poseB:{quaternions:Float64Array},bone:number)=>
 Math.hypot(...[0,1,2,3].map(a=>poseA.quaternions[bone*4+a]-poseB.quaternions[bone*4+a]));

test('arms the original throw layer at the release instant and runs it at the sequence clock',()=>{
 const driver=createSourcePoseDriver(index,id),dt=DT;
 let previous=player({z:-.09}),pose=driver.advance(previous,player(),dt);
 expect(pose.state).toBe('Run');expect(pose.grenade).toBeUndefined();
 const thrower=player({z:-.09,sourcePose:pose,sourcePoseVersion:id});
 driver.beginGrenadeThrow!(thrower);
 expect(thrower.sourcePose!.grenade).toEqual({cycle:0,weight:0,variant:VARIANTS.Run,style:'overhand'});
 pose=driver.advance({...thrower,z:thrower.z-.09},thrower,dt);
 expect(pose.grenade).toBeDefined();
 expect(pose.grenade!.cycle).toBeCloseTo(dt*RATE,10);
 expect(pose.grenade!.weight).toBeCloseTo(dt/FADE,8);
 expect(pose.grenade!.variant).toBe(VARIANTS.Run);
 expect(pose.grenade!.style).toBe('overhand');
});

test('tracks the live locomotion state across the five original variants with one continuous clock',()=>{
 const driver=createSourcePoseDriver(index,id),dt=DT;
 let previous=player({z:-.09}),pose=driver.advance(previous,player(),dt);
 const thrower=player({z:-.09,sourcePose:pose,sourcePoseVersion:id});
 driver.beginGrenadeThrow!(thrower);previous=thrower;
 pose=driver.advance({...previous,z:previous.z-.09},previous,dt);
 expect(pose.grenade!.variant).toBe(VARIANTS.Run);
 // Stop moving mid-throw: the variant re-selects Idle while the cycle keeps running.
 previous={...previous,z:previous.z,sourcePose:pose};
 pose=driver.advance({...previous,z:previous.z},previous,dt);
 expect(pose.state).toBe('Idle');expect(pose.grenade!.variant).toBe(VARIANTS.Idle);
 expect(pose.grenade!.cycle).toBeCloseTo(2*dt*RATE,10);
 // Crouch-walking continues the same clock on the crouch variant.
 previous={...previous,crouch:true,z:previous.z-.005,sourcePose:pose};
 pose=driver.advance({...previous,crouch:true,z:previous.z-.005},previous,dt);
 expect(pose.state).toBe('Crouch_Walk');expect(pose.grenade!.variant).toBe(VARIANTS.Crouch_Walk);
 expect(pose.grenade!.cycle).toBeCloseTo(3*dt*RATE,10);
});

test('locks the final frame and fades the layer out at the original fade times',()=>{
 const driver=createSourcePoseDriver(index,id),dt=DT;
 let previous=player({z:-.09}),pose=driver.advance(previous,player(),dt);
 const thrower=player({z:-.09,sourcePose:pose,sourcePoseVersion:id});
 driver.beginGrenadeThrow!(thrower);
 // Fade-in saturates after 12 ticks (dt/0.2 each); the 14-frame @30fps run
 // reaches the non-looping clamp after 26 ticks, then the 0.2s fade-out runs
 // from the frozen final frame — 38 ticks total, checked well past the end.
 previous=thrower;pose=driver.advance({...previous,z:previous.z-.09},previous,dt);
 let sawFinalFrame=false,sawFullWeight=false;
 for(let ticks=1;ticks<60;ticks++){
  previous={...previous,z:previous.z-.09,sourcePose:pose};
  pose=driver.advance({...previous,z:previous.z-.09},previous,dt);
  if(pose.grenade){if(pose.grenade.cycle>=1)sawFinalFrame=true;if(pose.grenade.weight>=1)sawFullWeight=true;}
 }
 expect(sawFinalFrame).toBe(true);expect(sawFullWeight).toBe(true);
 expect(pose.grenade).toBeUndefined();
 expect(pose.state).toBe('Run');
});

test('drops the throw layer when the actor dies mid-throw',()=>{
 const driver=createSourcePoseDriver(index,id),dt=DT;
 let previous=player({z:-.09}),pose=driver.advance(previous,player(),dt);
 const thrower=player({z:-.09,sourcePose:pose,sourcePoseVersion:id});
 driver.beginGrenadeThrow!(thrower);
 previous={...thrower,z:thrower.z-.09};
 pose=driver.advance(previous,previous,dt);
 expect(pose.grenade).toBeDefined();
 previous={...previous,alive:false,sourcePose:pose};
 pose=driver.advance(previous,previous,dt);
 expect(pose.state).toBe('Death');expect(pose.grenade).toBeUndefined();
});

test('selects the original medium and underhand release sets from the held strength and never re-rates mid-throw',()=>{
 const driver=createSourcePoseDriver(index,id),dt=DT;
 let previous=player({z:-.09}),runPose=driver.advance(previous,player(),dt);
 // The medium release (primary+secondary) arms the 19-frame Shoot_GREN2 set
 // and runs it at its own 30/18 clock.
 const medium=player({z:-.09,sourcePose:runPose,sourcePoseVersion:id});
 driver.beginGrenadeThrow!(medium,'medium');
 expect(medium.sourcePose!.grenade).toEqual({cycle:0,weight:0,variant:GREN2.Run,style:'medium'});
 let pose=driver.advance({...medium,z:medium.z-.09},medium,dt);
 expect(pose.grenade!.variant).toBe(GREN2.Run);expect(pose.grenade!.style).toBe('medium');
 expect(pose.grenade!.cycle).toBeCloseTo(dt*GREN23_RATE,10);
 expect(pose.grenade!.weight).toBeCloseTo(dt/FADE,8);
 // Stopping mid-throw re-selects the Idle variant while the medium clock and
 // strength stay continuous.
 previous={...medium,z:medium.z-.09,sourcePose:pose};
 pose=driver.advance({...previous,z:previous.z},previous,dt);
 expect(pose.grenade!.variant).toBe(GREN2.Idle);expect(pose.grenade!.style).toBe('medium');
 expect(pose.grenade!.cycle).toBeCloseTo(2*dt*GREN23_RATE,10);
 // The underhand release (secondary alone) arms the Shoot_GREN3 set.
 const idlePose=driver.advance(player(),player(),dt);
 const underhand=player({sourcePose:idlePose,sourcePoseVersion:id});
 driver.beginGrenadeThrow!(underhand,'underhand');
 expect(underhand.sourcePose!.grenade).toEqual({cycle:0,weight:0,variant:GREN3.Idle,style:'underhand'});
 pose=driver.advance(underhand,underhand,dt);
 expect(pose.grenade!.cycle).toBeCloseTo(dt*GREN23_RATE,10);
 expect(pose.grenade!.style).toBe('underhand');
});

test('arms the pin-pull preparation at the throw-key press and runs it at the live variant rate',()=>{
 const driver=createSourcePoseDriver(index,id),dt=DT;
 let pose=driver.advance(player(),player(),dt);
 expect(pose.state).toBe('Idle');expect(pose.prep).toBeUndefined();
 const holder=player({sourcePose:pose,sourcePoseVersion:id,sourceGrenadeHold:true});
 driver.beginGrenadePrep!(holder);
 expect(holder.sourcePose!.prep).toEqual({cycle:0,weight:0,variant:PREP.Idle});
 // While the throw key stays held the pin pull runs at the 61-frame idle
 // rate (30/60 cycles/s) and fades in at the original fade time.
 pose=driver.advance({...holder,sourceGrenadeHold:true},holder,dt);
 expect(pose.prep!.variant).toBe(PREP.Idle);
 expect(pose.prep!.cycle).toBeCloseTo(dt*PREP_RATE.Idle,10);
 expect(pose.prep!.weight).toBeCloseTo(dt/FADE,8);
 // Re-arming mid-pull restarts the pin-pull clock.
 const rearm=player({sourcePose:pose,sourcePoseVersion:id,sourceGrenadeHold:true});
 driver.beginGrenadePrep!(rearm);
 expect(rearm.sourcePose!.prep).toEqual({cycle:0,weight:0,variant:PREP.Idle});
});

test('locks the pulled-pin final frame while the key stays held and re-rates across state changes',()=>{
 const driver=createSourcePoseDriver(index,id),dt=DT;
 let pose=driver.advance(player(),player(),dt);
 let held=player({sourcePose:pose,sourcePoseVersion:id,sourceGrenadeHold:true});
 driver.beginGrenadePrep!(held);
 // The 61-frame @30fps idle pull completes after 120 ticks and the
 // non-looping clamp locks the pulled-pin final frame while the key stays down.
 for(let ticks=0;ticks<130;ticks++){
  pose=driver.advance({...held,sourceGrenadeHold:true},held,dt);
  held={...held,sourcePose:pose};
 }
 expect(pose.prep!.cycle).toBe(1);expect(pose.prep!.weight).toBe(1);
 for(let ticks=0;ticks<10;ticks++){
  pose=driver.advance({...held,sourceGrenadeHold:true},held,dt);
  held={...held,sourcePose:pose};
 }
 expect(pose.prep).toEqual({cycle:1,weight:1,variant:PREP.Idle});
 // Before the clamp, a state change re-selects the variant and re-rates the
 // shared clock at the live variant's own pace: 20 idle ticks then one run
 // tick advance 20*dt*(30/60) + dt*(30/20).
 held=player({sourcePose:driver.advance(player(),player(),dt),sourcePoseVersion:id,sourceGrenadeHold:true});
 driver.beginGrenadePrep!(held);
 for(let ticks=0;ticks<20;ticks++){
  pose=driver.advance({...held,sourceGrenadeHold:true},held,dt);
  held={...held,sourcePose:pose};
 }
 expect(pose.prep!.cycle).toBeCloseTo(20*dt*PREP_RATE.Idle,10);
 pose=driver.advance({...held,z:held.z-.09,sourceGrenadeHold:true},held,dt);
 expect(pose.state).toBe('Run');expect(pose.prep!.variant).toBe(PREP.Run);
 expect(pose.prep!.cycle).toBeCloseTo(20*dt*PREP_RATE.Idle+dt*PREP_RATE.Run,10);
 // Airborne ticks keep the pin pull running at the remembered ground variant,
 // exactly what the original jumpthrow relies on.
 held={...held,z:held.z-.09,sourcePose:pose};
 pose=driver.advance({...held,grounded:false,sourceGrenadeHold:true},held,dt);
 expect(pose.prep!.variant).toBe(PREP.Run);
 expect(pose.prep!.cycle).toBeCloseTo(20*dt*PREP_RATE.Idle+2*dt*PREP_RATE.Run,10);
});

test('fades the armed preparation out after the release while the release layer takes over',()=>{
 const driver=createSourcePoseDriver(index,id),dt=DT;
 let pose=driver.advance(player(),player(),dt);
 let held=player({sourcePose:pose,sourcePoseVersion:id,sourceGrenadeHold:true});
 driver.beginGrenadePrep!(held);
 for(let ticks=0;ticks<20;ticks++){
  pose=driver.advance({...held,sourceGrenadeHold:true},held,dt);
  held={...held,sourcePose:pose};
 }
 expect(pose.prep!.weight).toBe(1);
 // The server-confirmed release: the throw layer starts from zero while the
 // armed pose keeps its frozen clock and fades out at the original fade time.
 driver.beginGrenadeThrow!(held,'underhand');
 const released=player({...held,sourceGrenadeHold:false});
 pose=driver.advance(released,released,dt);
 expect(pose.prep!.cycle).toBeCloseTo(20*dt*PREP_RATE.Idle,10);
 expect(pose.prep!.weight).toBeCloseTo(1-dt/FADE,8);
 expect(pose.grenade).toEqual({cycle:dt*GREN23_RATE,weight:dt/FADE,variant:GREN3.Idle,style:'underhand'});
 let fading=released;
 for(let ticks=0;ticks<13;ticks++){
  pose=driver.advance(fading,fading,dt);
  fading={...fading,sourcePose:pose};
 }
 expect(pose.prep).toBeUndefined();expect(pose.grenade).toBeDefined();
});

test('drops the pin-pull preparation when the actor dies mid-hold',()=>{
 const driver=createSourcePoseDriver(index,id),dt=DT;
 let pose=driver.advance(player(),player(),dt);
 let held=player({sourcePose:pose,sourcePoseVersion:id,sourceGrenadeHold:true});
 driver.beginGrenadePrep!(held);
 pose=driver.advance({...held,sourceGrenadeHold:true},held,dt);
 expect(pose.prep).toBeDefined();
 held={...held,alive:false,sourcePose:pose};
 pose=driver.advance(held,held,dt);
 expect(pose.state).toBe('Death');expect(pose.prep).toBeUndefined();
});

test('overlays the original Idle throw over the full body while zero-masked bones stay untouched',()=>{
 const at=(grenade?:{cycle:number;weight:number;variant:number;style:'overhand'})=>sampleSourceCharacterPose(index,
  {state:'Idle',cycle:0,parameters,upperCycle:0,fireCycle:0,fireWeight:0,blendMode:'sdk-3way',...(grenade?{grenade}:{})});
 const base=at(),thrown=at({cycle:.5,weight:1,variant:VARIANTS.Idle,style:'overhand'});
 const animationBone=(name:string)=>index.data.animationBones.findIndex(b=>b.name===name);
 const proxy=animationBone('Proxy_clip'),root=animationBone('ValveBiped.ValveBiped');
 for(const bone of [proxy,root]){
  expect(quaternionDelta(thrown.animationPose,base.animationPose,bone)).toBe(0);
  for(let a=0;a<3;a++)expect(thrown.animationPose.positions[bone*3+a]).toBe(base.animationPose.positions[bone*3+a]);
 }
 // The Idle variant drives nearly the whole body: the arm swing and torso
 // rotate on top of the armed aim pose (delta quaternions, not norms).
 const upperArm=animationBone('ValveBiped.Bip01_R_UpperArm'),spine=animationBone('ValveBiped.Bip01_Spine');
 expect(quaternionDelta(thrown.animationPose,base.animationPose,upperArm)).toBeGreaterThan(1e-3);
 expect(quaternionDelta(thrown.animationPose,base.animationPose,spine)).toBeGreaterThan(1e-3);
});

test('keeps locomotion driving the legs under the moving throw variants',()=>{
 const at=(grenade?:{cycle:number;weight:number;variant:number;style:'overhand'})=>sampleSourceCharacterPose(index,
  {state:'Run',cycle:.5,parameters:{...parameters,move_x:1,move_y:0},upperCycle:.5,fireCycle:0,fireWeight:0,blendMode:'sdk-3way',...(grenade?{grenade}:{})});
 const base=at(),thrown=at({cycle:.5,weight:1,variant:VARIANTS.Run,style:'overhand'});
 const animationBone=(name:string)=>index.data.animationBones.findIndex(b=>b.name===name);
 for(const name of ['ValveBiped.Bip01_R_Thigh','ValveBiped.Bip01_L_Calf','ValveBiped.Bip01_R_Foot']){
  const bone=animationBone(name);
  for(let a=0;a<4;a++)expect(thrown.animationPose.quaternions[bone*4+a]).toBeCloseTo(base.animationPose.quaternions[bone*4+a],12);
 }
 const upperArm=animationBone('ValveBiped.Bip01_R_UpperArm');
 const delta=Math.hypot(thrown.animationPose.quaternions[upperArm*4]-base.animationPose.quaternions[upperArm*4],
  thrown.animationPose.quaternions[upperArm*4+1]-base.animationPose.quaternions[upperArm*4+1],
  thrown.animationPose.quaternions[upperArm*4+2]-base.animationPose.quaternions[upperArm*4+2],
  thrown.animationPose.quaternions[upperArm*4+3]-base.animationPose.quaternions[upperArm*4+3]);
 expect(delta).toBeGreaterThan(1e-6);
});

test('overlays the pin-pull preparation through its original auto-layered aim and hold graph',()=>{
 const at=(prep?:{cycle:number;weight:number;variant:number})=>sampleSourceCharacterPose(index,
  {state:'Idle',cycle:0,parameters,upperCycle:0,fireCycle:0,fireWeight:0,blendMode:'sdk-3way',...(prep?{prep}:{})});
 const base=at(),armed=at({cycle:.5,weight:1,variant:PREP.Idle});
 const animationBone=(name:string)=>index.data.animationBones.findIndex(b=>b.name===name);
 // The Upper_GREN wrapper's 0/1 bone mask animates only the two weapon hand
 // bones; its two original auto-layers blend the 9-way Aim_GREN aim pose and
 // the HandPos_GREN hold over the rest of the armed body.
 for(const name of ['ValveBiped.weapon_bone_RHand','ValveBiped.weapon_bone_LHand'])
  expect(quaternionDelta(armed.animationPose,base.animationPose,animationBone(name))).toBeGreaterThan(1e-3);
 const spine=animationBone('ValveBiped.Bip01_Spine');
 expect(quaternionDelta(armed.animationPose,base.animationPose,spine)).toBeGreaterThan(1e-6);
 // Only the original Upper_GREN wrappers are valid preparation variants: the
 // looping bit or a missing auto-layer pair rejects a release layer.
 expect(()=>at({cycle:.5,weight:1,variant:VARIANTS.Idle})).toThrow('Prep layer must reference an original Upper_GREN preparation variant');
 expect(()=>sampleSourceCharacterPose(index,{state:'Death',cycle:0,parameters,upperCycle:0,fireCycle:0,fireWeight:0,
  blendMode:'sdk-3way',prep:{cycle:0,weight:1,variant:PREP.Idle}})).toThrow('The corpse cannot keep a grenade prep layer');
});

test('interpolates one throw clock and cross-fades across a variant change',()=>{
 const span=1/30;
 const expectGrenade=(pose:{grenade?:{cycle:number;weight:number;variant:number}},cycle:number,weight:number,variant:number)=>{
  expect(pose.grenade!.cycle).toBeCloseTo(cycle,10);
  expect(pose.grenade!.weight).toBeCloseTo(weight,10);
  expect(pose.grenade!.variant).toBe(variant);
 };
 const run=interpolateSourcePoseInput(
  {state:'Run',cycle:1,parameters,upperCycle:1,fireCycle:0,fireWeight:0,blendMode:'sdk-3way',grenade:{cycle:.2,weight:.5,variant:VARIANTS.Run,style:'overhand'}},
  {state:'Run',cycle:1,parameters,upperCycle:1,fireCycle:0,fireWeight:0,blendMode:'sdk-3way',grenade:{cycle:.4,weight:.8,variant:VARIANTS.Run,style:'overhand'}},.5,{spanSeconds:span});
 expectGrenade(run,.3,.65,VARIANTS.Run);
 const cross=interpolateSourcePoseInput(
  {state:'Run',cycle:1,parameters,upperCycle:1,fireCycle:0,fireWeight:0,blendMode:'sdk-3way',grenade:{cycle:.2,weight:.5,variant:VARIANTS.Run,style:'overhand'}},
  {state:'Run',cycle:1,parameters,upperCycle:1,fireCycle:0,fireWeight:0,blendMode:'sdk-3way',grenade:{cycle:.4,weight:.8,variant:VARIANTS.Idle,style:'overhand'}},.5,{spanSeconds:span});
 expectGrenade(cross,.2,.25,VARIANTS.Run);
 const entering=interpolateSourcePoseInput(
  {state:'Idle',cycle:0,parameters,upperCycle:0,fireCycle:0,fireWeight:0,blendMode:'sdk-3way'},
  {state:'Idle',cycle:0,parameters,upperCycle:0,fireCycle:0,fireWeight:0,blendMode:'sdk-3way',grenade:{cycle:.1,weight:.4,variant:VARIANTS.Idle,style:'overhand'}},.5,{spanSeconds:span});
 expectGrenade(entering,.1,.2,VARIANTS.Idle);
});

test('interpolates the preparation clock and cross-fades across a variant change',()=>{
 const span=1/30;
 const expectPrep=(pose:{prep?:{cycle:number;weight:number;variant:number}},cycle:number,weight:number,variant:number)=>{
  expect(pose.prep!.cycle).toBeCloseTo(cycle,10);
  expect(pose.prep!.weight).toBeCloseTo(weight,10);
  expect(pose.prep!.variant).toBe(variant);
 };
 const idle={state:'Idle',cycle:0,parameters,upperCycle:0,fireCycle:0,fireWeight:0,blendMode:'sdk-3way'} as const;
 const run=interpolateSourcePoseInput(
  {...idle,prep:{cycle:.2,weight:.5,variant:PREP.Idle}},
  {...idle,prep:{cycle:.4,weight:.8,variant:PREP.Idle}},.5,{spanSeconds:span});
 expectPrep(run,.3,.65,PREP.Idle);
 const cross=interpolateSourcePoseInput(
  {...idle,prep:{cycle:.2,weight:.5,variant:PREP.Idle}},
  {...idle,prep:{cycle:.4,weight:.8,variant:PREP.Run}},.5,{spanSeconds:span});
 expectPrep(cross,.2,.25,PREP.Idle);
 const entering=interpolateSourcePoseInput(idle,{...idle,prep:{cycle:.1,weight:.4,variant:PREP.Idle}},.5,{spanSeconds:span});
 expectPrep(entering,.1,.2,PREP.Idle);
 const leaving=interpolateSourcePoseInput({...idle,prep:{cycle:.1,weight:.4,variant:PREP.Idle}},idle,.5,{spanSeconds:span});
 expectPrep(leaving,.1,.2,PREP.Idle);
});

/** Minimal Source scenario with a spy pose driver, modelled on the
 * source-simulation fixture: one ground box and the two spawn sites. */
function holdScenario(prep:ReturnType<typeof createPrepSpy>,release:ReturnType<typeof createReleaseSpy>):SourceScenario{
 const bounds={min:[-20,-8,-20] as [number,number,number],max:[20,10,20] as [number,number,number]};
 const box=(x:number,y:number,z:number)=>[-x,-y,-z,-x,-y,z,-x,y,-z,-x,y,z,x,-y,-z,x,-y,z,x,y,-z,x,y,z];
 const level:SourceScenario['level']={format:'source-level-v1',id:'source-gren-fixture',name:'Grenade hold fixture',sourceBspSha256:'fixture',metersPerSourceUnit:.0254,
  worldBounds:bounds,boundsMeaning:'fixture',spawns:(['blue','amber']as const).map((team,i)=>({id:team,team,x:i?4:-4,y:-3.75,z:0,yaw:0,pitch:0,
   sourceClassname:'fixture',sourceOrigin:[0,0,0],sourceAngles:[0,0,0]})),sites:[{name:'A',sourceModel:1,hammerid:'A',bounds},{name:'B',sourceModel:2,hammerid:'B',bounds}],
  siteBinding:'fixture',navigation:null,navigationStatus:'none',sourceNavSha256:'nav-fixture',player:{standing:{halfExtents:[.4064,.9144,.4064],eyeHeight:1.6256},
   crouching:{halfExtents:[.4064,.6858,.4064],eyeHeight:1.1684},gravity:20.32,stepHeight:.4572,standableNormal:.7,sourceServerSha256:'fixture',hullMeaning:'Source AABB'}};
 const instance=(geometry:number,translation:[number,number,number],roles:('player'|'bullet'|'projectile')[],source={})=>({geometry,translation,roles,source,rotation:[0,0,0,1]as[number,number,number,number],scale:1});
 return {level,collision:{format:'source-map-collision-v1',sourceMap:level.id,sourceBspSha256:'fixture',metersPerSourceUnit:.0254,missingPHY:[],limits:[],
  geometries:[{id:0,kind:'convex',vertices:box(20,.5,20),source:{}},{id:1,kind:'convex',vertices:box(1,2,1),source:{}}],
  colliders:[instance(0,[0,-4.5,0],['player','bullet','projectile'])],
  sensors:[instance(1,[-4,-3,0],[],{classname:'func_bomb_target',model:1,hammerid:'A'}),instance(1,[4,-3,0],[],{classname:'func_bomb_target',model:2,hammerid:'B'})]},
  poseDriver:{id:'grenade-hold-fixture',advance:()=>({state:'Idle' as const,cycle:0,parameters:{}}),beginGrenadePrep:prep,beginGrenadeThrow:release}};
}
const createPrepSpy=()=>vi.fn((_player:Player)=>{});
const createReleaseSpy=()=>vi.fn((_player:Player,_style?:SourceGrenadeThrowStyle)=>{});
describe('authoritative grenade hold',()=>{
 beforeAll(initPhysics);
 let games:Simulation[]=[];
 afterEach(()=>{games.forEach(s=>s.dispose());games=[];});
 it('serializes independently owned unit quaternions that change during flight for all three original bodies',()=>{
  for(const utility of ['he','smoke','flash']as const){
   const s=new Simulation('training',false,holdScenario(createPrepSpy(),createReleaseSpy()));games.push(s);
   const p=s.addPlayer('p','P','amber');
   for(let i=0;i<20;i++)s.step();
   s.setInput(p.id,{...EMPTY_INPUT,seq:1,grenade:true,utility});s.step();
   const first=s.snapshot().grenades[0];
   expect(first.rotation).toBeDefined();
   expect(Math.hypot(...Object.values(first.rotation!))).toBeCloseTo(1,5);
   for(let i=0;i<6;i++)s.step();
   const next=s.snapshot().grenades[0];
   expect(next.rotation).not.toEqual(first.rotation);
   expect(Math.hypot(...Object.values(next.rotation!))).toBeCloseTo(1,5);
   next.rotation!.x=123;
   expect(s.snapshot().grenades[0].rotation!.x).not.toBe(123);
  }
 });
 it('keeps smoke at the below-zero detonation instead of clamping it above the map',()=>{
  const s=new Simulation('training',false,holdScenario(createPrepSpy(),createReleaseSpy()));games.push(s);
  const p=s.addPlayer('p','P','amber');
  for(let i=0;i<20;i++)s.step();
  s.setInput(p.id,{...EMPTY_INPUT,seq:1,grenade:true,utility:'smoke'});s.step();
  for(let i=0;i<115;i++)s.step();
  const smoke=s.snapshot().smokes[0];
  const event=s.events.find(e=>e.type==='smoke');
  expect(smoke).toBeDefined();expect(event).toBeDefined();
  expect(smoke.y).toBeLessThan(0);
  expect(smoke.y).toBe(event!.y);
 });
 it('arms the pin-pull preparation once per press edge and performs the styled release at the release edge',()=>{
  const prep=createPrepSpy(),release=createReleaseSpy();
  const s=new Simulation('training',false,holdScenario(prep,release));games.push(s);
  const p=s.addPlayer('p','P','amber');expect(p.grenades).toBe(1);
  // Clear the 0.3s spawn cooldown before arming any hold.
  for(let ticks=0;ticks<20;ticks++)s.step();
  expect(p.cooldown).toBe(0);
  // Press edge: arm the pin-pull preparation, consume nothing yet.
  s.setInput(p.id,{...EMPTY_INPUT,seq:1,grenadeHold:true});
  s.step();
  expect(p.sourceGrenadeHold).toBe(true);expect(prep).toHaveBeenCalledOnce();expect(p.grenades).toBe(1);
  // Still held: never re-arm and never throw.
  s.setInput(p.id,{...EMPTY_INPUT,seq:2,grenadeHold:true});
  s.step();
  expect(prep).toHaveBeenCalledOnce();expect(release).not.toHaveBeenCalled();expect(p.grenades).toBe(1);
  // Release edge with secondary fire held: the underhand release consumes one
  // charge, arms the matching overlay and ends the hold.
  s.setInput(p.id,{...EMPTY_INPUT,seq:3,grenadeHold:false,aim:true});
  s.step();
  expect(p.sourceGrenadeHold).toBe(false);expect(p.grenades).toBe(0);
  expect(release).toHaveBeenCalledOnce();expect(release.mock.calls[0][1]).toBe('underhand');
  expect(s.snapshot().grenades).toHaveLength(1);
  // The post-throw cooldown blocks an immediate second hold.
  s.setInput(p.id,{...EMPTY_INPUT,seq:4,grenadeHold:true});
  s.step();
  expect(prep).toHaveBeenCalledOnce();expect(p.sourceGrenadeHold).toBe(false);
 });
 it('maps the held mouse buttons to the original three release strengths and scales the throw velocity',()=>{
  const styles=[['overhand',0,0],['medium',1,1],['underhand',1,0]] as const;
  const distances:number[]=[];
  for(const [style,aim,fire] of styles){
   const prep=createPrepSpy(),release=createReleaseSpy();
   const s=new Simulation('training',false,holdScenario(prep,release));games.push(s);
   const p=s.addPlayer('p','P','amber');
   for(let ticks=0;ticks<20;ticks++)s.step();
   s.setInput(p.id,{...EMPTY_INPUT,seq:1,grenadeHold:true});s.step();
   s.setInput(p.id,{...EMPTY_INPUT,seq:2,grenadeHold:false,aim:aim===1,fire:fire===1});s.step();
   expect(release).toHaveBeenCalledOnce();expect(release.mock.calls[0][1]).toBe(style);
   expect(s.snapshot().grenades).toHaveLength(1);
   const thrown=s.snapshot().grenades[0];
   for(let ticks=0;ticks<3;ticks++)s.step();
   const moved=s.snapshot().grenades[0];
   // The original strength formula (strength*0.7+0.3) keeps 100/65/30% of the
   // launch speed: the overhand lob flies visibly further than the underhand.
   distances.push(Math.hypot(moved.x-thrown.x,moved.y-thrown.y,moved.z-thrown.z));
  }
  expect(distances[0]).toBeGreaterThan(distances[1]);
  expect(distances[1]).toBeGreaterThan(distances[2]);
  expect(distances[2]).toBeLessThan(distances[0]*.45);
 });
 it('keeps the legacy press-edge input as the instant overhand release for older clients',()=>{
  const prep=createPrepSpy(),release=createReleaseSpy();
  const s=new Simulation('training',false,holdScenario(prep,release));games.push(s);
  const p=s.addPlayer('p','P','amber');
  for(let ticks=0;ticks<20;ticks++)s.step();
  s.setInput(p.id,{...EMPTY_INPUT,seq:1,grenade:true,utility:'smoke'});
  s.step();
  expect(prep).not.toHaveBeenCalled();expect(p.sourceGrenadeHold).toBe(false);
  expect(release).toHaveBeenCalledOnce();expect(release.mock.calls[0][1]).toBe('overhand');
  expect(p.smokes).toBe(0);
  expect(s.snapshot().grenades[0].kind).toBe('smoke');
 });
});
