import {createSourceBaseGunCommandDriver,type SourceBaseGunCommandState,type SourceBaseGunCommandContext} from './source-basegun-command.js';
import {sourcePistolCompleteReload} from './source-pistol-animation-events.js';

export const SOURCE_USP_COMMAND_VERSION='app740-12426148-usp-command-v1';
export const SOURCE_USP_RELOAD_SEQUENCE_DURATION=Math.fround(65/30);
export const SOURCE_USP_SILENCER_SEQUENCE_DURATION=Math.fround(145/30);
export const SOURCE_USP_DRAW_SEQUENCE_DURATION=1;
export interface SourceUSPCommandState extends SourceBaseGunCommandState{silencerAttached:boolean;silencerSwitchTime:number}
export type SourceUSPCommandContext=SourceBaseGunCommandContext;
const F=Math.fround;

export function createSourceUSPCommandState(input:Partial<SourceUSPCommandState>={}):SourceUSPCommandState{
 const state:SourceUSPCommandState={clip:12,reserve:24,nextPrimary:0,nextSecondary:0,ownerNextAttack:0,mode:1,
  shotsFired:0,lastShot:0,dryFireCount:0,reloading:false,fireOnEmpty:false,waitForNoAttack:false,reloadVisComplete:false,
  silencerAttached:true,silencerSwitchTime:0,...input};
 for(const [key,max]of [['clip',12],['reserve',0x7fffffff],['mode',1],['shotsFired',0x7ffffffe],['dryFireCount',0x7ffffffe]]as const)
  if(!Number.isInteger(state[key])||state[key]<0||state[key]>max)throw RangeError('Invalid USP '+key);
 for(const key of ['nextPrimary','nextSecondary','ownerNextAttack','lastShot','silencerSwitchTime']as const){
  if(!Number.isFinite(state[key])||!Number.isFinite(F(state[key])))throw RangeError('Invalid USP '+key);state[key]=F(state[key]);
 }
 for(const key of ['reloading','fireOnEmpty','waitForNoAttack','reloadVisComplete','silencerAttached']as const)
  if(typeof state[key]!=='boolean')throw TypeError('Invalid USP '+key);
 return state;
}

/** The ordinary base gun handles input priority, ammo, gates and semi-auto
 * latch. Only verified USP differences belong in this profile. */
export const sourceUSPCommandFrame=createSourceBaseGunCommandDriver<SourceUSPCommandState>({
 create:createSourceUSPCommandState,maxClip:12,cycleTime:()=>.17,
 afterBullet(state,events){if(state.silencerAttached)events.push({kind:'activity',activity:477});},
 secondary(state,events,now){
  if(now<state.silencerSwitchTime)return;
  events.push({kind:'activity',activity:state.silencerAttached?221:220});
  events.push({kind:'player-animation-event',id:state.silencerAttached?16:15});
  state.silencerSwitchTime=state.nextPrimary=F(now+SOURCE_USP_SILENCER_SEQUENCE_DURATION);
  // Neither attachment state nor owner attack clock changes here. The actual
  // original animation event commits it; the outer command writes secondary+.3.
 }
});

export function sourceUSPAnimationEvent(input:Readonly<SourceUSPCommandState>,event:44|46|54,owner=true):SourceUSPCommandState{
 const state=createSourceUSPCommandState(input);
 if(event===54)return sourcePistolCompleteReload(state,{weapon:'usp-s',owner});
 if(event!==44&&event!==46)throw RangeError('Unsupported USP authoritative animation event');
 state.silencerAttached=event===44;state.mode=event===44?1:0;
 return state;
}

export function sourceUSPDeploy(input:Readonly<SourceUSPCommandState>,context:{now:number;owner?:boolean}){
 const state=createSourceUSPCommandState(input),now=F(context.now);
 if(!Number.isFinite(now))throw RangeError('Invalid USP deploy clock');
 state.silencerSwitchTime=0;
 if(context.owner===false)return {state,events:[],dispatch:'deploy' as const,buttonsAfter:0};
 state.shotsFired=0;state.waitForNoAttack=true;state.ownerNextAttack=F(now+SOURCE_USP_DRAW_SEQUENCE_DURATION);
 state.nextPrimary=Math.max(state.nextPrimary,now);state.nextSecondary=Math.max(state.nextSecondary,now);
 return {state,events:[{kind:'activity' as const,activity:state.silencerAttached?481:183}],dispatch:'deploy' as const,buttonsAfter:0};
}

/** Holster cancels only a pending attachment transition that has not committed
 * its original event. A completed transition keeps its saved attachment state. */
export function sourceUSPHolster(input:Readonly<SourceUSPCommandState>,context:{now:number;activity:number;owner?:boolean}){
 const state=createSourceUSPCommandState(input),now=F(context.now);
 if(!Number.isFinite(now)||!Number.isInteger(context.activity))throw RangeError('Invalid USP holster context');
 if(context.activity===220&&!state.silencerAttached||context.activity===221&&state.silencerAttached)
  state.silencerSwitchTime=state.nextPrimary=state.nextSecondary=now;
 if(state.reloading&&!state.reloadVisComplete)state.nextPrimary=state.nextSecondary=now;
 if(context.owner===false)return {state,events:[],dispatch:'holster' as const,buttonsAfter:0};
 state.reloading=false;state.ownerNextAttack=now;
 return {state,events:[{kind:'activity' as const,activity:184}],dispatch:'holster' as const,buttonsAfter:0};
}
