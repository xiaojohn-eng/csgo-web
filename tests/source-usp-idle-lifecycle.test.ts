import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {sourceBaseGunIdleAfterCommand} from '../game/source-basegun-idle';
import {createSourceUSPCommandState,sourceUSPCommandFrame,sourceUSPDeploy,sourceUSPHolster,SOURCE_USP_RELOAD_SEQUENCE_DURATION} from '../game/source-usp-command';
import {SOURCE_USP_ACTIVITY_SEQUENCE,sourceUSPAnimationClock} from '../game/source-usp-animation-clock';
const native=JSON.parse(readFileSync('output/tests/source-usp-idle-lifecycle-native.json','utf8'));
const keys=Object.keys(createSourceUSPCommandState());
const project=(s:Record<string,any>)=>Object.fromEntries(Object.entries(s).filter(([k])=>keys.includes(k)));
it('uses original USP model duration with the same native idle invocation and ordered stores',()=>{
 expect(native.cases).toHaveLength(72);
 for(const [i,row]of native.cases.entries()){
  const before=createSourceUSPCommandState(project(row.input)),context={...row.context,reloadDuration:SOURCE_USP_RELOAD_SEQUENCE_DURATION};
  const command=sourceUSPCommandFrame(before,context);
  const result=sourceBaseGunIdleAfterCommand(before,command,context,row.input.idleTime,{timeToIdle:2,idleInterval:20,additionalDuration:event=>event.kind==='player-animation-event'&&(event.id===15||event.id===16)?Math.fround(145/30):undefined,duration:activity=>{
   const sequence=SOURCE_USP_ACTIVITY_SEQUENCE[activity];return sequence===undefined?undefined:sourceUSPAnimationClock.profile(sequence).duration;
  }});
  expect({state:result.state,events:result.events,idleTime:result.idleTime,idleInvoked:result.idleInvoked,idleStores:result.idleStores},`native ${i}`).toEqual({state:project(row.result.state),events:row.result.events,idleTime:row.result.idleTime,idleInvoked:row.result.idleInvoked,idleStores:row.result.idleStores});
 }
});
it('matches original holster interruption and deploy without undoing a committed attachment event',()=>{
 expect(native.lifecycle).toHaveLength(72);
 for(const row of native.lifecycle){
  const before=createSourceUSPCommandState(project(row.input));
  const result=row.context.operation==='deploy'?sourceUSPDeploy(before,row.context):sourceUSPHolster(before,{...row.context,activity:row.input.activity});
  expect(result.state).toEqual(project(row.result.state));
  expect(result.events).toEqual(row.result.events.map(({selected,sequence,...event}:any)=>event));
 }
});
