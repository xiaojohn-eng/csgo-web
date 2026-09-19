import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {createSourceAWPCommandState} from '../game/source-awp-command';
import {sourceAWPMovementTick} from '../game/source-awp-handling';
import {sourceAWPRecoil} from '../game/source-awp-accuracy';
import {createSourceAWPRuntimeState,sourceAWPRuntimeFrame,sourceAWPRuntimeDeploy,sourceAWPRuntimeHolster,sourceAWPRuntimePostThink,type SourceAWPRuntimeState,type SourceAWPRuntimeEvent} from '../game/source-awp-runtime';
const raw=readFileSync('output/tests/source-awp-runtime-native.json');
const command=JSON.parse(raw.toString()),oracle=JSON.parse(readFileSync('output/tests/source-awp-runtime-handling-native.json','utf8'));
function initialState(before:any){const state=createSourceAWPRuntimeState(10);state.handling.accuracy={penalty:before.penalty,recoilIndex:before.recoilIndex,lastShotTime:before.lastShotTime,lastUpdateTime:before.lastUpdateTime};state.handling.punch={angle:before.angle,velocity:before.velocity,viewPunch:before.viewPunch};return state;}
const flat=(state:SourceAWPRuntimeState)=>({...state.handling.accuracy,...state.handling.punch});
function step(current:SourceAWPRuntimeState,row:any,accuracy:any,prediction=false){
 current={...current,handling:sourceAWPMovementTick(current.handling,row.context.dt)};
 const input={...row.context,accuracy,execution:prediction||row.context.serverSeed===undefined?{type:'prediction' as const}:{type:'authority' as const,serverSeed:row.context.serverSeed}};
 const result=row.context.operation==='holster'?sourceAWPRuntimeHolster(current,row.context.now):row.context.operation==='deploy'?sourceAWPRuntimeDeploy(current,row.context.now,accuracy):sourceAWPRuntimeFrame(current,input);
 const state=row.clock?sourceAWPRuntimePostThink(result.state,{now:row.context.now,viewmodelTime:result.state.animation}).state:result.state;
 return {state,events:result.events as SourceAWPRuntimeEvent[]};
}
it('matches 3,000 original command/VM events joined to original numeric consumers and JSON replay',()=>{
 expect(createHash('sha256').update(raw).digest('hex')).toBe(oracle.sourceCommandSha256);expect(oracle.rows).toHaveLength(3000);
 let shots=0;
 for(const chain of oracle.sequences){
  let current=initialState(chain.initial),predicted=initialState(chain.initial);
  current.command=createSourceAWPCommandState(command.cases[oracle.rows[chain.start].commandIndex].input);predicted.command={...current.command};
  for(const [index,row]of oracle.rows.slice(chain.start,chain.start+chain.count).entries()){
   const native=command.cases[row.commandIndex];
   const result=step(JSON.parse(JSON.stringify(current)),native,row.accuracy),prediction=step(JSON.parse(JSON.stringify(predicted)),native,row.accuracy,true);
   current=result.state;predicted=prediction.state;
   expect(flat(current),`${chain.start}/${index} native handling`).toEqual(row.original);
   expect(predicted.handling,`${chain.start}/${index} authority/prediction`).toEqual(current.handling);
   expect(predicted.command).toEqual(current.command);expect(predicted.animation).toEqual(current.animation);
   const bullets=result.events.filter(e=>e.kind==='bullet'),predictedBullets=prediction.events.filter(e=>e.kind==='bullet');
   expect(bullets).toHaveLength(row.shots.length);shots+=bullets.length;
   for(const [i,event]of bullets.entries()){
    if(event.kind!=='bullet')continue;
    if(native.context.serverSeed!==undefined){expect(event.shot).toMatchObject(row.shots[i]);expect(event.shot).toMatchObject({weapon:'awp',commandSeed:native.context.commandSeed,serverSeed:native.context.serverSeed});}
    else expect(event).not.toHaveProperty('shot');
   }
   for(const event of predictedBullets){expect(event).not.toHaveProperty('shot');expect(event).not.toHaveProperty('serverSeed');}
  }
 }
 expect(shots).toBe(oracle.bullets);expect(oracle.modeCounts['0']).toBeGreaterThan(0);expect(oracle.modeCounts['1']).toBeGreaterThan(0);
});
it('retains ballistic penalty across manual zoom and uses pre-unzoom mode for authoritative fire',()=>{
 let state=createSourceAWPRuntimeState(10);state.handling.accuracy.penalty=Math.fround(.37);
 const zoom=sourceAWPRuntimeFrame(state,{now:10,dt:0,buttons:2048,commandSeed:123,accuracy:{grounded:true},execution:{type:'prediction'}});
 expect(zoom.state.handling.accuracy.penalty).toBe(Math.fround(.37));expect(zoom.events).toContainEqual({kind:'zoom-smoothing-reset',field:'0xa8c',value:0});
 state=zoom.state;
 const fire=sourceAWPRuntimeFrame(state,{now:10.0625,dt:1/64,buttons:1,commandSeed:123,accuracy:{grounded:true},execution:{type:'authority',serverSeed:456}});
 const bullet=fire.events.find(e=>e.kind==='bullet');expect(bullet).toMatchObject({mode:1,accuracyMode:1,recoilMode:1,shot:{mode:1,accuracyMode:1,recoilMode:1}});
 expect(fire.state.command).toMatchObject({mode:0,resumeZoom:true,zoomLevel:1,scoped:false});
 expect(sourceAWPRecoil(1,123)).not.toEqual(sourceAWPRecoil(0,123));
 if(bullet?.kind==='bullet')expect(bullet.shot!.inaccuracy).toBeGreaterThan(.3);
});
