import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {SOURCE_PISTOL_ACCURACY_PROFILES,sourcePistolAccuracyTick,sourcePistolInaccuracy,sourcePistolRecoveryTime,sourcePistolRecoil} from '../game/source-pistol-handling';
import {createSourceDeagleHandlingState,sourceDeagleMovementTick,sourceDeagleHandlingTick,sourceDeagleHandlingAccepted,sourceDeagleHandlingReload,sourceDeagleHandlingDeploy,type SourceDeagleHandlingState} from '../game/source-deagle-handling';
const d=JSON.parse(readFileSync('output/tests/source-deagle-handling-native.json','utf8'));
function state(before:any){const s=createSourceDeagleHandlingState();s.accuracy=Object.fromEntries(['penalty','recoilIndex','lastShotTime','lastUpdateTime'].map(k=>[k,before[k]]))as any;s.punch={angle:before.angle,velocity:before.velocity,viewPunch:before.viewPunch};return s;}
const flat=(s:SourceDeagleHandlingState)=>({...s.accuracy,...s.punch});
it('matches original Deagle accuracy, recovery and spread in 328 motion contexts',()=>{
 expect(d.sourceServerSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');expect(d.rows).toHaveLength(328);
 for(const r of d.rows){
  const next=sourcePistolAccuracyTick('deagle',0,r.before,r.context,r.time,r.dt);
  expect(next).toEqual(Object.fromEntries(['penalty','recoilIndex','lastShotTime','lastUpdateTime'].map(k=>[k,r.original.state[k]])));
  expect(sourcePistolRecoveryTime('deagle',0,r.before,r.context)).toBe(r.original.recoveryTime);
  expect(sourcePistolInaccuracy('deagle',0,next,r.context)).toBe(r.original.inaccuracy);
  expect(SOURCE_PISTOL_ACCURACY_PROFILES.deagle[0].spread).toBe(r.original.spread);
 }
});
it('matches the original semi-auto recoil table and 138 accepted shot states',()=>{
 for(let i=0;i<64;i++)expect(sourcePistolRecoil('deagle',0,i)).toEqual(d.tables.deagle[0][i]);
 expect(d.shots).toHaveLength(138);for(const r of d.shots)expect(flat(sourceDeagleHandlingAccepted(state(r.before),r.time,r.commandSeed))).toEqual(r.original);
});
it('matches original deploy and reload stores and a continuous 480-frame chain',()=>{
 for(const r of d.deploy)expect(flat(sourceDeagleHandlingDeploy(state(r.before),r.context,r.time))).toEqual(r.original);
 for(const r of d.reloads)expect(flat(sourceDeagleHandlingReload(state(r.before)))).toEqual(r.original);
 let count=0;
 for(const seq of d.sequences){let s=state(seq.initial);for(const frame of seq.frames){
  s=sourceDeagleHandlingTick(sourceDeagleMovementTick(s,frame.dt),frame.context,frame.time,frame.dt);
  expect(sourcePistolInaccuracy('deagle',0,s.accuracy,frame.context)).toBe(frame.inaccuracy);
  if(frame.shot)s=sourceDeagleHandlingAccepted(s,frame.time,frame.shot.commandSeed);
  expect(flat(s)).toEqual(frame.original);if(frame.tick%37===0)s=JSON.parse(JSON.stringify(s));count++;
 }}expect(count).toBe(480);
});
