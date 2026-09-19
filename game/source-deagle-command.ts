import {createSourceBaseGunCommandDriver,type SourceBaseGunCommandState,type SourceBaseGunCommandContext} from './source-basegun-command.js';
import {sourcePistolCompleteReload} from './source-pistol-animation-events.js';

export const SOURCE_DEAGLE_COMMAND_VERSION='app740-12426148-deagle-command-v1';
export const SOURCE_DEAGLE_RELOAD_SEQUENCE_DURATION=Math.fround(66/30);
export const SOURCE_DEAGLE_DRAW_SEQUENCE_DURATION=1;
export interface SourceDeagleCommandState extends SourceBaseGunCommandState{mode:0}
export type SourceDeagleCommandContext=SourceBaseGunCommandContext;
const F=Math.fround;
function time(value:number){if(!Number.isFinite(F(value)))throw RangeError('Invalid Deagle clock');return F(value);}
export function createSourceDeagleCommandState(input:Partial<SourceDeagleCommandState>={}):SourceDeagleCommandState{
 const state:SourceDeagleCommandState={clip:7,reserve:35,nextPrimary:0,nextSecondary:0,ownerNextAttack:0,mode:0,
  shotsFired:0,lastShot:0,dryFireCount:0,reloading:false,fireOnEmpty:false,waitForNoAttack:false,reloadVisComplete:false,...input};
 for(const [key,max]of [['clip',7],['reserve',0x7fffffff],['mode',0],['shotsFired',0x7ffffffe],['dryFireCount',0x7ffffffe]]as const)
  if(!Number.isInteger(state[key])||state[key]<0||state[key]>max)throw RangeError('Invalid Deagle '+key);
 for(const key of ['nextPrimary','nextSecondary','ownerNextAttack','lastShot']as const)state[key]=time(state[key]);
 for(const key of ['reloading','fireOnEmpty','waitForNoAttack','reloadVisComplete']as const)
  if(typeof state[key]!=='boolean')throw TypeError('Invalid Deagle '+key);
 return state;
}
/** Original CDEagle vtable delegates ordinary input to the same base gun.
 * No burst/silencer predicate is set. Secondary still consumes its input gate. */
export const sourceDeagleCommandFrame=createSourceBaseGunCommandDriver<SourceDeagleCommandState>({
 create:createSourceDeagleCommandState,maxClip:7,cycleTime:()=>.225,
 // Original Deagle override d4ffc0 tests the clip BEFORE the bullet decrements it.
 primaryActivity:state=>state.clip===1?195:192,secondary(){}
});
export function sourceDeagleAnimationEvent(input:Readonly<SourceDeagleCommandState>,event:54,owner=true){
 if(event!==54)throw RangeError('Unsupported Deagle authoritative animation event');
 return sourcePistolCompleteReload(createSourceDeagleCommandState(input),{weapon:'deagle',owner});
}
export function sourceDeagleDeploy(input:Readonly<SourceDeagleCommandState>,context:{now:number;owner?:boolean}){
 const state=createSourceDeagleCommandState(input),now=time(context.now);
 if(context.owner===false)return {state,events:[],dispatch:'deploy' as const,buttonsAfter:0};
 state.shotsFired=0;state.waitForNoAttack=true;state.ownerNextAttack=F(now+SOURCE_DEAGLE_DRAW_SEQUENCE_DURATION);
 state.nextPrimary=Math.max(state.nextPrimary,now);state.nextSecondary=Math.max(state.nextSecondary,now);
 return {state,events:[{kind:'activity' as const,activity:183}],dispatch:'deploy' as const,buttonsAfter:0};
}
export function sourceDeagleHolster(input:Readonly<SourceDeagleCommandState>,context:{now:number;owner?:boolean}){
 const state=createSourceDeagleCommandState(input),now=time(context.now);
 if(state.reloading&&!state.reloadVisComplete)state.nextPrimary=state.nextSecondary=now;
 if(context.owner===false)return {state,events:[],dispatch:'holster' as const,buttonsAfter:0};
 state.reloading=false;state.ownerNextAttack=now;
 return {state,events:[{kind:'activity' as const,activity:184}],dispatch:'holster' as const,buttonsAfter:0};
}
