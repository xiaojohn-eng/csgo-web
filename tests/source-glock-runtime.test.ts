import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {createSourceGlockCommandState} from '../game/source-glock-command';
import {createSourcePistolHandlingState,sourcePistolHandlingMovementTick} from '../game/source-pistol-handling';
import {createSourceGlockRuntimeState,sourceGlockRuntimeFrame,sourceGlockRuntimeDeploy,sourceGlockRuntimeHolster,type SourceGlockRuntimeState,type SourceGlockRuntimeInput} from '../game/source-glock-runtime';
const commandPath='output/tests/source-glock-command-native.json',chainPath='output/tests/source-glock-handling-chain-native.json';
const native=existsSync(commandPath)&&existsSync(chainPath)?it:it.skip;
function initial(frame:any,command:any):SourceGlockRuntimeState{
 const handling=createSourcePistolHandlingState('glock18',{glock18:frame.modeBefore,'usp-s':1}),b=frame.before;
 handling.weapons.glock18={penalty:b.penalty,recoilIndex:b.recoilIndex,lastShotTime:b.lastShotTime,lastUpdateTime:b.lastUpdateTime};
 handling.punch={angle:b.angle,velocity:b.velocity,viewPunch:b.viewPunch};
 return {command:createSourceGlockCommandState(command.input),handling};
}
function run(state:SourceGlockRuntimeState,frame:any,command:any,predict=false){
 const {serverSeed,reloadDuration:_,...context}=command.context;
 const result=sourceGlockRuntimeFrame({...state,handling:sourcePistolHandlingMovementTick(state.handling,frame.dt)},
  {...context,accuracy:frame.motion,execution:predict?{type:'prediction'}:{type:'authority',serverSeed}});
 expect(result.state.command).toEqual(command.result.state);
 expect({...result.state.handling.weapons.glock18,...result.state.handling.punch}).toEqual(frame.original);
 expect(result.state.handling.modes.glock18).toBe(frame.finalMode);
 expect(result.events.map(({shot:_,...event}:any)=>event)).toEqual(command.result.events.map((e:any)=>{
  if(!predict)return e;const {serverSeed:_,...rest}=e;return rest;
 }));
 const originalBullets=frame.events.filter((r:any)=>r.event.kind==='bullet');let bulletIndex=0;
 for(const event of result.events){
  if(event.kind!=='bullet')continue;const expected=originalBullets[bulletIndex++].shot;
  if(predict){expect(event.shot).toBeUndefined();expect(event.serverSeed).toBeUndefined();}
  else{expect(event.shot).toMatchObject({inaccuracy:expected.inaccuracy,spread:expected.spread,recoilIndex:expected.recoilIndex,serverSeed,commandSeed:context.commandSeed});}
 }
 expect(bulletIndex).toBe(originalBullets.length);
 return result.state;
}
native('composes the native command and handling consumers in all 1241 original frames',()=>{
 const commands=JSON.parse(readFileSync(commandPath,'utf8')),chain=JSON.parse(readFileSync(chainPath,'utf8'));
 expect(chain.serverSha256).toBe('7de235c31b2d645c5106cbd7358da3f3ac7964e87f870c4fe6ea31d93a714386');expect(chain.independent).toHaveLength(1241);
 for(const frame of chain.independent){const command=commands.cases[frame.caseIndex],state=initial(frame,command);expect(run(state,frame,command,true)).toEqual(run(state,frame,command));}
});
native('replays 400 continuous command/ammo/burst/handling frames through complete JSON snapshots',()=>{
 const commands=JSON.parse(readFileSync(commandPath,'utf8')),chain=JSON.parse(readFileSync(chainPath,'utf8'));let count=0;
 for(const series of chain.chains){const first=series.frames[0];let authority=initial(first,commands.cases[first.caseIndex]),prediction=structuredClone(authority);
  for(const frame of series.frames){const command=commands.cases[frame.caseIndex];authority=run(authority,frame,command);prediction=run(prediction,frame,command,true);expect(prediction).toEqual(authority);if(count%23===0)prediction=JSON.parse(JSON.stringify(prediction));count++;}
 }
 expect(count).toBe(400);writeFileSync('output/tests/source-glock-runtime-validation.json',JSON.stringify({status:'passed',independentNativeFrames:1241,continuousNativeFrames:count,authorityPredictionStateMismatches:0,scope:'Weapon phase bridge. Movement punch integration and OnLand remain caller-owned; no menu, network or playable pistol claim.'},null,2)+'\n');
});
it('uses the native draw gate and zero-duration missing holster without erasing queued state early',()=>{
 let state=createSourceGlockRuntimeState();state.command.burstRemaining=2;state.command.nextBurst=3;
 const holster=sourceGlockRuntimeHolster(state,2);expect(holster.state.command.ownerNextAttack).toBe(2);expect(holster.state.command.burstRemaining).toBe(2);
 state=sourceGlockRuntimeDeploy(holster.state,2,{grounded:true}).state;
 expect(state.command.ownerNextAttack).toBe(Math.fround(2+Math.fround(1.1)));expect(state.command.burstRemaining).toBe(0);
 const frame=sourceGlockRuntimeFrame(state,{now:2.5,dt:1/64,buttons:1,commandSeed:12,accuracy:{grounded:true},execution:{type:'authority',serverSeed:42}});
 expect(frame.dispatch).toBe('busy');expect(frame.state.command.clip).toBe(20);expect(frame.events.some(e=>e.kind==='bullet')).toBe(false);
});
it('strips an accidentally copied authority seed when executing prediction',()=>{
 const input={now:1,dt:1/64,buttons:1,commandSeed:12,serverSeed:999,accuracy:{grounded:true},execution:{type:'prediction'}}as SourceGlockRuntimeInput;
 const result=sourceGlockRuntimeFrame(createSourceGlockRuntimeState(),input);const bullet=result.events.find(e=>e.kind==='bullet');
 expect(bullet).toBeDefined();expect(bullet).not.toHaveProperty('serverSeed');expect(bullet).not.toHaveProperty('shot');
});
