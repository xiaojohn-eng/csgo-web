import fs from 'node:fs';import {beforeAll,expect,it} from 'vitest';
import {prepareSourceCharacterPose,sampleSourceCharacterPose,type SourceCharacterPoseIndex} from '../game/source-character-pose';
import {createSourcePoseDriver,sourceActorMatrix} from '../game/source-player-contract';
import type {Player} from '../game/types';
const folder='.reference-assets/source-exports/character-t/continuous',available=fs.existsSync(`${folder}/pose-data.json`);
const test=available?it:it.skip;let index:SourceCharacterPoseIndex;
const id='csgo-t-ak-12426148:b2106b26a407d0fa';
beforeAll(()=>{if(available){const data=JSON.parse(fs.readFileSync(`${folder}/pose-data.json`,'utf8'));
 const bytes=fs.readFileSync(`${folder}/frames.f64.bin`);index=prepareSourceCharacterPose(data,bytes);}});
const player=(patch:Partial<Player>={})=>({x:0,y:-3,z:0,yaw:0,pitch:0,grounded:true,crouch:false,shotIdle:10,sourcePoseVersion:id,...patch}) as Player;
it('aligns Source +X with the same browser view-forward direction at cardinal yaws',()=>{
 const zero=sourceActorMatrix({x:2,y:-3,z:5,yaw:0});expect(zero[0]).toBeCloseTo(0,12);expect(zero[2]).toBeCloseTo(-1,12);
 expect([...zero.slice(12,15)]).toEqual([2,-3,5]);const left=sourceActorMatrix({x:0,y:0,z:0,yaw:Math.PI/2});
 expect(left[0]).toBeCloseTo(-1,12);expect(left[2]).toBeCloseTo(0,12);
});
test('drives actual original sequence inputs from accepted displacement and Source model axes',()=>{
 const driver=createSourcePoseDriver(index,id),before=player(),forward=player({z:-.09,pitch:.2});
 const pose=driver.advance(forward,before,1/60);expect(pose.state).toBe('Run');expect(pose.parameters.move_x).toBeCloseTo(1,10);
 expect(pose.parameters.move_y).toBeCloseTo(0,10);expect(pose.parameters.body_pitch).toBeLessThan(0);
 const side=driver.advance(player({x:.09}),before,1/60);expect(side.parameters.move_x).toBeCloseTo(0,10);expect(side.parameters.move_y).toBeCloseTo(-1,10);
 const blocked=driver.advance(player({vx:5}),before,1/60);expect(blocked.state).toBe('Idle');
});
test('keeps authority clocks unwrapped, actor-local and retains real elapsed time after the character fire layer ends',()=>{
 const driver=createSourcePoseDriver(index,id);let p=player(),last=0;
 for(let i=0;i<180;i++){const next=player({...p,z:p.z-.09}),pose=driver.advance(next,p,1/60);expect(pose.cycle).toBeGreaterThanOrEqual(last);last=pose.cycle;p={...next,sourcePose:pose};}
 expect(last).toBeGreaterThan(1);const other=driver.advance(player({z:-.09}),player(),1/60);expect(other.cycle).toBeLessThan(1);
 const shot=driver.advance(player({shotIdle:.81}),player(),0);expect(shot.fireTimeSeconds).toBe(.81);expect(shot.fireCycle).toBe(1);expect(shot.fireWeight).toBe(0);
});
test('holds the frozen ground lower sample in the air while the jump layer fades in from live velocity',()=>{
 const driver=createSourcePoseDriver(index,id),before=player({sourcePose:{state:'Run',cycle:2.3,upperCycle:2,parameters:{move_x:1,move_y:-.3},blendMode:'sdk-3way'}});
 const pose=driver.advance(player({...before,grounded:false,x:1,pitch:.3}),before,1/60);
 expect(pose.state).toBe('Run');expect(pose.cycle).toBe(2.3);
 expect(pose.parameters.move_x).toBeCloseTo(0,10);expect(pose.parameters.move_y).toBe(-1);
 expect(pose.parameters.body_pitch).toBeLessThan(0);
 expect(pose.jump?.airborne).toBe(true);expect(pose.jump?.weight).toBeCloseTo(1/60/.2,8);
});
test('runs the original jump_lower fade-in over the air and fade-out after landing at the sequence fade times',()=>{
 const driver=createSourcePoseDriver(index,id),dt=1/60;
 let previous=player(),pose=driver.advance(previous={...previous,z:-.09},player(),dt);
 expect(pose.state).toBe('Run');expect(pose.jump).toBeUndefined();
 previous={...previous,grounded:false,sourcePose:pose};pose=driver.advance({...previous,z:previous.z-.09},previous,dt);
 expect(pose.jump?.airborne).toBe(true);expect(pose.jump?.weight).toBeCloseTo(dt/.2,8);expect(pose.state).toBe('Run');
 for(let i=0;i<24;i++){previous={...previous,sourcePose:pose};pose=driver.advance({...previous,z:previous.z-.09},previous,dt);}
 expect(pose.jump?.airborne).toBe(true);expect(pose.jump?.weight).toBe(1);expect(pose.jump?.elapsed).toBeGreaterThan(.3);
 previous={...previous,grounded:true,sourcePose:pose};pose=driver.advance({...previous,z:previous.z-.09},previous,dt);
 expect(pose.jump?.airborne).toBe(false);expect(pose.jump?.weight).toBeCloseTo(1-dt/.2,8);
 for(let i=0;i<15;i++){previous={...previous,sourcePose:pose};pose=driver.advance({...previous,z:previous.z-.09},previous,dt);}
 expect(pose.jump).toBeUndefined();expect(pose.state).toBe('Run');
});
test('plays the original Death1 full-body fall once from the kill instant and locks the final frame',()=>{
 const driver=createSourcePoseDriver(index,id),dt=1/60;
 let previous=player({z:-.09}),pose=driver.advance(previous,player(),dt);
 expect(pose.state).toBe('Run');
 previous={...previous,alive:false,sourcePose:pose};pose=driver.advance(previous,previous,dt);
 expect(pose.state).toBe('Death');expect(pose.fireWeight).toBe(0);expect(pose.fireCycle).toBe(0);
 expect(pose.parameters).toEqual({move_x:0,move_y:0,body_yaw:0,body_pitch:0});
 expect(pose.blendMode).toBe('sdk-3way');expect(pose.jump).toBeUndefined();
 // T Death1 is the original 96-frame @30fps fall; the SDK cycle rate is
 // fps/(frames-1)=30/95, so the fall spans 95/30 ≈ 3.17s of playback.
 expect(pose.cycle).toBeCloseTo(dt*30/95,10);
 for(let i=0;i<199;i++){previous={...previous,sourcePose:pose};pose=driver.advance(previous,previous,dt);}
 expect(pose.cycle).toBeCloseTo(1,10);expect(pose.upperCycle).toBeCloseTo(1,10);
 previous={...previous,sourcePose:pose};const locked=driver.advance(previous,previous,dt);
 expect(locked.cycle).toBe(1); // non-looping clamp freezes the corpse forever
});
test('descends through the original Death1 pelvis keyframes from standing to the ground',()=>{
 const at=(cycle:number)=>sampleSourceCharacterPose(index,{state:'Death',parameters:{move_x:0,move_y:0,body_yaw:0,body_pitch:0},
  cycle,upperCycle:cycle,fireCycle:0,fireWeight:0,blendMode:'sdk-3way'});
 const start=at(0),mid=at(.5),end=at(1);
 // Source up is +Z in the original animation space; the pelvis falls 39 -> 6 units.
 expect(start.positions[2]).toBeCloseTo(39.03,1);expect(mid.positions[2]).toBeCloseTo(21.44,1);expect(end.positions[2]).toBeCloseTo(6.09,1);
 expect(start.positions[2]).toBeGreaterThan(mid.positions[2]+5);expect(mid.positions[2]).toBeGreaterThan(end.positions[2]+5);
 for(const s of [start,mid,end]){
  expect(s.sourceWorldMatrices).toHaveLength(index.mainBoneCount*16);
  expect([...s.sourceWorldMatrices].every(Number.isFinite)).toBe(true);
 }
});
test('revival re-enters the ground selector from a fresh clock and undefined aliveness never kills',()=>{
 const driver=createSourcePoseDriver(index,id),dt=1/60;
 const corpse=player({alive:false,sourcePose:{state:'Death',cycle:1,upperCycle:1,parameters:{move_x:0,move_y:0,body_yaw:0,body_pitch:0},fireCycle:0,fireWeight:0,blendMode:'sdk-3way'}});
 const revived=driver.advance(player({...corpse,alive:true,z:-.09}),corpse,dt);
 expect(revived.state).toBe('Run');expect(revived.cycle).toBeLessThan(1);expect(revived.jump).toBeUndefined();
 expect(revived.parameters.move_x).toBeCloseTo(1,10);
 // Driver consumers that never track aliveness stay on the ground selector.
 const living=driver.advance(player({z:-.09}),player(),dt);
 expect(living.state).toBe('Run');
});
