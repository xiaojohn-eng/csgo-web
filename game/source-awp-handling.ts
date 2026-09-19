import {SOURCE_AWP_ACCURACY_PROFILES,sourceAWPAccuracyTick,sourceAWPAccuracyDeploy,sourceAWPInaccuracy,sourceAWPRecoil,sourceAWPSpread,type SourceAWPMode} from './source-awp-accuracy.js';
import {createSourcePunchState,sourcePunchTick,sourcePunchImpulse,sourceShotPunch,type SourcePunchState} from './source-punch.js';
import type {SourceAccuracyContext,SourceAccuracyState} from './source-accuracy.js';
import {sourceLandingSharedRandom} from './source-landing.js';
export const SOURCE_AWP_HANDLING_VERSION='csgo-awp-handling-12426148-r1';
export type SourceAWPHandlingState={version:typeof SOURCE_AWP_HANDLING_VERSION;activeWeapon:'awp';accuracy:SourceAccuracyState;punch:SourcePunchState};
const F=Math.fround;
function valid(s:SourceAWPHandlingState){
 if(s.version!==SOURCE_AWP_HANDLING_VERSION||s.activeWeapon!=='awp')throw Error('AWP handling identity mismatch');
 sourceAWPInaccuracy(0,s.accuracy,{grounded:true});
 if(!s.punch||![s.punch.angle,s.punch.velocity,s.punch.viewPunch].every(v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(F(x)))))throw Error('Invalid AWP punch');
}
export function createSourceAWPHandlingState():SourceAWPHandlingState{return {version:SOURCE_AWP_HANDLING_VERSION,activeWeapon:'awp',accuracy:{penalty:0,recoilIndex:0,lastShotTime:0,lastUpdateTime:0},punch:createSourcePunchState()};}
export function sourceAWPMovementTick(s:SourceAWPHandlingState,dt:number):SourceAWPHandlingState{valid(s);return {...s,punch:sourcePunchTick(s.punch,dt)};}
export function sourceAWPHandlingTick(s:SourceAWPHandlingState,mode:SourceAWPMode,c:SourceAccuracyContext,time:number,dt:number):SourceAWPHandlingState{
 valid(s);return {...s,accuracy:sourceAWPAccuracyTick(mode,s.accuracy,c,time,dt)};
}
export function sourceAWPHandlingDeploy(s:SourceAWPHandlingState,mode:SourceAWPMode,c:SourceAccuracyContext,time:number):SourceAWPHandlingState{
 valid(s);return {...s,accuracy:sourceAWPAccuracyDeploy(mode,s.accuracy,c,time)};
}
export function sourceAWPHandlingAccepted(s:SourceAWPHandlingState,mode:SourceAWPMode,time:number,commandSeed:number):SourceAWPHandlingState{
 valid(s);if(!Number.isFinite(F(time)))throw RangeError('Invalid AWP shot clock');
 const recoil=sourceAWPRecoil(mode,commandSeed);
 return {...s,accuracy:{...s.accuracy,penalty:F(F(s.accuracy.penalty)+SOURCE_AWP_ACCURACY_PROFILES[mode].fire),recoilIndex:F(F(s.accuracy.recoilIndex)+1),lastShotTime:F(time)},punch:sourcePunchImpulse(s.punch,recoil)};
}
export function sourceAWPHandlingReload(s:SourceAWPHandlingState):SourceAWPHandlingState{valid(s);return {...s,accuracy:{...s.accuracy,recoilIndex:F(F(s.accuracy.recoilIndex)+1)}};}
export function sourceAWPHandlingPrimaryTime(s:SourceAWPHandlingState,time:number):SourceAWPHandlingState{valid(s);if(!Number.isFinite(F(time)))throw RangeError('Invalid AWP clock');return {...s,accuracy:{...s.accuracy,lastShotTime:F(time)}};}
export function sourceAWPHandlingOnLand(s:SourceAWPHandlingState,mode:SourceAWPMode,fallVelocitySource:number,commandSeed:number):SourceAWPHandlingState{
 valid(s);if((mode!==0&&mode!==1)||!Number.isFinite(F(fallVelocitySource))||fallVelocitySource<0)throw RangeError('Invalid AWP fall velocity');
 const increment=F(F(fallVelocitySource)*SOURCE_AWP_ACCURACY_PROFILES[mode].land),kick=F(F(Math.asin(Math.max(-1,Math.min(1,increment))))*F(11.459155082702637)),random=sourceLandingSharedRandom(commandSeed);
 return {...s,accuracy:{penalty:F(F(s.accuracy.penalty)+increment),recoilIndex:F(s.accuracy.recoilIndex),lastShotTime:F(s.accuracy.lastShotTime),lastUpdateTime:F(s.accuracy.lastUpdateTime)},punch:{angle:[F(F(s.punch.angle[0])+kick),F(F(s.punch.angle[1])+F(kick*F(random.value*F(.1)))),F(s.punch.angle[2])],velocity:s.punch.velocity.map(F)as[number,number,number],viewPunch:s.punch.viewPunch.map(F)as[number,number,number]}};
}
export function sourceAWPHandlingBullet(s:SourceAWPHandlingState,mode:SourceAWPMode,c:SourceAccuracyContext,time:number,seeds:{commandSeed:number;serverSeed:number},scheduledTime:number){
 valid(s);if(!Number.isFinite(F(scheduledTime)))throw RangeError('Invalid AWP bullet clock');
 const inaccuracy=sourceAWPInaccuracy(mode,s.accuracy,c),offset=sourceAWPSpread(mode,seeds.serverSeed,inaccuracy);
 return {shot:{weapon:'awp' as const,source:'primary' as const,mode,accuracyMode:mode,recoilMode:mode,scheduledTime,...seeds,time,seedByte:seeds.serverSeed&255,inaccuracy,spread:SOURCE_AWP_ACCURACY_PROFILES[mode].spread,recoilIndex:s.accuracy.recoilIndex,punchAngles:sourceShotPunch(s.punch),offset},state:sourceAWPHandlingAccepted(s,mode,time,seeds.commandSeed)};
}
