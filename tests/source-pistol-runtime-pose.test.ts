import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {loadServerSourcePistol} from '../server/source-pistol-data';
import {createSourceGlockPoseDriver,createSourceUSPPoseDriver,interpolateSourcePistolPose} from '../game/source-pistol-runtime-pose';
import {createSourceGlockRuntimeState} from '../game/source-glock-runtime';
import {createSourceUSPRuntimeState,type SourceUSPAction} from '../game/source-usp-runtime';
import {sampleSourcePistolCharacterPose} from '../game/source-pistol-character-pose';
import {interpolatePose} from '../game/pose-timeline';
import type {Player} from '../game/types';
const base=resolve('public/source/csgo-12426148'),native=existsSync(base+'/character-t-glock/manifest.json')?it:it.skip;
async function setup(team:'t'|'ct'){
 const source=await loadServerSourcePistol(base+`/character-${team}-glock/manifest.json`,team,'glock'),driver=createSourceGlockPoseDriver(source.poseIndex,source.poseVersion);
 const player={id:'p',x:0,y:0,z:0,yaw:0,pitch:.05,crouch:false,grounded:true,weapon:'glock',alive:true,deaths:0,sourceContract:'csgo-player-12426148',sourcePoseVersion:source.poseVersion,
  team:team==='t'?'amber':'blue',sourceGlock:createSourceGlockRuntimeState(),shotIdle:100}as Player;
 const at=(time:number,activity:183|192|194=194,generation=1,startedAt=10)=>{
  const p=structuredClone(player);p.sourceGlock!.action={activity,generation,time:startedAt};p.shotIdle=activity===192?time-startedAt:time+90;
  p.sourcePose=driver.advance(p,p,1/60);p.sourcePistolPose=driver.pistolPose!(p,time);return p;
 };return {source,driver,player,at};
}
native('loads both frozen server pistol graphs and uses complete original reload layers',async()=>{
 for(const team of ['t','ct']as const){const {source,at}=await setup(team);for(const time of [10,10.4,10.9,11.8,14]){
  const p=at(time),pose=p.sourcePistolPose!,sample=sampleSourcePistolCharacterPose(source.poseIndex,pose);
  expect(sample.body.sourceWorldMatrices.length).toBe((team==='t'?71:74)*16);expect(pose.bodyLayers?.[0].sequence).toBe('Reload_PISTOL');
  expect(pose.world.layers?.[0].sequence).toBe('pistol_reload');expect(pose.bodyLayers?.[0].cycle).toBe(Math.min(1,(time-10)*pose.clock!.bodyRate));
  expect(pose.world.layers?.[0].cycle).toBe(Math.min(1,(time-10)*pose.clock!.worldRate));
 }}
 await expect(loadServerSourcePistol(base+'/character-t-glock/manifest.json','ct','glock')).rejects.toThrow('manifest SHA');
});
native('retimes reload completion and repeated fire event boundaries without blending actions backwards',async()=>{
 const {at}=await setup('t');
 const a=at(10.8),b=at(11.1),mid=interpolatePose(a,b,.5,.3),expected=at(10.95);
 expect(mid.sourcePistolPose).toEqual(expected.sourcePistolPose);expect(mid.sourcePose).toEqual(mid.sourcePistolPose!.body);
 const old=at(11,192,1,10.8),next=at(11.2,192,2,11.15);
 const before=interpolateSourcePistolPose(old.sourcePistolPose!,next.sourcePistolPose!,.5,.2),after=interpolateSourcePistolPose(old.sourcePistolPose!,next.sourcePistolPose!,.9,.2);
 expect(before.clock?.generation).toBe(1);expect(after.clock?.generation).toBe(2);
 expect(after.world.layers![0].cycle).toBeCloseTo(.03*after.clock!.worldRate,12);
 before.world.parameters.body_yaw=50;expect(old.sourcePistolPose!.world.parameters.body_yaw).toBe(0);
});
native('classifies actual Glock IN_SPEED as walking at its native 124.8 unit cap',async()=>{
 const {driver,player}=await setup('t'),dt=1/60;
 player.sourceWalking=true;player.z=-240*.52*.0254*dt;
 expect(driver.advance(player,{...player,z:0},dt).state).toBe('Walk');
 player.sourceWalking=false;player.z=-240*.0254*dt;expect(driver.advance(player,{...player,z:0},dt).state).toBe('Run');
});

const nativeUSP=existsSync(base+'/character-t-usp/manifest.json')&&existsSync(base+'/character-ct-usp/manifest.json')?it:it.skip;
const displayEvents=(sequence:unknown)=>(sequence as {events:{cycle:number;name:string}[]}).events;
async function setupUSP(team:'t'|'ct'){
 const source=await loadServerSourcePistol(base+`/character-${team}-usp/manifest.json`,team,'usp'),driver=createSourceUSPPoseDriver(source.poseIndex,source.poseVersion);
 const player={id:'usp-owner',x:0,y:0,z:0,yaw:0,pitch:.05,crouch:false,grounded:true,weapon:'usp',alive:true,deaths:0,sourceContract:'csgo-player-12426148',sourcePoseVersion:source.poseVersion,
  team:team==='t'?'amber':'blue',sourceUSP:createSourceUSPRuntimeState(),shotIdle:100}as Player;
 const at=(time:number,activity:SourceUSPAction['activity'],attached:boolean,state:'Idle'|'Walk'|'Run'|'Crouch_Idle'|'Crouch_Walk'='Idle',generation=1,startedAt=10)=>{
  const p=structuredClone(player);p.sourceUSP!.action={activity,generation,time:startedAt};p.sourceUSP!.command.silencerAttached=attached;p.sourceUSP!.command.mode=attached?1:0;
  p.shotIdle=activity===192?Math.max(0,time-startedAt):time+90;p.sourcePose=driver.advance(p,p,1/60);p.sourcePose.state=state;
  p.sourcePistolPose=driver.pistolPose!(p,time);return p;
 };return {source,driver,player,at};
}
nativeUSP('samples original T/CT USP reload, fire and silencer actions with separate body and world clocks',async()=>{
 for(const team of ['t','ct']as const){const {source,at}=await setupUSP(team);
  for(const state of ['Idle','Walk','Run','Crouch_Idle','Crouch_Walk']as const)for(const activity of [192,194,220,221]as const){
   const p=at(11,activity,activity!==220,state),pose=p.sourcePistolPose!,sample=sampleSourcePistolCharacterPose(source.poseIndex,pose);
   const crouch=state.startsWith('Crouch'),moving=['Walk','Run','Crouch_Walk'].includes(state);
   const expectedWorld=activity===192?'pistol_fire'+(crouch?'_crouch':''):activity===194?'pistol_reload'+(crouch?'_crouch':'')+(moving?'_moving':''):
    `pistol_silencer_${activity===220?'ON':'OFF'}`+(crouch?'_crouch':moving?'_moving':'');
   expect(pose.world.layers?.[0].sequence).toBe(expectedWorld);
   // Independent values from MDL descriptors: 13/78/136 world frames at 30 fps;
   // 78 reload / 146 silencer body frames. Do not reuse viewmodel durations.
   expect(pose.clock!.worldRate).toBeCloseTo(30/(activity===192?12:activity===194?77:135),6);
   if(activity!==192){expect(pose.bodyLayers?.[0].sequence).toBe(activity===194?'Reload_PISTOL':activity===220?'Silencer_Attach_Pistol':'Silencer_Detach_Pistol');
    expect(pose.clock!.bodyRate).toBeCloseTo(30/(activity===194?77:145),6);}
   expect(sample.body.sourceWorldMatrices.length).toBe((team==='t'?71:74)*16);
   expect(sample.sourceWeaponWorldMatrices.length).toBe(95*16);
   expect([...sample.body.sourceWorldMatrices,...sample.sourceWeaponWorldMatrices].every(Number.isFinite)).toBe(true);
   expect(at(16,activity,activity!==221,state).sourcePistolPose!.world.layers?.[0].weight).toBe(0);
  }
 }
});
nativeUSP('keeps committed attachment separate from original world silencer and magazine display events',async()=>{
 const {source,at}=await setupUSP('ct');
 for(const [activity,name,initial,first,last]of [[220,'pistol_silencer_ON',false,false,true],[221,'pistol_silencer_OFF',true,true,false]]as const){
  const events=displayEvents(source.poseIndex.world.named.get(name)),rate=at(10,activity,initial).sourcePistolPose!.clock!.worldRate;
  const edge=events[1].cycle/rate;
  expect(at(10,activity,initial).sourcePistolPose!.silencerVisible).toBe(first);
  expect(at(10+edge-1e-6,activity,initial).sourcePistolPose!.silencerVisible).toBe(first);
  expect(at(10+edge+1e-6,activity,initial).sourcePistolPose!.silencerVisible).toBe(last);
  const beforeCommit=at(11,220,false);expect(beforeCommit.sourcePistolPose!.silencerVisible).toBe(true);
  expect(beforeCommit.sourceUSP!.command.silencerAttached).toBe(false);
 }
 const events=displayEvents(source.poseIndex.world.named.get('pistol_reload')),rate=at(10,194,true).sourcePistolPose!.clock!.worldRate;
 expect(at(10+events[0].cycle/rate-1e-6,194,true).sourcePistolPose!.magazineVisible).toBe(true);
 expect(at(10+events[0].cycle/rate+1e-6,194,true).sourcePistolPose!.magazineVisible).toBe(false);
 expect(at(10+events[1].cycle/rate+1e-6,194,true).sourcePistolPose!.magazineVisible).toBe(true);
 // No action name implies a committed state. Draw/redraw must use authority.
 for(const activity of [183,481]as const)for(const attached of [false,true]){
  const pose=at(20,activity,attached).sourcePistolPose!;expect(pose.silencerVisible).toBe(attached);expect(pose.world.layers).toEqual([]);
 }
});
nativeUSP('retimes world display event crossings and cancelled transitions through the network pose clock',async()=>{
 const {source,at}=await setupUSP('t'),rate=at(10,220,false).sourcePistolPose!.clock!.worldRate;
 const crossing=10+displayEvents(source.poseIndex.world.named.get('pistol_silencer_ON'))[1].cycle/rate;
 const a=at(crossing-.05,220,false),b=at(crossing+.05,220,false);
 for(const t of [.1,.9]){const pose=interpolateSourcePistolPose(a.sourcePistolPose!,b.sourcePistolPose!,t,.1);
  const now=a.sourcePistolPose!.clock!.time+(b.sourcePistolPose!.clock!.time-a.sourcePistolPose!.clock!.time)*t,expected=at(now,220,false).sourcePistolPose!;
  expect(pose.body.fireTimeSeconds).toBeCloseTo(expected.body.fireTimeSeconds!,12);
  expect({...pose,body:undefined}).toEqual({...expected,body:undefined});}
 const old=at(11,220,false),cancelled=at(11.2,183,false,'Idle',2,11.15);
 expect(interpolateSourcePistolPose(old.sourcePistolPose!,cancelled.sourcePistolPose!,.5,.2).silencerVisible).toBe(true);
 const after=interpolateSourcePistolPose(old.sourcePistolPose!,cancelled.sourcePistolPose!,.9,.2);
 expect(after.silencerVisible).toBe(false);expect(after.world.layers).toEqual([]);expect(after.clock?.generation).toBe(2);
});
nativeUSP('requires the matching USP graph, body pose and explicit authoritative state',async()=>{
 const {source,driver,player}=await setupUSP('t');
 expect(()=>createSourceGlockPoseDriver(source.poseIndex,source.poseVersion)).toThrow('Glock pose driver');
 expect(()=>createSourceUSPPoseDriver({...source.poseIndex,weapon:'glock'},source.poseVersion)).toThrow('USP pose driver');
 expect(()=>driver.pistolPose!(player,10)).toThrow('current shared body pose');
 player.sourcePose=driver.advance(player,player,1/60);
 expect(()=>driver.pistolPose!({...player,sourceUSP:undefined},10)).toThrow('authoritative USP state');
 expect(()=>driver.pistolPose!(player,Number.NaN)).toThrow('current shared body pose');
});
