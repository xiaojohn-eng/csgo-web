import {readFileSync,existsSync} from 'node:fs';
import {expect,it} from 'vitest';
import {SOURCE_PISTOL_ACCURACY_PROFILES as profiles,createSourcePistolHandlingState,sourcePistolAccuracyTick,sourcePistolAccuracyDeploy,sourcePistolInaccuracy,sourcePistolRecoveryTime,sourcePistolRecoil,sourcePistolHandlingTick,sourcePistolHandlingAfterAcceptedShot,sourcePistolHandlingShot,sourcePistolHandlingSwitch,sourcePistolHandlingUspMode,type SourcePistolHandlingState,type SourcePistolWeapon} from '../game/source-pistol-handling';
import {sourcePistolHandlingAfterAcceptedReload,sourcePistolHandlingPrimaryTime,sourcePistolHandlingAfterAcceptedBullet} from '../game/source-pistol-handling';
const path='output/tests/source-pistol-handling-native.json',available=existsSync(path),native=available?it:it.skip;
const report=()=>JSON.parse(readFileSync(path,'utf8'));
function stateFor(r:any):SourcePistolHandlingState{
 const s=createSourcePistolHandlingState(r.weapon,{glock18:r.weapon==='glock18'?r.mode:0,'usp-s':r.weapon==='usp-s'?r.mode:1});
 s.weapons[r.weapon as SourcePistolWeapon]={penalty:r.before.penalty,recoilIndex:r.before.recoilIndex,lastShotTime:r.before.lastShotTime,lastUpdateTime:r.before.lastUpdateTime};
 s.punch={angle:r.before.angle,velocity:r.before.velocity,viewPunch:r.before.viewPunch};return s;
}
function compare(s:SourcePistolHandlingState,expected:any){expect({...s.weapons[s.activeWeapon],...s.punch}).toEqual(expected);}
native('matches actual pistol mode getters, recovery and tick consumers for 1312 contexts',()=>{
 const d=report();expect(d.sourceServerSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');expect(d.rows).toHaveLength(1312);
 for(const r of d.rows){
  const next=sourcePistolAccuracyTick(r.weapon,r.mode,r.before,r.context,r.time,r.dt);
  expect(next).toEqual(Object.fromEntries(['penalty','recoilIndex','lastShotTime','lastUpdateTime'].map(k=>[k,r.original.state[k]])));
  expect(sourcePistolRecoveryTime(r.weapon,r.mode,r.before,r.context)).toBe(r.original.recoveryTime);
  expect(sourcePistolInaccuracy(r.weapon,r.mode,next,r.context)).toBe(r.original.inaccuracy);
  expect(profiles[r.weapon as SourcePistolWeapon][r.mode as 0|1].spread).toBe(r.original.spread);
 }
});
native('matches both complete semi-auto recoil tables without rifle suppression or smoothing',()=>{
 const d=report();let n=0;for(const weapon of ['glock18','usp-s']as const)for(const mode of [0,1]as const)for(let i=0;i<64;i++){
  expect(sourcePistolRecoil(weapon,mode,i)).toEqual(d.tables[weapon][mode][i]);n++;
 }expect(n).toBe(256);
});
native('matches original accepted primary-shot penalty, command-seeded recoil and punch',()=>{
 const d=report();expect(d.shots).toHaveLength(552);let n=0;
 for(const r of d.shots){compare(sourcePistolHandlingAfterAcceptedShot(stateFor(r),r.time,r.commandSeed),r.original);n++;}expect(n).toBe(552);
});
native('matches queued Glock current-mode penalty and hard mode1 recoil without changing primary timestamp',()=>{
 const d=report();expect(d.queued).toHaveLength(276);
 for(const r of d.queued)compare(sourcePistolHandlingAfterAcceptedBullet(stateFor(r),r.time,r.commandSeed,{source:'queued',accuracyMode:r.mode,recoilMode:1}),r.original);
});
native('matches original deployment without resetting player punch',()=>{
 for(const r of report().deploy){const actual=sourcePistolAccuracyDeploy(r.weapon,r.mode,r.before,r.context,r.time);expect(actual).toEqual(Object.fromEntries(['penalty','recoilIndex','lastShotTime','lastUpdateTime'].map(k=>[k,r.original[k]])));}
});
native('matches successful native reload recoil-index increment without shot effects',()=>{
 const d=report();expect(d.reloads).toHaveLength(20);
 for(const r of d.reloads)compare(sourcePistolHandlingAfterAcceptedReload(stateFor(r)),r.original);
});
it('can synchronize dry-fire primary notification without manufacturing accepted shot effects',()=>{
 const s=createSourcePistolHandlingState('glock18',{glock18:0,'usp-s':1});const next=sourcePistolHandlingPrimaryTime(s,1.7);
 expect(next.weapons.glock18).toEqual({...s.weapons.glock18,lastShotTime:Math.fround(1.7)});expect(next.punch).toEqual(s.punch);expect(next.weapons['usp-s']).toBe(s.weapons['usp-s']);
});
native('replays complete original ordinary pistol sequences and restores all JSON state',()=>{
 let n=0;for(const seq of report().sequences){
  let s=stateFor({...seq,before:seq.initial});let restored=JSON.parse(JSON.stringify(s));
  for(const frame of seq.frames){
   for(const which of [0,1]){
    let next=sourcePistolHandlingTick(which===0?s:restored,frame.context,frame.time,frame.dt);
    expect(sourcePistolInaccuracy(next.activeWeapon,next.modes[next.activeWeapon],next.weapons[next.activeWeapon],frame.context)).toBe(frame.inaccuracy);
    if(frame.shot)next=sourcePistolHandlingAfterAcceptedShot(next,frame.time,frame.shot.commandSeed);
    if(which===0)s=next;else restored=next;
   }
   expect(restored).toEqual(s);compare(s,frame.original);if(frame.tick%37===0)restored=JSON.parse(JSON.stringify(s));n++;
  }
 }expect(n).toBe(1920);
});
it('separates command recoil seed from authoritative bullet seed and advances exactly once',()=>{
 let s=createSourcePistolHandlingState('glock18',{glock18:0,'usp-s':1});s=sourcePistolHandlingTick(s,{grounded:true},1,1/64);
 const a=sourcePistolHandlingShot(s,{grounded:true},1,{commandSeed:33,serverSeed:0x1000002a}),b=sourcePistolHandlingShot(s,{grounded:true},1,{commandSeed:33,serverSeed:0x1000002b});
 expect(a.state).toEqual(b.state);expect(a.shot.offset).not.toEqual(b.shot.offset);
 const c=sourcePistolHandlingShot(s,{grounded:true},1,{commandSeed:34,serverSeed:0x1000002a});expect(c.shot.offset).toEqual(a.shot.offset);expect(c.state.punch).not.toEqual(a.state.punch);
 expect(a.state).toEqual(sourcePistolHandlingAfterAcceptedShot(s,1,33));expect(a.shot.punchAngles).toEqual([0,0,0]);expect(a.shot.recoilIndex).toBe(0);expect(a.state.weapons.glock18.recoilIndex).toBe(1);
});
it('preserves per-weapon accuracy and player punch across deployment and USP mode changes',()=>{
 let s=createSourcePistolHandlingState('usp-s',{glock18:0,'usp-s':1});s=sourcePistolHandlingAfterAcceptedShot(s,1,42);
 const off=sourcePistolHandlingUspMode(s,0);expect(off.weapons).toEqual(s.weapons);expect(off.punch).toEqual(s.punch);expect(off.modes['usp-s']).toBe(0);
 const switched=sourcePistolHandlingSwitch(off,'glock18',{grounded:true},2);expect(switched.weapons['usp-s']).toEqual(off.weapons['usp-s']);expect(switched.punch).toEqual(off.punch);
 expect(sourcePistolHandlingSwitch(switched,'glock18',{grounded:true},3)).toBe(switched);
});
it('rejects malformed restored states and impossible queued recoil modes',()=>{
 const usp=createSourcePistolHandlingState('usp-s',{glock18:1,'usp-s':1});expect(()=>sourcePistolHandlingAfterAcceptedBullet(usp,1,42,{source:'queued',accuracyMode:1,recoilMode:1})).toThrow('Glock');
 const s=createSourcePistolHandlingState('glock18',{glock18:0,'usp-s':1});
 expect(()=>sourcePistolHandlingAfterAcceptedBullet(s,1,42,{source:'queued',accuracyMode:0,recoilMode:0})).toThrow();
 expect(()=>sourcePistolHandlingAfterAcceptedShot(s,1,NaN)).toThrow();
 expect(()=>sourcePistolHandlingTick({...s,version:'old'}as any,{grounded:true},1,.01)).toThrow();
 expect(()=>sourcePistolHandlingTick({...s,punch:null}as any,{grounded:true},1,.01)).toThrow();
 expect(()=>sourcePistolHandlingTick({...s,weapons:{...s.weapons,glock18:{...s.weapons.glock18,penalty:NaN}}},{grounded:true},1,.01)).toThrow();
});
