import {expect,it} from 'vitest';
import {createSourceDeaglePoseDriver,interpolateSourceDeaglePose} from '../game/source-deagle-runtime-pose';
import {sampleSourceDeagleCharacterPose,sourceDeagleAutoLayerRequests} from '../game/source-deagle-character-pose';
import {sampleSourceSequence} from '../game/source-character-pose';
import {deagleRuntimeFixture} from './source-deagle-runtime-fixture';
const states=['Idle','Walk','Run','Crouch_Idle','Crouch_Walk']as const;

it.each(['t','ct']as const)('%s authority uses original body/world durations for all ground states and final-shot activity',team=>{
 const {index,at}=deagleRuntimeFixture(team);
 for(const state of states)for(const activity of [183,192,195,194]){
  const p=at(10.1,activity,state),pose=p.sourcePistolPose!,sample=sampleSourceDeagleCharacterPose(index,pose);
  const crouch=state.startsWith('Crouch'),moving=['Walk','Run','Crouch_Walk'].includes(state);
  const name=activity===194?'pistol_reload'+(crouch?'_crouch':'')+(moving?'_moving':''):'pistol_fire'+(crouch?'_crouch':'');
  if(activity===183){expect(pose.bodyLayers).toEqual([]);expect(pose.world.layers).toEqual([]);}
  else{
   expect(pose.world.layers?.[0].sequence).toBe(name);
   expect(pose.clock!.worldRate).toBeCloseTo(activity===194?30/77:30/12,12);
   expect(pose.world.layers?.[0].cycle).toBeCloseTo(.1*(activity===194?30/77:30/12),12);
   if(activity===194){expect(pose.bodyLayers?.[0].sequence).toBe('Reload_PISTOL');expect(pose.clock!.bodyRate).toBeCloseTo(30/77,12);
    // The 2.2 second FP reload has completed, but this original world/body clip has not.
    expect(at(12.21,activity,state).sourcePistolPose!.world.layers?.[0].weight).toBe(1);
   }else{expect(pose.bodyLayers).toEqual([]);expect(pose.body.fireWeight).toBe(1);}
   expect(at(14,activity,state).sourcePistolPose!.world.layers?.[0].weight).toBe(0);
  }
  expect(pose.silencerVisible).toBe(false);
  expect(sample.body.sourceWorldMatrices).toHaveLength((team==='t'?71:74)*16);expect(sample.sourceWeaponWorldMatrices).toHaveLength(93*16);
  expect([...sample.body.sourceWorldMatrices,...sample.sourceWeaponWorldMatrices].every(Number.isFinite)).toBe(true);
 }
});
it.each(['t','ct']as const)('%s uses the 230 unit speed threshold without mutating authority or losing airborne/crouch states',team=>{
 const {driver,player}=deagleRuntimeFixture(team),dt=1/60;
 for(const [speed,walking,state]of [[119.599,false,'Walk'],[119.601,false,'Run'],[119.6,true,'Walk'],[230,false,'Run']]as const){
  const p={...player,z:-speed*.0254*dt,sourceWalking:walking},saved=structuredClone(p);
  expect(driver.advance(p,player,dt).state).toBe(state);expect(p).toEqual(saved);
 }
 expect(driver.advance({...player,z:-230*.0254*.52},player,1).state).toBe('Run');
 expect(driver.advance({...player,crouch:true},player,dt).state).toBe('Crouch_Idle');
 expect(driver.advance({...player,crouch:true,z:-.01},player,dt).state).toBe('Crouch_Walk');
 const old={...player,sourcePose:driver.advance({...player,z:-.1},player,dt)};
 expect(driver.advance({...old,grounded:false,z:-1},old,dt).state).toBe('Run');
 expect(()=>driver.advance(player,player,-1)).toThrow(/dt/);
});
it.each(['t','ct']as const)('%s forwards every original nine-way aim corner and selects each matching ground auto-layer',team=>{
 const {driver,index,at}=deagleRuntimeFixture(team);let corners=0;
 for(const [slot,state]of states.entries())for(const yaw of [-60,0,60])for(const pitch of [-90,0,90]){
  const p=at(10,183,state);p.sourcePose!.parameters={...p.sourcePose!.parameters,body_yaw:yaw,body_pitch:pitch};
  const pose=driver.pistolPose(p,10),requests=sourceDeagleAutoLayerRequests(index.world,0,1,pose.world.parameters);
  expect(pose.world.parameters.body_yaw).toBe(yaw);expect(pose.world.parameters.body_pitch).toBe(pitch);
  expect(requests.map(r=>r.weight)).toEqual(states.map((_,i)=>i===slot?1:0));
  const sequence=index.world.sequences.get(requests[slot].sequence)!,x=[-60,0,60].indexOf(yaw),y=[-90,0,90].indexOf(pitch);
  expect(sequence.poseKeys).toEqual([-60,0,60,-90,0,90]);
  const sampled=sampleSourceSequence(index.world.core,sequence.index,0,pose.world.parameters),frame=index.world.core.frames.get(sequence.animationIndices[x+y*3])!;
  expect(sampled.positions).toEqual(frame.positions.slice(0,93*3));corners++;
 }
 expect(corners).toBe(45);
});
it('preserves original magazine boundaries after JSON snapshot and action-clock interpolation',()=>{
 const {at}=deagleRuntimeFixture('ct');
 for(const edge of [.07792207598686218,.19480518996715546]){
  const time=10+edge*77/30,a=JSON.parse(JSON.stringify(at(time-.05).sourcePistolPose)),b=JSON.parse(JSON.stringify(at(time+.05).sourcePistolPose));
  for(const t of [.1,.9]){
   const pose=interpolateSourceDeaglePose(a,b,t,.1),expected=at(pose.clock!.time).sourcePistolPose!;
   expect(pose.magazineVisible).toBe(expected.magazineVisible);expect(pose.world).toEqual(JSON.parse(JSON.stringify(expected.world)));
  }
 }
 expect(at(10.21).sourcePistolPose!.magazineVisible).toBe(false);expect(at(10.51).sourcePistolPose!.magazineVisible).toBe(true);
 const a=at(10.3).sourcePistolPose!,b=at(10.5,183,'Idle',2,10.45).sourcePistolPose!;
 expect(interpolateSourceDeaglePose(a,b,.5,.2).magazineVisible).toBe(false);
 const drawn=interpolateSourceDeaglePose(a,b,.9,.2);expect(drawn.magazineVisible).toBe(true);expect(drawn.world.layers).toEqual([]);expect(drawn.clock?.generation).toBe(2);
 const shot=at(10.7,195,'Idle',3,10.6).sourcePistolPose!,old=at(10.5,192,'Idle',2,10.4).sourcePistolPose!;
 expect(interpolateSourceDeaglePose(old,shot,.75,.2).world.layers![0].cycle).toBeCloseTo(.05*30/12,12);
 drawn.world.parameters.body_yaw=22;expect(b.world.parameters.body_yaw).toBe(0);
});
it('rejects wrong weapon/team/version and absent or invalid authoritative action state',()=>{
 const {driver,index,version,at}=deagleRuntimeFixture('t'),p=at(10);
 expect(()=>createSourceDeaglePoseDriver({...index,weapon:'usp'}as never,version)).toThrow(/original body\/world/);
 expect(()=>driver.pistolPose({...p,weapon:'glock'},10)).toThrow(/weapon and team/);
 expect(()=>driver.pistolPose({...p,team:'blue'},10)).toThrow(/weapon and team/);
 expect(()=>driver.pistolPose({...p,sourcePoseVersion:'old'},10)).toThrow(/shared body/);
 expect(()=>driver.pistolPose({...p,sourceDeagle:undefined},10)).toThrow(/authoritative Deagle/);
 expect(()=>driver.pistolPose({...p,sourceDeagle:{command:{},action:{activity:194,time:NaN,generation:1}}},10)).toThrow(/clock/);
 expect(()=>driver.pistolPose(p,NaN)).toThrow(/shared body/);
});
