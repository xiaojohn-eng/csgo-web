import {createSourceAWPCommandState,sourceAWPCommandFrame,sourceAWPDeploy,sourceAWPHolster,sourceAWPAnimationEvent,SOURCE_AWP_RELOAD_SEQUENCE_DURATION,type SourceAWPCommandState,type SourceAWPCommandContext,type SourceAWPCommandEvent} from './source-awp-command.js';
import {sourceAWPAnimationClock as clock,SOURCE_AWP_ACTIVITY_SEQUENCE,SOURCE_AWP_ANIMATION_DATA,type SourceAWPAnimationClock} from './source-awp-animation-clock.js';
import {sourceBaseGunIdleAfterCommand} from './source-basegun-idle.js';
import type {SourceBaseGunCommandEvent} from './source-basegun-command.js';
import {createSourceAWPHandlingState,sourceAWPHandlingTick,sourceAWPHandlingDeploy,sourceAWPHandlingAccepted,sourceAWPHandlingReload,sourceAWPHandlingPrimaryTime,sourceAWPHandlingBullet,type SourceAWPHandlingState} from './source-awp-handling.js';
import type {SourceAccuracyContext} from './source-accuracy.js';
export const SOURCE_AWP_RUNTIME_VERSION='app740-12426148-awp-runtime-v1';
export type SourceAWPAction={activity:183|192|194;time:number;generation:number};
export interface SourceAWPRuntimeState{weapon:'awp';command:SourceAWPCommandState;handling:SourceAWPHandlingState;animation:SourceAWPAnimationClock;idleTime:number;action?:SourceAWPAction}
export type SourceAWPBullet=ReturnType<typeof sourceAWPHandlingBullet>['shot'];
export type SourceAWPRuntimeEvent=Exclude<SourceAWPCommandEvent,{kind:'bullet'}>|(Extract<SourceAWPCommandEvent,{kind:'bullet'}>&{shot?:SourceAWPBullet});
/** Movement owns shared punch decay once before this command. The weapon-tick
 * marker and accepted bullet retain the original mode before automatic unzoom.
 * Authority alone creates ballistic shot data; prediction advances same state.
 */
export type SourceAWPRuntimeInput=Omit<SourceAWPCommandContext,'reloadDuration'|'serverSeed'>&{accuracy:SourceAccuracyContext;execution:{type:'authority';serverSeed:number}|{type:'prediction'}};
function active(s:SourceAWPRuntimeState){if(s.weapon!=='awp')throw Error('AWP runtime weapon identity differs');}
export function createSourceAWPRuntimeState(now=0):SourceAWPRuntimeState{return {weapon:'awp',command:createSourceAWPCommandState(),handling:createSourceAWPHandlingState(),animation:clock.create(now),idleTime:0};}
function applyActivities(s:SourceAWPRuntimeState,events:readonly SourceAWPCommandEvent[],now:number){
 let animation=clock.restore(s.animation),action=s.action;
 for(const event of events)if(event.kind==='activity'){
  const selected=clock.requestActivity(animation,event.activity);animation=selected.state;
  if(selected.applied&&(event.activity===183||event.activity===192||event.activity===194))action={activity:event.activity,time:Math.fround(now),generation:(action?.generation??0)+1};
 }
 return {...s,animation,...(action?{action}:{})};
}
export function sourceAWPRuntimeFrame(s:SourceAWPRuntimeState,input:SourceAWPRuntimeInput){
 active(s);const {accuracy,execution,...context}=input;
 const commandContext={...context,reloadDuration:SOURCE_AWP_RELOAD_SEQUENCE_DURATION,serverSeed:execution.type==='authority'?execution.serverSeed:undefined};
 const command=sourceAWPCommandFrame(s.command,commandContext);
 // The shared idle helper transparently preserves additional FOV events; it only
 // handles activity/bullet timers. Its own source function is identical for AWP.
 const result=sourceBaseGunIdleAfterCommand(s.command,{...command,events:command.events as SourceBaseGunCommandEvent[]},commandContext,s.idleTime,{timeToIdle:2,idleInterval:60,
  duration:activity=>{const sequence=SOURCE_AWP_ACTIVITY_SEQUENCE[activity];return sequence===undefined?undefined:clock.profile(sequence).duration;}});
 let handling=s.handling;const events:SourceAWPRuntimeEvent[]=[];
 for(const event of result.events as SourceAWPCommandEvent[]){
  if(event.kind==='weapon-tick')handling=sourceAWPHandlingTick(handling,event.mode,{...accuracy,reloading:event.reloading},input.now,input.dt);
  else if(event.kind==='bullet'){
   if(event.source!=='primary'||event.mode!==event.accuracyMode||event.mode!==event.recoilMode)throw Error('Invalid original AWP bullet modes');
   if(execution.type==='authority'){
    const bullet=sourceAWPHandlingBullet(handling,event.accuracyMode,accuracy,input.now,{commandSeed:event.commandSeed,serverSeed:execution.serverSeed},event.scheduledTime);
    handling=bullet.state;events.push({...event,shot:bullet.shot});continue;
   }handling=sourceAWPHandlingAccepted(handling,event.recoilMode,input.now,event.commandSeed);
  }else if(event.kind==='activity'&&event.activity===194)handling=sourceAWPHandlingReload(handling);
  // +0xa8c zoom smoothing belongs to the presentation FOV consumer. Neither
  // that event nor a scope mode change clears ballistic penalty at +0xa84.
  events.push(event);
 }
 if(result.dispatch!=='inactive')handling=sourceAWPHandlingPrimaryTime(handling,result.state.lastShot);
 return {state:applyActivities({...s,handling,command:result.state,idleTime:result.idleTime},events,input.now),events,dispatch:result.dispatch,buttonsAfter:result.buttonsAfter};
}

export function sourceAWPRuntimeDeploy(s:SourceAWPRuntimeState,now:number,accuracy:SourceAccuracyContext){
 active(s);const result=sourceAWPDeploy(s.command,{now});
 return {state:applyActivities({...s,handling:sourceAWPHandlingDeploy(s.handling,s.command.mode,accuracy,now),command:result.state,idleTime:result.state.ownerNextAttack},result.events,now),events:result.events};
}
export function sourceAWPRuntimeHolster(s:SourceAWPRuntimeState,now:number){
 active(s);const result=sourceAWPHolster(s.command,{now});return {state:{...s,command:result.state},events:result.events};
}
export type SourceAWPAnimationCue={record:number;name:string;recordEvent:number;type:number;cycle:number;options:string;status:'client-event'|'unregistered-marker'};
/** Raw client-only records keep their exact window and stored order. The named
 * UNZOOM record has no registration/consumer in the original binaries: retaining
 * the marker must not apply a second FOV change. No authority handler is invoked.
 */
export function sourceAWPAnimationCues(before:Readonly<SourceAWPAnimationClock>,after:Readonly<SourceAWPAnimationClock>):SourceAWPAnimationCue[]{
 const previous=clock.restore(before),current=clock.restore(after);
 if(previous.sequence!==current.sequence)throw Error('AWP cue window crosses a sequence reset');
 if(current.playbackRate===0)return [];
 const end=current.finished?Math.fround(1.01):current.cycle;
 return SOURCE_AWP_ANIMATION_DATA[current.sequence].events.filter(event=>
  previous.eventCursor<=event.cycle&&event.cycle<end&&(event.type===1024||Boolean(event.type&16)&&!(event.type&1)||event.recordEvent===5001))
  .map(event=>({...event,status:event.type===1024?'unregistered-marker':'client-event'}));
}
/** Original Player order: command, shared VM anim times, advance, dispatch to the
 * active weapon. Inactive owned weapons must not receive this call as active.
 */
export function sourceAWPRuntimePostThink(s:SourceAWPRuntimeState,context:{now:number;viewmodelTime:{animTime:number;previousAnimTime:number};active?:boolean;owner?:boolean}){
 active(s);
 if(context.active===false||context.owner===false)return {state:s,animationEvents:[],animationCues:[]};
 const before={...s.animation,...context.viewmodelTime},advanced=clock.advance(before,context.now),frame=clock.dispatch(advanced,context.now);
 let command=s.command;for(const event of frame.events)if(event.recordEvent===54)command=sourceAWPAnimationEvent(command,54);
 return {state:{...s,command,animation:frame.state},animationEvents:frame.events,animationCues:sourceAWPAnimationCues(before,advanced)};
}
