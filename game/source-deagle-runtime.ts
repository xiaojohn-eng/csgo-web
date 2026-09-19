import {createSourceDeagleCommandState,sourceDeagleCommandFrame,sourceDeagleDeploy,sourceDeagleHolster,sourceDeagleAnimationEvent,SOURCE_DEAGLE_RELOAD_SEQUENCE_DURATION,type SourceDeagleCommandState,type SourceDeagleCommandContext} from './source-deagle-command.js';
import {sourceDeagleAnimationClock as clock,SOURCE_DEAGLE_ACTIVITY_SEQUENCE,type SourceDeagleAnimationClock} from './source-deagle-animation-clock.js';
import {sourceBaseGunIdleAfterCommand} from './source-basegun-idle.js';
import {createSourceDeagleHandlingState,sourceDeagleHandlingTick,sourceDeagleHandlingDeploy,sourceDeagleHandlingAccepted,sourceDeagleHandlingReload,sourceDeagleHandlingPrimaryTime,sourceDeagleHandlingBullet,type SourceDeagleHandlingState} from './source-deagle-handling.js';
import type {SourceBaseGunCommandEvent} from './source-basegun-command.js';
import type {SourceAccuracyContext} from './source-accuracy.js';
export const SOURCE_DEAGLE_RUNTIME_VERSION='csgo-deagle-runtime-12426148-r1';
export type SourceDeagleAction={activity:183|192|195|194;time:number;generation:number};
export type SourceDeagleRuntimeState={command:SourceDeagleCommandState;handling:SourceDeagleHandlingState;animation:SourceDeagleAnimationClock;idleTime:number;action?:SourceDeagleAction};
export type SourceDeagleBullet=ReturnType<typeof sourceDeagleHandlingBullet>['shot'];
export type SourceDeagleRuntimeEvent=Exclude<SourceBaseGunCommandEvent,{kind:'bullet'}>|(Extract<SourceBaseGunCommandEvent,{kind:'bullet'}>&{shot?:SourceDeagleBullet});
export type SourceDeagleRuntimeInput=Omit<SourceDeagleCommandContext,'serverSeed'|'reloadDuration'>&{accuracy:SourceAccuracyContext;execution:{type:'authority';serverSeed:number}|{type:'prediction'}};
export function createSourceDeagleRuntimeState(now=0):SourceDeagleRuntimeState{return {command:createSourceDeagleCommandState(),handling:createSourceDeagleHandlingState(),animation:clock.create(now),idleTime:0};}
export function sourceDeagleRuntimeFrame(s:SourceDeagleRuntimeState,input:SourceDeagleRuntimeInput){
 const {accuracy,execution,...context}=input;
 const commandContext={...context,reloadDuration:SOURCE_DEAGLE_RELOAD_SEQUENCE_DURATION,serverSeed:execution.type==='authority'?execution.serverSeed:undefined};
 const command=sourceDeagleCommandFrame(s.command,commandContext);
 const result=sourceBaseGunIdleAfterCommand(s.command,command,commandContext,s.idleTime,{timeToIdle:2,idleInterval:20,duration:activity=>{const sequence=SOURCE_DEAGLE_ACTIVITY_SEQUENCE[activity];return sequence===undefined?undefined:clock.profile(sequence).duration;}});
 let handling=s.handling,animation=s.animation,action=s.action;const events:SourceDeagleRuntimeEvent[]=[];
 for(const event of result.events){
  if(event.kind==='activity'){
   // The fire activity's own sequences are drawn from the client's command seed, which
   // both sides already share, so authority and prediction start the same variant.
   const selected=clock.requestActivity(animation,event.activity,input.commandSeed);animation=selected.state;
   if(selected.applied&&event.activity!==185)action={activity:event.activity as SourceDeagleAction['activity'],time:Math.fround(input.now),generation:(action?.generation??0)+1};
  }
  if(event.kind==='weapon-tick')handling=sourceDeagleHandlingTick(handling,{...accuracy,reloading:event.reloading},input.now,input.dt);
  else if(event.kind==='bullet'){
   if(event.source!=='primary'||event.mode!==0||event.accuracyMode!==0||event.recoilMode!==0)throw Error('Invalid Deagle bullet dispatch');
   if(execution.type==='authority'){
    const bullet=sourceDeagleHandlingBullet(handling,accuracy,input.now,{commandSeed:event.commandSeed,serverSeed:execution.serverSeed},event.scheduledTime);handling=bullet.state;events.push({...event,shot:bullet.shot});continue;
   }handling=sourceDeagleHandlingAccepted(handling,input.now,event.commandSeed);
  }else if(event.kind==='activity'&&event.activity===194)handling=sourceDeagleHandlingReload(handling);
  events.push(event);
 }
 if(result.dispatch!=='inactive')handling=sourceDeagleHandlingPrimaryTime(handling,result.state.lastShot);
 return {state:{...s,command:result.state,handling,animation,idleTime:result.idleTime,...(action?{action}:{})},events,dispatch:result.dispatch,buttonsAfter:result.buttonsAfter};
}
export function sourceDeagleRuntimeDeploy(s:SourceDeagleRuntimeState,now:number,accuracy:SourceAccuracyContext){
 const deployed=sourceDeagleDeploy(s.command,{now});
 return {state:{...s,command:deployed.state,handling:sourceDeagleHandlingDeploy(s.handling,accuracy,now),animation:clock.requestActivity(s.animation,183).state,idleTime:deployed.state.ownerNextAttack,action:{activity:183 as const,time:Math.fround(now),generation:(s.action?.generation??0)+1}},events:deployed.events};
}
export function sourceDeagleRuntimeHolster(s:SourceDeagleRuntimeState,now:number){const result=sourceDeagleHolster(s.command,{now});return {state:{...s,command:result.state},events:result.events};}
export function sourceDeagleRuntimePostThink(s:SourceDeagleRuntimeState,context:{now:number;viewmodelTime:{animTime:number;previousAnimTime:number}}){
 const frame=clock.frame({...s.animation,...context.viewmodelTime},context.now);let command=s.command;
 for(const event of frame.events)if(event.recordEvent===54)command=sourceDeagleAnimationEvent(command,54);
 return {state:{...s,command,animation:frame.state},animationEvents:frame.events};
}
