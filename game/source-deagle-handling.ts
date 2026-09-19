import {SOURCE_PISTOL_ACCURACY_PROFILES,sourcePistolAccuracyTick,sourcePistolAccuracyDeploy,sourcePistolInaccuracy,sourcePistolRecoil,sourcePistolSpread} from './source-pistol-handling.js';
import {createSourcePunchState,sourcePunchTick,sourcePunchImpulse,sourceShotPunch,type SourcePunchState} from './source-punch.js';
import type {SourceAccuracyContext,SourceAccuracyState} from './source-accuracy.js';
import {sourceLandingSharedRandom} from './source-landing.js';
export const SOURCE_DEAGLE_HANDLING_VERSION='csgo-deagle-handling-12426148-r1';
export type SourceDeagleHandlingState={version:typeof SOURCE_DEAGLE_HANDLING_VERSION;activeWeapon:'deagle';accuracy:SourceAccuracyState;punch:SourcePunchState};
const F=Math.fround,profile=SOURCE_PISTOL_ACCURACY_PROFILES.deagle[0];
function valid(s:SourceDeagleHandlingState){
 if(s.version!==SOURCE_DEAGLE_HANDLING_VERSION||s.activeWeapon!=='deagle')throw Error('Deagle handling identity mismatch');
 sourcePistolInaccuracy('deagle',0,s.accuracy,{grounded:true});
 if(!s.punch||![s.punch.angle,s.punch.velocity,s.punch.viewPunch].every(v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(F(x)))))throw Error('Invalid Deagle punch');
}
export function createSourceDeagleHandlingState():SourceDeagleHandlingState{return {version:SOURCE_DEAGLE_HANDLING_VERSION,activeWeapon:'deagle',accuracy:{penalty:0,recoilIndex:0,lastShotTime:0,lastUpdateTime:0},punch:createSourcePunchState()};}
export function sourceDeagleMovementTick(s:SourceDeagleHandlingState,dt:number):SourceDeagleHandlingState{valid(s);return {...s,punch:sourcePunchTick(s.punch,dt)};}
export function sourceDeagleHandlingTick(s:SourceDeagleHandlingState,c:SourceAccuracyContext,time:number,dt:number):SourceDeagleHandlingState{
 valid(s);return {...s,accuracy:sourcePistolAccuracyTick('deagle',0,s.accuracy,c,time,dt)};
}
export function sourceDeagleHandlingDeploy(s:SourceDeagleHandlingState,c:SourceAccuracyContext,time:number):SourceDeagleHandlingState{
 valid(s);return {...s,accuracy:sourcePistolAccuracyDeploy('deagle',0,s.accuracy,c,time)};
}
export function sourceDeagleHandlingAccepted(s:SourceDeagleHandlingState,time:number,commandSeed:number):SourceDeagleHandlingState{
 valid(s);if(!Number.isFinite(F(time)))throw RangeError('Invalid Deagle shot clock');
 const recoil=sourcePistolRecoil('deagle',0,commandSeed);
 return {...s,accuracy:{...s.accuracy,penalty:F(F(s.accuracy.penalty)+profile.fire),recoilIndex:F(F(s.accuracy.recoilIndex)+1),lastShotTime:F(time)},punch:sourcePunchImpulse(s.punch,recoil)};
}
export function sourceDeagleHandlingReload(s:SourceDeagleHandlingState):SourceDeagleHandlingState{valid(s);return {...s,accuracy:{...s.accuracy,recoilIndex:F(F(s.accuracy.recoilIndex)+1)}};}
export function sourceDeagleHandlingPrimaryTime(s:SourceDeagleHandlingState,time:number):SourceDeagleHandlingState{valid(s);if(!Number.isFinite(F(time)))throw RangeError('Invalid Deagle clock');return {...s,accuracy:{...s.accuracy,lastShotTime:F(time)}};}
export function sourceDeagleHandlingOnLand(s:SourceDeagleHandlingState,fallVelocitySource:number,commandSeed:number):SourceDeagleHandlingState{
 valid(s);if(!Number.isFinite(F(fallVelocitySource))||fallVelocitySource<0)throw RangeError('Invalid Deagle fall velocity');
 const increment=F(F(fallVelocitySource)*profile.land),kick=F(F(Math.asin(Math.max(-1,Math.min(1,increment))))*F(11.459155082702637)),random=sourceLandingSharedRandom(commandSeed);
 return {...s,accuracy:{penalty:F(F(s.accuracy.penalty)+increment),recoilIndex:F(s.accuracy.recoilIndex),lastShotTime:F(s.accuracy.lastShotTime),lastUpdateTime:F(s.accuracy.lastUpdateTime)},punch:{angle:[F(F(s.punch.angle[0])+kick),F(F(s.punch.angle[1])+F(kick*F(random.value*F(.1)))),F(s.punch.angle[2])],velocity:s.punch.velocity.map(F)as[number,number,number],viewPunch:s.punch.viewPunch.map(F)as[number,number,number]}};
}
export function sourceDeagleHandlingBullet(s:SourceDeagleHandlingState,c:SourceAccuracyContext,time:number,seeds:{commandSeed:number;serverSeed:number},scheduledTime:number){
 valid(s);if(!Number.isFinite(F(scheduledTime)))throw RangeError('Invalid Deagle bullet clock');
 const inaccuracy=sourcePistolInaccuracy('deagle',0,s.accuracy,c),offset=sourcePistolSpread('deagle',0,seeds.serverSeed,inaccuracy);
 return {shot:{weapon:'deagle' as const,source:'primary' as const,mode:0 as const,accuracyMode:0 as const,recoilMode:0 as const,scheduledTime,...seeds,time,seedByte:seeds.serverSeed&255,inaccuracy,spread:profile.spread,recoilIndex:s.accuracy.recoilIndex,punchAngles:sourceShotPunch(s.punch),offset},state:sourceDeagleHandlingAccepted(s,time,seeds.commandSeed)};
}
