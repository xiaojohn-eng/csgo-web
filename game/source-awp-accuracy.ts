import {SourceUniformRandomStream,sourceRifleSpread} from './source-spread.js';
import type {SourceAccuracyContext,SourceAccuracyState} from './source-accuracy.js';
export const SOURCE_AWP_ACCURACY_VERSION='app740-12426148-awp-accuracy-v1';
export type SourceAWPMode=0|1;
type Profile={speed:number;cycleTime:number;spread:number;crouch:number;stand:number;jump:number;jumpInitial:number;ladder:number;land:number;fire:number;move:number;reload:number;recoveryCrouch:number;recoveryCrouchFinal:number;recoveryStand:number;recoveryStandFinal:number;transitionStart:number;transitionEnd:number;recoilSeed:number;recoilAngle:number;recoilVariance:number;recoilMagnitude:number;recoilMagnitudeVariance:number};
const f=Math.fround,unit=f(.001),ln10=f(2.3025851249694824);
function profile(p:Profile):Readonly<Profile>{
 const out={...p};for(const k of Object.keys(out)as(keyof Profile)[])out[k]=f(out[k]);
 for(const k of ['spread','crouch','stand','jump','jumpInitial','ladder','land','fire','move','reload']as const)out[k]=f(out[k]*unit);
 return Object.freeze(out);
}
const awp={cycleTime:1.455,spread:.2,jump:133.830002,jumpInitial:172.860001,ladder:136.5,fire:53.849998,move:176.479996,reload:0,recoveryCrouch:.246710,recoveryCrouchFinal:.246710,recoveryStand:.345390,recoveryStandFinal:.345390,transitionStart:2,transitionEnd:5,recoilSeed:4100,recoilAngle:0,recoilVariance:20};
/** Independently resolved original AWP mode0/1 runtime attributes. Original
 * GetCycleTime for accuracy decay reads the base 1.455 even in scoped mode. */
export const SOURCE_AWP_ACCURACY_PROFILES=Object.freeze([
 profile({...awp,speed:200,crouch:60.599998,stand:80.800003,land:.307,recoilMagnitude:78,recoilMagnitudeVariance:15}),
 profile({...awp,speed:100,crouch:1.5,stand:2,land:.1,recoilMagnitude:25,recoilMagnitudeVariance:2}),
]as const);
function getProfile(mode:SourceAWPMode){
 if(mode!==0&&mode!==1)throw Error('Invalid Source AWP/mode');
 return SOURCE_AWP_ACCURACY_PROFILES[mode];
}
function seed(value:number,label:string){if(!Number.isInteger(value)||value< -2147483648||value>2147483647)throw Error('Invalid Source '+label+' seed');}
function clock(time:number,dt=0){if(!Number.isFinite(f(time))||!Number.isFinite(f(dt))||dt<0)throw Error('Invalid Source AWP clock');}
function accuracyInput(mode:SourceAWPMode,s:SourceAccuracyState,c:SourceAccuracyContext){
 const p=getProfile(mode),velocity=c.velocitySource??[0,0,0];
 if(!s||![s.penalty,s.recoilIndex,s.lastShotTime,s.lastUpdateTime,...velocity].every(x=>Number.isFinite(f(x)))||s.penalty<0||s.recoilIndex<0||s.recoilIndex>=2147483647||typeof c.grounded!=='boolean'||velocity.length!==3)throw Error('Invalid Source AWP accuracy state/context');
 for(const k of ['crouching','walking','ladder','reloading']as const)if(c[k]!==undefined&&typeof c[k]!=='boolean')throw Error('Invalid Source AWP accuracy flag');
 if('exoJump'in c&&c.exoJump)throw Error('ExoJump is outside ordinary AWP handling');
 return p;
}
export function sourceAWPRecoveryTime(mode:SourceAWPMode,s:SourceAccuracyState,c:SourceAccuracyContext){
 const p=accuracyInput(mode,s,c);
 if(c.ladder)return p.recoveryStand;if(!c.grounded)return f(4*p.recoveryCrouch);
 const base=c.crouching?p.recoveryCrouch:p.recoveryStand,final=c.crouching?p.recoveryCrouchFinal:p.recoveryStandFinal,index=Math.trunc(f(s.recoilIndex));
 if(final===0)return base;
 if(p.transitionStart===p.transitionEnd)return index<p.transitionEnd?base:final;
 const t=Math.max(0,Math.min(1,f(f(index-p.transitionStart)/f(p.transitionEnd-p.transitionStart))));
 return f(base+f(t*f(final-base)));
}
export function sourceAWPAccuracyTick(mode:SourceAWPMode,s:SourceAccuracyState,c:SourceAccuracyContext,time:number,dt:number):SourceAccuracyState{
 const p=accuracyInput(mode,s,c);clock(time,dt);time=f(time);dt=f(dt);
 let target=c.ladder?f(p.ladder+p.ladder):c.grounded?(c.crouching?p.crouch:p.stand):f(p.stand+p.jump);
 if(c.reloading)target=f(target+p.reload);
 const penalty=target>f(s.penalty)?target:f(target+f(f(Math.exp(f(-f(ln10/sourceAWPRecoveryTime(mode,s,c))*dt)))*f(f(s.penalty)-target)));
 let recoilIndex=f(s.recoilIndex);
 if(time>f(f(f(s.lastShotTime)+dt)+p.cycleTime))recoilIndex=f(recoilIndex*f(Math.exp(f(-f(2*ln10)*dt))));
 return {penalty,recoilIndex,lastShotTime:f(s.lastShotTime),lastUpdateTime:time};
}
export function sourceAWPInaccuracy(mode:SourceAWPMode,s:SourceAccuracyState,c:SourceAccuracyContext){
 const p=accuracyInput(mode,s,c),v=(c.velocitySource??[0,0,0]).map(f),lo=f(p.speed*f(.34)),hi=f(p.speed*f(.95));
 const speed=f(Math.sqrt(f(f(v[0]!*v[0]!)+f(v[1]!*v[1]!))));
 let t=Math.max(0,Math.min(1,f(f(speed-lo)/f(hi-lo))));if(!c.walking)t=f(Math.sqrt(f(Math.sqrt(t))));
 let value=f(f(s.penalty)+f(t*p.move));
 if(!c.grounded){
  const upper=f(Math.sqrt(f(301.993377))),lower=f(upper*f(.25));
  // Original AWP inaccuracy jump apex attribute is zero.
  const apex=0;
  const air=f(apex+f(f(f(f(Math.sqrt(Math.abs(v[2]!)))-lower)*f(p.jumpInitial-apex))/f(upper-lower)));
  value=f(value+Math.max(0,Math.min(f(p.jumpInitial+p.jumpInitial),air)));
 }
 return Math.min(value,1);
}
export function sourceAWPAccuracyDeploy(mode:SourceAWPMode,s:SourceAccuracyState,c:SourceAccuracyContext,time:number):SourceAccuracyState{
 accuracyInput(mode,s,c);clock(time);
 const t=Math.min(1,Math.max(0,f(f(f(time)-f(s.lastUpdateTime))/sourceAWPRecoveryTime(mode,s,c))));
 return {penalty:f(f(s.penalty)-f(t*f(s.penalty))),recoilIndex:0,lastShotTime:f(s.lastShotTime),lastUpdateTime:f(s.lastUpdateTime)};
}
function makeRecoil(p:Readonly<Profile>){
 const rng=new SourceUniformRandomStream(p.recoilSeed);
 return Array.from({length:64},()=>({angle:f(rng.randomFloat(-p.recoilVariance,p.recoilVariance)+p.recoilAngle),magnitude:f(rng.randomFloat(-p.recoilMagnitudeVariance,p.recoilMagnitudeVariance)+p.recoilMagnitude)}));
}
const recoilTables=SOURCE_AWP_ACCURACY_PROFILES.map(makeRecoil);
/** Semi-auto ApplyRecoil uses current normal command prediction seed &63.
 * No full-auto interpolation/suppression. Even zero variance consumes a draw. */
export function sourceAWPRecoil(mode:SourceAWPMode,commandSeed:number){
 getProfile(mode);seed(commandSeed,'command');return {...recoilTables[mode]![commandSeed&63]!};
}
/** Original AWP FX_FireBullets uses four-draw radial arithmetic;
 * native item comparisons exclude R8/Negev shaping for original item 9. */
export function sourceAWPSpread(mode:SourceAWPMode,serverSeed:number,inaccuracy:number){
 const p=getProfile(mode);seed(serverSeed,'server bullet');return sourceRifleSpread(serverSeed&255,inaccuracy,p.spread);
}
