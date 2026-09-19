import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {SOURCE_AWP_ACCURACY_PROFILES,sourceAWPAccuracyTick,sourceAWPInaccuracy,sourceAWPRecoveryTime,sourceAWPRecoil} from '../game/source-awp-accuracy';
import {createSourceAWPHandlingState,sourceAWPMovementTick,sourceAWPHandlingTick,sourceAWPHandlingAccepted,sourceAWPHandlingReload,sourceAWPHandlingDeploy,type SourceAWPHandlingState} from '../game/source-awp-handling';
const d=JSON.parse(readFileSync('output/tests/source-awp-handling-native.json','utf8'));
function state(before:any){const s=createSourceAWPHandlingState();s.accuracy=Object.fromEntries(['penalty','recoilIndex','lastShotTime','lastUpdateTime'].map(k=>[k,before[k]]))as any;s.punch={angle:before.angle,velocity:before.velocity,viewPunch:before.viewPunch};return s;}
const flat=(s:SourceAWPHandlingState)=>({...s.accuracy,...s.punch});
it('matches original AWP accuracy, recovery and spread in 682 motion contexts',()=>{
 expect(d.sourceServerSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');expect(d.rows).toHaveLength(682);
 for(const r of d.rows){
  const next=sourceAWPAccuracyTick(r.mode,r.before,r.context,r.time,r.dt);
  expect(next).toEqual(Object.fromEntries(['penalty','recoilIndex','lastShotTime','lastUpdateTime'].map(k=>[k,r.original.state[k]])));
  expect(sourceAWPRecoveryTime(r.mode,r.before,r.context)).toBe(r.original.recoveryTime);
  expect(sourceAWPInaccuracy(r.mode,next,r.context)).toBe(r.original.inaccuracy);
  expect(SOURCE_AWP_ACCURACY_PROFILES[r.mode].spread).toBe(r.original.spread);
 }
});
it('matches the original semi-auto recoil table and 276 accepted shot states',()=>{
 for(const mode of [0,1]as const)for(let i=0;i<64;i++)expect(sourceAWPRecoil(mode,i)).toEqual(d.tables.awp[mode][i]);
 expect(d.shots).toHaveLength(276);for(const r of d.shots)expect(flat(sourceAWPHandlingAccepted(state(r.before),r.mode,r.time,r.commandSeed))).toEqual(r.original);
});
it('matches original deploy and reload stores and a continuous 960-frame chain',()=>{
 for(const r of d.deploy)expect(flat(sourceAWPHandlingDeploy(state(r.before),r.mode,r.context,r.time))).toEqual(r.original);
 for(const r of d.reloads)expect(flat(sourceAWPHandlingReload(state(r.before)))).toEqual(r.original);
 let count=0;
 for(const seq of d.sequences){let s=state(seq.initial);for(const frame of seq.frames){
  s=sourceAWPHandlingTick(sourceAWPMovementTick(s,frame.dt),seq.mode,frame.context,frame.time,frame.dt);
  expect(sourceAWPInaccuracy(seq.mode,s.accuracy,frame.context)).toBe(frame.inaccuracy);
  if(frame.shot)s=sourceAWPHandlingAccepted(s,seq.mode,frame.time,frame.shot.commandSeed);
  expect(flat(s)).toEqual(frame.original);if(frame.tick%37===0)s=JSON.parse(JSON.stringify(s));count++;
 }}expect(count).toBe(960);
});
