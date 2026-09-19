import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {createSourcePistolHandlingState,sourcePistolHandlingMovementTick,sourcePistolHandlingMode,sourcePistolHandlingWeaponTick,sourcePistolHandlingBullet,sourcePistolHandlingAfterAcceptedBullet,sourcePistolHandlingAfterAcceptedReload,sourcePistolHandlingPrimaryTime,type SourcePistolHandlingState} from '../game/source-pistol-handling';
const path='output/tests/source-glock-handling-chain-native.json',native=existsSync(path)?it:it.skip;
const report=()=>JSON.parse(readFileSync(path,'utf8'));
function state(frame:any){
 const s=createSourcePistolHandlingState('glock18',{glock18:frame.modeBefore,'usp-s':1}),b=frame.before;
 s.weapons.glock18={penalty:b.penalty,recoilIndex:b.recoilIndex,lastShotTime:b.lastShotTime,lastUpdateTime:b.lastUpdateTime};
 s.punch={angle:b.angle,velocity:b.velocity,viewPunch:b.viewPunch};return s;
}
function compare(s:SourcePistolHandlingState,b:any){expect({...s.weapons.glock18,...s.punch}).toEqual(b);}
function replay(s:SourcePistolHandlingState,r:any,predict=false){
 s=sourcePistolHandlingMode(s,r.modeBefore);compare(s,r.before);s=sourcePistolHandlingMovementTick(s,r.dt);
 for(const item of r.events){const e=item.event;
  if(e.kind==='weapon-tick')s=sourcePistolHandlingWeaponTick(sourcePistolHandlingMode(s,e.mode),{...r.motion,reloading:e.reloading},r.time,r.dt);
  else if(e.kind==='bullet'){
   if(predict)s=sourcePistolHandlingAfterAcceptedBullet(s,r.time,e.commandSeed,e);
   else{const result=sourcePistolHandlingBullet(s,r.motion,r.time,{commandSeed:e.commandSeed,serverSeed:e.serverSeed},e);
    expect(result.shot.inaccuracy).toBe(item.shot.inaccuracy);expect(result.shot.spread).toBe(item.shot.spread);expect(result.shot.recoilIndex).toBe(item.shot.recoilIndex);s=result.state;
   }
  }else if(e.kind==='activity'&&e.activity===194)s=sourcePistolHandlingAfterAcceptedReload(s);
  compare(s,item.original);
 }
 s=sourcePistolHandlingMode(sourcePistolHandlingPrimaryTime(s,r.original.lastShotTime),r.finalMode);compare(s,r.original);return s;
}
native('matches independently executed original command events and pistol consumers in 1241 frames',()=>{
 const d=report();expect(d.serverSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');expect(d.commandCorpusSha256).toBe(createHash('sha256').update(readFileSync('output/tests/source-glock-command-native.json')).digest('hex'));expect(d.independent).toHaveLength(1241);
 let queuedBeforeTick=0,sameFramePrimary=0,queueMode0=0;
 for(const frame of d.independent){replay(state(frame),frame);const events=frame.events.map((i:any)=>i.event);
  const q=events.findIndex((e:any)=>e.kind==='bullet'&&e.source==='queued'),t=events.findIndex((e:any)=>e.kind==='weapon-tick'),p=events.findIndex((e:any)=>e.kind==='bullet'&&e.source==='primary');
  if(q>=0&&t>q)queuedBeforeTick++;if(q>=0&&p>t&&t>q)sameFramePrimary++;if(events.some((e:any)=>e.kind==='bullet'&&e.source==='queued'&&e.accuracyMode===0))queueMode0++;
 }
 // Native queued shots increment the Player latch before the later primary
 // gate. Reaching that gate does not mean another primary was accepted.
 expect(queuedBeforeTick).toBe(196);expect(sameFramePrimary).toBe(0);expect(queueMode0).toBe(121);
});
native('preserves 400 continuous native burst frames through JSON restore and prediction without a server bullet seed',()=>{
 const d=report();let count=0;
 for(const chain of d.chains){let authority=state(chain.frames[0]),prediction=JSON.parse(JSON.stringify(authority));
  for(const frame of chain.frames){authority=replay(authority,frame);prediction=replay(prediction,frame,true);expect(prediction).toEqual(authority);if(count%37===0)prediction=JSON.parse(JSON.stringify(prediction));count++;}
 }expect(count).toBe(400);
});
