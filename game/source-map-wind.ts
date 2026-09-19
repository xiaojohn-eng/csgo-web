import {createSourceWind,updateSourceWind,restoreSourceWind,DUST2_WIND_PARAMETERS,SOURCE_WIND_MAX_CATCHUP_SECONDS,type SourceWindState} from './source-wind';
import type {SourceTreeState} from './source-prop-foliage';

export type SourceMapWindFrame={epoch:string;levelTime:number;nextThinkTime:number;thinkUpdated:boolean;epochReset:boolean;windSourceXY:[number,number];currentWind:[number,number,number]};
/** One client visual-clock owner per loaded map. A new epoch explicitly means
 * a new level-clock origin, not a server-time jump or a recovered original
 * connection. Existing epoch never changes seed or invents catch-up samples. */
export function createSourceMapWind(setFoliageState:(state:SourceTreeState)=>void){
 let state:SourceWindState|null=null,epoch:string|null=null,lastTime=0,disposed=false;
 const audit={enabled:true,epoch:null as string|null,levelTime:0,nextThinkTime:0,thinkCalls:0,shaderUpdates:0,epochResets:0,
   seed:0,startTime:0,initialDirection:0,initialSpeed:0,clock:'explicit monotonic client level time',
   windInput:'original rendering parameter 3 XY',disposed:false};
 const update=(levelTime:number,nextEpoch:string):SourceMapWindFrame=>{
  if(disposed)throw Error('Source map wind owner disposed');
  const time=Math.fround(levelTime),reset=nextEpoch!==epoch;
  if(typeof nextEpoch!=='string'||!nextEpoch.length||nextEpoch.length>256||!Number.isFinite(levelTime)||levelTime<0||levelTime>1_000_000||
    (!reset&&time<lastTime)||time-(reset?0:state?.simTime??0)>SOURCE_WIND_MAX_CATCHUP_SECONDS)
    throw Error('Invalid Source map wind epoch/time; reset the visual clock or restore explicitly');
  const current=reset?createSourceWind(DUST2_WIND_PARAMETERS,{seed:0,startTime:0,initialDirection:0,initialSpeed:0}):state!;
  const thinkUpdated=time>=current.nextThinkTime;
  if(thinkUpdated)updateSourceWind(current,time);
  const windSourceXY:[number,number]=[current.renderParameter3[0],current.renderParameter3[1]];
  setFoliageState({timeSeconds:time,windSourceXY});
  state=current;epoch=nextEpoch;lastTime=time;
  audit.epoch=epoch;audit.levelTime=time;audit.nextThinkTime=current.nextThinkTime;
  audit.thinkCalls+=Number(thinkUpdated);audit.shaderUpdates++;audit.epochResets+=Number(reset);
  return {epoch,levelTime:time,nextThinkTime:current.nextThinkTime,thinkUpdated,epochReset:reset,windSourceXY,currentWind:[...current.currentWind]};
 };
 return {audit,update,snapshot:()=>({epoch,lastTime,state:state?restoreSourceWind(state):null}),
   dispose:()=>{if(disposed)return;disposed=true;audit.disposed=true;state=null;}};
}
