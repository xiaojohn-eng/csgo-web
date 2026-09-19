import {createSourceBaseGunCommandDriver,type SourceBaseGunCommandState,type SourceBaseGunCommandContext,type SourceBaseGunCommandEvent} from './source-basegun-command.js';
import {sourceAWPFov,sourceAWPSetFov,type SourceAWPFovState} from './source-awp-fov.js';
export const SOURCE_AWP_COMMAND_VERSION='app740-12426148-awp-command-v1';
export const SOURCE_AWP_RELOAD_SEQUENCE_DURATION=Math.fround(110/30);
export const SOURCE_AWP_DRAW_SEQUENCE_DURATION=1.25;
export const SOURCE_AWP_CYCLE_TIME=Math.fround(1.455);
export interface SourceAWPCommandState extends SourceBaseGunCommandState,SourceAWPFovState{
 zoomLevel:0|1|2;zoomReadyTime:number;scoped:boolean;resumeZoom:boolean;
}
export type SourceAWPCommandContext=SourceBaseGunCommandContext;
export type SourceAWPCommandEvent=SourceBaseGunCommandEvent|{kind:'fov';target:number;duration:number;startOverride:0}|{kind:'zoom-smoothing-reset';field:'0xa8c';value:0};
const F=Math.fround;
export function createSourceAWPCommandState(input:Partial<SourceAWPCommandState>={}):SourceAWPCommandState{
 const state:SourceAWPCommandState={clip:5,reserve:30,nextPrimary:0,nextSecondary:0,ownerNextAttack:0,mode:0,
  shotsFired:0,lastShot:0,dryFireCount:0,reloading:false,fireOnEmpty:false,waitForNoAttack:false,reloadVisComplete:false,
  zoomLevel:0,zoomReadyTime:0,scoped:false,resumeZoom:false,fovTarget:90,fovStart:90,fovTime:0,fovDuration:0,...input};
 for(const [key,max]of [['clip',5],['reserve',0x7fffffff],['mode',1],['shotsFired',0x7ffffffe],['dryFireCount',0x7ffffffe],['zoomLevel',2],['fovTarget',179],['fovStart',179]]as const)
  if(!Number.isInteger(state[key])||state[key]<0||state[key]>max)throw RangeError('Invalid AWP '+key);
 for(const key of ['nextPrimary','nextSecondary','ownerNextAttack','lastShot','zoomReadyTime','fovTime','fovDuration']as const){
  if(!Number.isFinite(state[key])||!Number.isFinite(F(state[key])))throw RangeError('Invalid AWP '+key);state[key]=F(state[key]);
 }
 if(state.fovDuration<0)throw RangeError('Invalid AWP FOV duration');
 for(const key of ['reloading','fireOnEmpty','waitForNoAttack','reloadVisComplete','scoped','resumeZoom']as const)
  if(typeof state[key]!=='boolean')throw TypeError('Invalid AWP '+key);
 return state;
}
function fov(state:SourceAWPCommandState,events:SourceAWPCommandEvent[],now:number,target:number,duration:number){
 Object.assign(state,sourceAWPSetFov(state,now,target,duration));events.push({kind:'fov',target,duration:F(duration),startOverride:0});
}
/** AWP's own vtable selects these same ordinary base-gun bytes. Only its
 * verified sniper branches are supplied here; the shared driver stays unchanged.
 */
function driver(frameNow:number,resumeEmpty:boolean){return createSourceBaseGunCommandDriver<SourceAWPCommandState>({
 create:createSourceAWPCommandState,maxClip:5,cycleTime:()=>SOURCE_AWP_CYCLE_TIME,
 beforeTick(state,events,_,now){
  if(now>=state.nextPrimary&&state.resumeZoom&&state.zoomLevel>0){
   // The empty-clip/no-auto-reload predicate is supplied in frame below.
   if(state.clip!==0||resumeEmpty){state.mode=1;fov(state,events as SourceAWPCommandEvent[],now,state.zoomLevel===1?40:10,.1);state.zoomReadyTime=F(now+.1);state.scoped=true;}
   state.resumeZoom=false;
  }
 },
 afterBullet(state,events){
  if(state.zoomLevel>0){state.scoped=false;state.resumeZoom=true;fov(state,events as SourceAWPCommandEvent[],frameNow,90,.05);state.mode=0;}
 },
 secondary(state,events,now){
  state.zoomLevel=((state.zoomLevel+1)%3)as 0|1|2;state.mode=state.zoomLevel>0?1:0;
  fov(state,events as SourceAWPCommandEvent[],now,[90,40,10][state.zoomLevel]!,.05);state.scoped=state.zoomLevel>0;
  (events as SourceAWPCommandEvent[]).push({kind:'zoom-smoothing-reset',field:'0xa8c',value:0});
  events.push({kind:'sound',name:'Weapon_AWP.Zoom'});state.zoomReadyTime=F(now+F(.05));
 }
});}
export function sourceAWPCommandFrame(input:Readonly<SourceAWPCommandState>,context:Readonly<SourceAWPCommandContext>){
 const result=driver(F(context.now),Boolean(context.noAutoReload))(input,context),events=result.events as SourceAWPCommandEvent[],state=result.state;
  if(events.some(e=>e.kind==='activity'&&e.activity===194)){
   state.zoomLevel=0;state.mode=0;
   const current=sourceAWPFov(state,context.now);Object.assign(state,current.state);
   if(current.value!==90&&state.scoped){fov(state,events,context.now,90,0);state.scoped=false;}
  }
  return {...result,events};
}
export function sourceAWPAnimationEvent(input:Readonly<SourceAWPCommandState>,event:54,owner=true):SourceAWPCommandState{
 if(event!==54)throw RangeError('Unsupported AWP authoritative animation event');
 const state=createSourceAWPCommandState(input);state.reloadVisComplete=true;
 if(owner){const count=Math.min(5-state.clip,state.reserve);state.clip+=count;state.reserve-=count;}return state;
}
export function sourceAWPDeploy(input:Readonly<SourceAWPCommandState>,context:{now:number;owner?:boolean}){
 const state=createSourceAWPCommandState(input),now=F(context.now),events:SourceAWPCommandEvent[]=[];
 if(!Number.isFinite(now))throw RangeError('Invalid AWP deploy clock');
 if(context.owner===false)return {state,events,dispatch:'deploy' as const,buttonsAfter:0};
 state.shotsFired=0;state.waitForNoAttack=true;state.scoped=false;state.resumeZoom=false;
 fov(state,events,now,0,0);events.push({kind:'activity',activity:183});state.ownerNextAttack=F(now+SOURCE_AWP_DRAW_SEQUENCE_DURATION);
 state.zoomLevel=0;state.mode=0;state.nextPrimary=Math.max(state.nextPrimary,now);state.nextSecondary=Math.max(state.nextSecondary,now);
 return {state,events,dispatch:'deploy' as const,buttonsAfter:0};
}
export function sourceAWPHolster(input:Readonly<SourceAWPCommandState>,context:{now:number;owner?:boolean}){
 const state=createSourceAWPCommandState(input),now=F(context.now),events:SourceAWPCommandEvent[]=[];
 if(!Number.isFinite(now))throw RangeError('Invalid AWP holster clock');state.zoomLevel=0;state.mode=0;
 if(state.reloading&&!state.reloadVisComplete)state.nextPrimary=state.nextSecondary=now;
 if(context.owner===false)return {state,events,dispatch:'holster' as const,buttonsAfter:0};
 fov(state,events,now,0,0);state.reloading=false;state.ownerNextAttack=now;events.push({kind:'activity',activity:184});
 return {state,events,dispatch:'holster' as const,buttonsAfter:0};
}
