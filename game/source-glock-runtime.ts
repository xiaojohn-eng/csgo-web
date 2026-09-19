import {createSourceGlockCommandState,sourceGlockCommandFrame,sourceGlockDeploy,sourceGlockHolster,SOURCE_GLOCK_DRAW_SEQUENCE_DURATION,SOURCE_GLOCK_RELOAD_SEQUENCE_DURATION,
 type SourceGlockCommandState,type SourceGlockCommandContext,type SourceGlockCommandEvent} from './source-glock-command.js';
import {createSourcePistolHandlingState,sourcePistolAccuracyDeploy,sourcePistolHandlingMode,sourcePistolHandlingWeaponTick,sourcePistolHandlingBullet,sourcePistolHandlingAfterAcceptedBullet,
 sourcePistolHandlingAfterAcceptedReload,sourcePistolHandlingPrimaryTime,type SourcePistolHandlingState} from './source-pistol-handling.js';
import type {SourceAccuracyContext} from './source-accuracy.js';
import {createSourceGlockAnimationClock,resetSourceGlockAnimationClock,sourceGlockAnimationFrame,requestSourceGlockAnimationActivity,type SourceGlockAnimationClock,type SourceGlockAnimationSequence} from './source-glock-animation-clock.js';
import {sourcePistolCompleteReload,SOURCE_COMPLETE_RELOAD_EVENT} from './source-pistol-animation-events.js';
import {sourceGlockIdleAfterCommand,type SourceGlockIdleEvent} from './source-glock-idle.js';

export const SOURCE_GLOCK_RUNTIME_VERSION='csgo-glock-runtime-12426148-r2' as const;
export type SourceGlockAction={activity:183|192|194;time:number;generation:number};
export type SourceGlockRuntimeState={command:SourceGlockCommandState;handling:SourcePistolHandlingState;action?:SourceGlockAction;animation?:SourceGlockAnimationClock;idleTime?:number};
const activitySequence:Record<SourceGlockAction['activity'],SourceGlockAnimationSequence>={183:3,192:1,194:4};
export type SourceGlockBullet=ReturnType<typeof sourcePistolHandlingBullet>['shot'];
export type SourceGlockRuntimeEvent=Exclude<SourceGlockIdleEvent,{kind:'bullet'}>|
 (Extract<SourceGlockCommandEvent,{kind:'bullet'}>&{shot?:SourceGlockBullet});
export type SourceGlockRuntimeInput=Omit<SourceGlockCommandContext,'serverSeed'|'reloadDuration'>&{
 accuracy:SourceAccuracyContext;
 /** The current command has one server bullet seed. Prediction never supplies
  * one and never constructs a shot ray or synthetic random sample. */
 execution:{type:'authority';serverSeed:number}|{type:'prediction'};
};
function active(s:SourceGlockRuntimeState){
 if(s.handling.activeWeapon!=='glock18'||s.handling.modes.glock18!==s.command.mode)throw Error('Glock command/handling identity differs');
}
export function createSourceGlockRuntimeState(now=0):SourceGlockRuntimeState{
 return {command:createSourceGlockCommandState(),handling:createSourcePistolHandlingState('glock18',{glock18:0,'usp-s':1}),animation:createSourceGlockAnimationClock(now),idleTime:0};
}
/** Weapon phase only. The owning Simulation must integrate player punch once,
 * move/collide, then apply any retained OnLand event BEFORE this call. */
export function sourceGlockRuntimeFrame(s:SourceGlockRuntimeState,input:SourceGlockRuntimeInput){
 active(s);const {accuracy,execution,...context}=input;
 const commandContext={...context,reloadDuration:SOURCE_GLOCK_RELOAD_SEQUENCE_DURATION,serverSeed:execution.type==='authority'?execution.serverSeed:undefined};
 const commandResult=sourceGlockCommandFrame(s.command,commandContext);
 // Optional only for pre-clock frozen oracle fixtures. Live players are born
 // with the complete timer and replay it through their JSON snapshots.
 const idle=s.idleTime===undefined?undefined:sourceGlockIdleAfterCommand(s.command,commandResult,commandContext,s.idleTime);
 const result=idle??commandResult;
 let handling=s.handling,action=s.action,animation=s.animation;const events:SourceGlockRuntimeEvent[]=[];
 for(const event of result.events){
  if(event.kind==='activity'&&event.activity===185){
   if(animation)animation=requestSourceGlockAnimationActivity(animation,185).state;
  }else if(event.kind==='activity'&&event.activity!==184){
   action={activity:event.activity,time:Math.fround(input.now),generation:(action?.generation??0)+1};
   if(animation)animation=resetSourceGlockAnimationClock(animation,activitySequence[event.activity]);
  }
  if(event.kind==='weapon-tick')handling=sourcePistolHandlingWeaponTick(sourcePistolHandlingMode(handling,event.mode),{...accuracy,reloading:event.reloading},input.now,input.dt);
  else if(event.kind==='bullet'){
   if(execution.type==='authority'){
    const shot=sourcePistolHandlingBullet(handling,accuracy,input.now,{commandSeed:event.commandSeed,serverSeed:execution.serverSeed},event);
    handling=shot.state;events.push({...event,shot:shot.shot});continue;
   }
   handling=sourcePistolHandlingAfterAcceptedBullet(handling,input.now,event.commandSeed,event);
  }else if(event.kind==='activity'&&event.activity===194)handling=sourcePistolHandlingAfterAcceptedReload(handling);
  events.push(event);
 }
 // Primary attempted fire has a separate original timestamp notification;
 // queued shots do not write it. Keep even the native dry-fire distinction.
 if(result.dispatch!=='inactive')handling=sourcePistolHandlingMode(sourcePistolHandlingPrimaryTime(handling,result.state.lastShot),result.state.mode);
 return {state:{...s,command:result.state,handling,...(action?{action}:{}),...(animation?{animation}:{}),...(idle?{idleTime:idle.idleTime}:{})},events,dispatch:result.dispatch,buttonsAfter:result.buttonsAfter};
}
/** Re-equip always executes original accuracy deployment, even when this is
 * the last active pistol. The caller owns shared Player punch/attack fields. */
export function sourceGlockRuntimeDeploy(s:SourceGlockRuntimeState,now:number,accuracy:SourceAccuracyContext){
 active(s);const deployed=sourceGlockDeploy(s.command,{now,sequenceDuration:SOURCE_GLOCK_DRAW_SEQUENCE_DURATION});
 const handling={...s.handling,weapons:{...s.handling.weapons,glock18:sourcePistolAccuracyDeploy('glock18',s.command.mode,s.handling.weapons.glock18,accuracy,now)}};
 const animation=resetSourceGlockAnimationClock(s.animation??createSourceGlockAnimationClock(now),3);
 return {state:{...s,command:deployed.state,handling,animation,...(s.idleTime===undefined?{}:{idleTime:deployed.state.ownerNextAttack}),action:{activity:183 as const,time:Math.fround(now),generation:(s.action?.generation??0)+1}},events:deployed.events};
}
/** Original default Glock has no ACT_VM_HOLSTER selection. Original native
 * failed lookup does not call SequenceDuration; owner clock becomes now. */
export function sourceGlockRuntimeHolster(s:SourceGlockRuntimeState,now:number){
 active(s);const result=sourceGlockHolster(s.command,{now,sequenceDuration:0});
 return {state:{...s,command:result.state},events:result.events};
}
/** Original Player PostThink weapon-animation phase, AFTER command handling.
 * Busy/buy frames still advance the current VM. The player owns the shared
 * index-0 VM times while other weapons are equipped; never recreate them here.
 * This function cannot fire or start a reload and accepts no renderer events. */
export function sourceGlockRuntimePostThink(s:SourceGlockRuntimeState,context:{now:number;viewmodelTime:{animTime:number;previousAnimTime:number}}){
 active(s);if(!s.animation)throw Error('Original Glock PostThink requires its complete animation state');
 const frame=sourceGlockAnimationFrame({...s.animation,...context.viewmodelTime},context.now);
 let command=s.command;
 for(const event of frame.events)if(event.recordEvent===SOURCE_COMPLETE_RELOAD_EVENT)command=sourcePistolCompleteReload(command,{weapon:'glock',owner:true});
 return {state:{...s,command,animation:frame.state},animationEvents:frame.events};
}
