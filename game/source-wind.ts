/** App740 CEnvWindShared client wind, including rendering parameter 3.
 * Original instruction oracle: scripts/probe-source-wind.py; evidence and
 * clock/call-schedule boundaries: research/source-wind.md. No scene globals.
 * State is JSON data. Mutate only with updateSourceWind, or restore a snapshot.
 */
const f=Math.fround,IM=2147483647,IA=16807,IQ=127773,IR=2836;
type V3=[number,number,number];
export type SourceWindRandomState={idum:number;iy:number;iv:number[]};
export type SourceWindParameters={minWind:number;maxWind:number;minGust:number;maxGust:number;
  minGustDelay:number;maxGustDelay:number;gustDuration:number;gustDirChange:number};
export type SourceWindInitialization={seed:number;startTime:number;initialDirection:number;initialSpeed:number};
export type SourceWindState=SourceWindInitialization&{
  version:1;parameters:SourceWindParameters;direction:number;windSpeed:number;averageSpeed:number;
  gusting:boolean;angleVariation:number;speedVariation:number;variationTime:number;swayTime:number;
  simTime:number;switchTime:number;nextThinkTime:number;currentWind:V3;currentSway:V3;previousSway:V3;renderParameter3:V3;
  averageRandom:SourceWindRandomState;variationRandom:SourceWindRandomState;
};
export type SourceWindEvent={time:number;gusting:boolean;averageSpeed:number;direction:number;switchTime:number};
export type SourceWindFrame={timeSeconds:number;windSourceXY:[number,number];nextThinkTime:number;events:SourceWindEvent[]};
/** Raw Dust2 env_wind hammerid 2568362; angles 0 0 0. Original server Spawn
 * supplies seed 0 and initial speed 0, with its current level time. Caller must
 * still provide the actual time origin explicitly, not wall clock Date.now(). */
export const DUST2_WIND_PARAMETERS:Readonly<SourceWindParameters>=Object.freeze({
  minWind:2,maxWind:4,minGust:3,maxGust:6,minGustDelay:10,maxGustDelay:20,gustDuration:5,gustDirChange:20,
});
/** API work bound, not an original clamp. Oversized calls reject unchanged;
 * replay explicit intermediate calls or restore a later snapshot. Never skip
 * time silently, because that changes which previous wind the sway cache sees. */
export const SOURCE_WIND_MAX_CATCHUP_SECONDS=300;
const MAX_TIME=1_000_000;
function int32(n:number){return Number.isInteger(n)&&n>=-2147483648&&n<=2147483647;}
function timeValid(n:number){return Number.isFinite(n)&&n>=0&&n<=MAX_TIME;}
function validateParameters(p:SourceWindParameters){
  if(!p||![p.minWind,p.maxWind,p.minGust,p.maxGust,p.gustDirChange].every(int32)||
    p.minWind<0||p.maxWind<p.minWind||p.minGust<0||p.maxGust<p.minGust||
    Math.max(p.maxWind,p.maxGust)>10000||p.gustDirChange<0||p.gustDirChange>360||
    ![p.minGustDelay,p.maxGustDelay,p.gustDuration].every(Number.isFinite)||
    p.minGustDelay<.1||p.gustDuration<.1||p.maxGustDelay<0||
    Math.max(p.minGustDelay,p.maxGustDelay,p.gustDuration)>3600)
    throw Error('Invalid bounded Source wind parameters');
}
function newRandom(seed:number):SourceWindRandomState{return {idum:seed>0?-seed:seed,iy:0,iv:Array(32).fill(0)};}
// Independent serializable streams. Constants/order match original vstdlib;
// no global gameplay RNG or Math.random is consumed by presentation wind.
function generate(s:SourceWindRandomState){
  if(s.idum<=0||s.iy===0){
    s.idum=(-s.idum)|0;if(s.idum<1)s.idum=1;
    for(let j=39;j>=0;j--){const k=Math.trunc(s.idum/IQ);s.idum=IA*(s.idum-k*IQ)-IR*k;
      if(s.idum<0)s.idum+=IM;if(j<32)s.iv[j]=s.idum;}
    s.iy=s.iv[0]!;
  }
  const k=Math.trunc(s.idum/IQ);s.idum=IA*(s.idum-k*IQ)-IR*k;if(s.idum<0)s.idum+=IM;
  const j=Math.trunc(s.iy/67108864);s.iy=s.iv[j]!;s.iv[j]=s.idum;return s.iy;
}
function randomFloat(s:SourceWindRandomState,lo:number,hi:number){
  const v=Math.min(f(generate(s)/IM),f(.99999988));return f(f(v*f(f(hi)-f(lo)))+f(lo));
}
function randomInt(s:SourceWindRandomState,lo:number,hi:number){
  const range=hi-lo+1;if(range<=1)return lo;
  const max=IM-(2147483648%range);let value:number;
  do{value=generate(s);}while(value>max);return lo+(value%range);
}
function angleMod(n:number){return Math.trunc(f((Math.trunc(f(f(n)*182.04444885253906))&65535)*.0054931640625));}
function normalizeParameters(p:SourceWindParameters):SourceWindParameters{
  return {...p,minGustDelay:f(p.minGustDelay),maxGustDelay:f(p.maxGustDelay),gustDuration:f(p.gustDuration)};
}
/** Fresh zero-filled entity + original Init. Initial network direction is
 * anglemod-quantized while current direction first retains the passed int. */
export function createSourceWind(parameters:SourceWindParameters,initial:SourceWindInitialization):SourceWindState{
  validateParameters(parameters);
  if(!initial||!int32(initial.seed)||!timeValid(initial.startTime)||!int32(initial.initialDirection)||
    Math.abs(initial.initialDirection)>360000||!Number.isFinite(initial.initialSpeed)||
    initial.initialSpeed<0||initial.initialSpeed>10000)throw Error('Invalid Source wind initialization');
  const startTime=f(initial.startTime),speed=f(initial.initialSpeed);
  return {version:1,parameters:normalizeParameters(parameters),seed:initial.seed,startTime,
    initialDirection:angleMod(initial.initialDirection),initialSpeed:speed,direction:initial.initialDirection,
    windSpeed:speed,averageSpeed:speed,gusting:true,angleVariation:1,speedVariation:1,
    variationTime:startTime,swayTime:0,simTime:startTime,switchTime:startTime,nextThinkTime:0,
    currentWind:[0,0,0],currentSway:[0,0,0],previousSway:[0,0,0],renderParameter3:[0,0,0],
    averageRandom:newRandom(initial.seed),variationRandom:newRandom(initial.seed)};
}
/** One actual original client WindThink call at the caller's level curtime.
 * Do not call repeatedly per material or treat every render frame as a fixed
 * 100 Hz tick. Original return is nextThinkTime=curtime+.01; actual scheduling
 * is frame-quantized by its host. Duplicate timestamps preserve native behavior.
 */
export function updateSourceWind(s:SourceWindState,curtime:number):SourceWindFrame{
  const time=f(curtime);
  if(!timeValid(curtime)||time<s.simTime||time-s.simTime>SOURCE_WIND_MAX_CATCHUP_SECONDS)
    throw Error('Source wind requires monotonic bounded level time; replay or restore after a long gap');
  const p=s.parameters,events:SourceWindEvent[]=[];
  while(time>=s.variationTime){
    s.angleVariation=randomFloat(s.variationRandom,-10,10);
    s.speedVariation=f(1+randomFloat(s.variationRandom,-.2,.2));
    s.variationTime=f(s.variationTime+f(.1));
  }
  // Native repeated two-second loop samples the same old currentWind. Integer
  // two-second times are exact throughout our bounded time domain, allowing
  // an equivalent O(1) catch-up even for an entity created late in a level.
  if(time>=s.swayTime){
    const count=Math.floor((time-s.swayTime)/2)+1;
    s.previousSway=count===1?[...s.currentSway]:[...s.currentWind];
    s.currentSway=[...s.currentWind];s.swayTime=f(s.swayTime+count*2);
  }
  const alpha=f(f(f(time-s.swayTime)*.5)+1);
  for(let i=0;i<3;i++)s.renderParameter3[i]=f(f(s.previousSway[i]!+f(f(s.currentSway[i]!-s.previousSway[i]!)*alpha))*.5);
  for(;;){
    const remaining=f(time-s.simTime),untilSwitch=f(s.switchTime-s.simTime);
    const crossed=remaining>untilSwitch,dt=crossed?untilSwitch:remaining;
    if(s.windSpeed<s.averageSpeed)s.windSpeed=Math.min(s.averageSpeed,f(s.windSpeed+f(dt*150)));
    else if(s.windSpeed>s.averageSpeed)s.windSpeed=Math.max(s.averageSpeed,f(s.windSpeed-f(dt*15)));
    if(!crossed){s.simTime=time;break;}
    s.simTime=s.switchTime;
    if(s.gusting){
      s.averageSpeed=randomInt(s.averageRandom,p.minWind,p.maxWind);s.gusting=false;
      s.switchTime=f(f(s.switchTime+p.minGustDelay)+randomFloat(s.averageRandom,0,p.maxGustDelay));
    }else{
      s.averageSpeed=randomInt(s.averageRandom,p.minGust,p.maxGust);
      s.direction=angleMod(s.direction+randomInt(s.averageRandom,-p.gustDirChange,p.gustDirChange));
      s.gusting=true;s.switchTime=f(s.switchTime+p.gustDuration);
    }
    events.push({time:s.simTime,gusting:s.gusting,averageSpeed:s.averageSpeed,direction:s.direction,switchTime:s.switchTime});
  }
  const yaw=f(f(f(s.direction)+s.angleVariation)*.01745329238474369),speed=f(s.speedVariation*s.windSpeed);
  s.currentWind=[f(f(Math.cos(yaw))*speed),f(f(Math.sin(yaw))*speed),-0];
  s.nextThinkTime=f(time+f(.01));
  return {timeSeconds:time,windSourceXY:[s.renderParameter3[0],s.renderParameter3[1]],nextThinkTime:s.nextThinkTime,events};
}
/** Validate untrusted JSON, detach every array, retain all float32 clocks and
 * both shuffled RNG states. Does not re-seed or reconstruct cache from time. */
export function restoreSourceWind(value:unknown):SourceWindState{
  if(!value||typeof value!=='object')throw Error('Invalid Source wind snapshot');
  const s=value as SourceWindState;validateParameters(s.parameters);
  if([s.parameters.minGustDelay,s.parameters.maxGustDelay,s.parameters.gustDuration].some(n=>n!==f(n)))
    throw Error('Source wind snapshot parameters must retain float32 values');
  const floatFields=[s.startTime,s.initialSpeed,s.windSpeed,s.averageSpeed,s.angleVariation,s.speedVariation,
    s.variationTime,s.swayTime,s.simTime,s.switchTime,s.nextThinkTime];
  if(s.version!==1||!int32(s.seed)||!int32(s.direction)||Math.abs(s.direction)>360000||
    !Number.isInteger(s.initialDirection)||s.initialDirection<0||s.initialDirection>=360||
    typeof s.gusting!=='boolean'||floatFields.some(n=>!Number.isFinite(n)||n!==f(n))||
    !timeValid(s.startTime)||!timeValid(s.simTime)||s.simTime<s.startTime||
    s.variationTime<s.simTime||s.variationTime>s.simTime+.126||s.switchTime<s.simTime||
    (s.nextThinkTime!==0&&s.nextThinkTime!==f(s.simTime+f(.01)))||
    s.switchTime>s.simTime+7200||s.swayTime<0||s.swayTime>MAX_TIME+2||s.swayTime%2!==0||
    [s.initialSpeed,s.windSpeed,s.averageSpeed].some(n=>n<0||n>10000)||
    Math.abs(s.angleVariation)>10||s.speedVariation<.8-1e-7||s.speedVariation>1.2+1e-7)
    throw Error('Invalid Source wind snapshot scalars');
  for(const v of [s.currentWind,s.currentSway,s.previousSway,s.renderParameter3])
    if(!Array.isArray(v)||v.length!==3||v.some(n=>!Number.isFinite(n)||n!==f(n)||Math.abs(n)>12001))
      throw Error('Invalid Source wind snapshot vector');
  for(const r of [s.averageRandom,s.variationRandom]){
    if(!r||!int32(r.idum)||!int32(r.iy)||r.iy<0||r.iy>=IM||!Array.isArray(r.iv)||r.iv.length!==32||
      r.iv.some(n=>!Number.isInteger(n)||n<0||n>=IM)||
      (r.iy>0&&(r.idum<=0||r.idum>=IM||r.iv.some(n=>n===0))))throw Error('Invalid Source wind random snapshot');
  }
  return {...s,parameters:{...s.parameters},currentWind:[...s.currentWind],currentSway:[...s.currentSway],
    previousSway:[...s.previousSway],renderParameter3:[...s.renderParameter3],
    averageRandom:{...s.averageRandom,iv:[...s.averageRandom.iv]},variationRandom:{...s.variationRandom,iv:[...s.variationRandom.iv]}};
}
