import {createSourceUSPCommandState,sourceUSPCommandFrame,sourceUSPDeploy,sourceUSPHolster,sourceUSPAnimationEvent,
 SOURCE_USP_RELOAD_SEQUENCE_DURATION,SOURCE_USP_SILENCER_SEQUENCE_DURATION,type SourceUSPCommandState,type SourceUSPCommandContext} from './source-usp-command.js';
import {sourceUSPAnimationClock as clock,SOURCE_USP_ACTIVITY_SEQUENCE,type SourceUSPAnimationClock} from './source-usp-animation-clock.js';
import {sourceBaseGunIdleAfterCommand} from './source-basegun-idle.js';
import {createSourcePistolHandlingState,sourcePistolAccuracyDeploy,sourcePistolHandlingMode,sourcePistolHandlingWeaponTick,sourcePistolHandlingBullet,
 sourcePistolHandlingAfterAcceptedBullet,sourcePistolHandlingAfterAcceptedReload,sourcePistolHandlingPrimaryTime,type SourcePistolHandlingState} from './source-pistol-handling.js';
import type {SourceBaseGunCommandEvent} from './source-basegun-command.js';
import type {SourceAccuracyContext} from './source-accuracy.js';

export const SOURCE_USP_RUNTIME_VERSION='csgo-usp-runtime-12426148-r1';
export type SourceUSPAction={activity:183|481|192|194|220|221;time:number;generation:number};
export type SourceUSPRuntimeState={command:SourceUSPCommandState;handling:SourcePistolHandlingState;animation:SourceUSPAnimationClock;idleTime:number;action?:SourceUSPAction};
export type SourceUSPBullet=ReturnType<typeof sourcePistolHandlingBullet>['shot'];
export type SourceUSPRuntimeEvent=Exclude<SourceBaseGunCommandEvent,{kind:'bullet'}>|(Extract<SourceBaseGunCommandEvent,{kind:'bullet'}>&{shot?:SourceUSPBullet});
export type SourceUSPRuntimeInput=Omit<SourceUSPCommandContext,'serverSeed'|'reloadDuration'>&{accuracy:SourceAccuracyContext;execution:{type:'authority';serverSeed:number}|{type:'prediction'}};
function active(state:SourceUSPRuntimeState){if(state.handling.activeWeapon!=='usp-s'||state.handling.modes['usp-s']!==state.command.mode)throw Error('USP command/handling identity differs');}
export function createSourceUSPRuntimeState(now=0):SourceUSPRuntimeState{
 return {command:createSourceUSPCommandState(),handling:createSourcePistolHandlingState('usp-s',{glock18:0,'usp-s':1}),animation:clock.create(now),idleTime:0};
}
export function sourceUSPRuntimeFrame(s:SourceUSPRuntimeState,input:SourceUSPRuntimeInput){
 active(s);const {accuracy,execution,...context}=input;
 const commandContext={...context,reloadDuration:SOURCE_USP_RELOAD_SEQUENCE_DURATION,serverSeed:execution.type==='authority'?execution.serverSeed:undefined};
 const command=sourceUSPCommandFrame(s.command,commandContext);
 const result=sourceBaseGunIdleAfterCommand(s.command,command,commandContext,s.idleTime,{timeToIdle:2,idleInterval:20,
  duration:activity=>{const sequence=SOURCE_USP_ACTIVITY_SEQUENCE[activity];return sequence===undefined?undefined:clock.profile(sequence).duration;},
  additionalDuration:event=>event.kind==='player-animation-event'&&(event.id===15||event.id===16)?SOURCE_USP_SILENCER_SEQUENCE_DURATION:undefined});
 let handling=s.handling,animation=s.animation,action=s.action;const events:SourceUSPRuntimeEvent[]=[];
 for(const event of result.events){
  if(event.kind==='activity'){
   // The fire activity's own sequences are drawn from the client's command seed, which
   // both sides already share, so authority and prediction start the same variant.
   const selected=clock.requestActivity(animation,event.activity,input.commandSeed);animation=selected.state;
   if(selected.applied&&event.activity!==185)action={activity:event.activity as SourceUSPAction['activity'],time:Math.fround(input.now),generation:(action?.generation??0)+1};
  }
  if(event.kind==='weapon-tick')handling=sourcePistolHandlingWeaponTick(sourcePistolHandlingMode(handling,event.mode),{...accuracy,reloading:event.reloading},input.now,input.dt);
  else if(event.kind==='bullet'){
   if(execution.type==='authority'){
    const bullet=sourcePistolHandlingBullet(handling,accuracy,input.now,{commandSeed:event.commandSeed,serverSeed:execution.serverSeed},event);
    handling=bullet.state;events.push({...event,shot:bullet.shot});continue;
   }
   handling=sourcePistolHandlingAfterAcceptedBullet(handling,input.now,event.commandSeed,event);
  }else if(event.kind==='activity'&&event.activity===194)handling=sourcePistolHandlingAfterAcceptedReload(handling);
  events.push(event);
 }
 if(result.dispatch!=='inactive')handling=sourcePistolHandlingMode(sourcePistolHandlingPrimaryTime(handling,result.state.lastShot),result.state.mode);
 return {state:{...s,command:result.state,handling,animation,idleTime:result.idleTime,...(action?{action}:{})},events,dispatch:result.dispatch,buttonsAfter:result.buttonsAfter};
}
export function sourceUSPRuntimeDeploy(s:SourceUSPRuntimeState,now:number,accuracy:SourceAccuracyContext){
 active(s);const deployed=sourceUSPDeploy(s.command,{now}),activity=deployed.state.silencerAttached?481:183;
 const handling={...s.handling,weapons:{...s.handling.weapons,'usp-s':sourcePistolAccuracyDeploy('usp-s',s.command.mode,s.handling.weapons['usp-s'],accuracy,now)}};
 return {state:{...s,command:deployed.state,handling,animation:clock.requestActivity(s.animation,activity).state,idleTime:deployed.state.ownerNextAttack,
  action:{activity:activity as 481|183,time:Math.fround(now),generation:(s.action?.generation??0)+1}},events:deployed.events};
}
export function sourceUSPRuntimeHolster(s:SourceUSPRuntimeState,now:number){
 active(s);const activity=Number(Object.entries(SOURCE_USP_ACTIVITY_SEQUENCE).find(([,sequence])=>sequence===s.animation.sequence)?.[0]??185);
 const result=sourceUSPHolster(s.command,{now,activity});return {state:{...s,command:result.state},events:result.events};
}
/** Original events commit after the shared Player command, never from renderer callbacks. */
export function sourceUSPRuntimePostThink(s:SourceUSPRuntimeState,context:{now:number;viewmodelTime:{animTime:number;previousAnimTime:number}}){
 active(s);const frame=clock.frame({...s.animation,...context.viewmodelTime},context.now);let command=s.command;
 for(const event of frame.events)if(event.recordEvent===44||event.recordEvent===46||event.recordEvent===54)command=sourceUSPAnimationEvent(command,event.recordEvent);
 return {state:{...s,command,animation:frame.state,handling:sourcePistolHandlingMode(s.handling,command.mode)},animationEvents:frame.events};
}
