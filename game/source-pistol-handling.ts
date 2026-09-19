import {SourceUniformRandomStream,sourceRifleSpread} from './source-spread.js';
import {createSourcePunchState,sourcePunchTick,sourcePunchImpulse,sourceShotPunch,type SourcePunchState} from './source-punch.js';
import type {SourceAccuracyContext,SourceAccuracyState} from './source-accuracy.js';
import {sourceLandingSharedRandom} from './source-landing.js';

/** Ordinary Glock single/burst bullets and USP-S numeric modes, App740 defaults.
 * Explicit clocks and distinct command/bullet seeds; no command acceptance,
 * ammo, burst queue, silencer animation, movement or hidden global RNG. */
export const SOURCE_PISTOL_HANDLING_VERSION='csgo-pistol-handling-12426148-r1' as const;
export type SourcePistolWeapon='glock18'|'usp-s';
/** New numeric profiles do not change the frozen Glock/USP snapshot shape. */
export type SourcePistolNumericWeapon=SourcePistolWeapon|'deagle';
export type SourcePistolMode=0|1;
type Profile={speed:number;cycleTime:number;spread:number;crouch:number;stand:number;jump:number;jumpInitial:number;ladder:number;land:number;fire:number;move:number;reload:number;recoveryCrouch:number;recoveryCrouchFinal:number;recoveryStand:number;recoveryStandFinal:number;transitionStart:number;transitionEnd:number;recoilSeed:number;recoilAngle:number;recoilVariance:number;recoilMagnitude:number;recoilMagnitudeVariance:number};
const f=Math.fround,unit=f(.001),ln10=f(2.3025851249694824);
function profile(p:Profile):Readonly<Profile>{
 const out={...p};for(const k of Object.keys(out)as(keyof Profile)[])out[k]=f(out[k]);
 for(const k of ['spread','crouch','stand','jump','jumpInitial','ladder','land','fire','move','reload']as const)out[k]=f(out[k]*unit);
 return Object.freeze(out);
}
const glock={speed:240,cycleTime:.15,jump:87.870003,jumpInitial:96.620003,land:.185,stand:5.6,reload:0,recoveryCrouch:.2,recoveryCrouchFinal:.33,recoveryStand:.2,recoveryStandFinal:.33,transitionStart:0,transitionEnd:5,recoilSeed:4484,recoilAngle:0,recoilVariance:20};
const deagle={speed:230,cycleTime:.225,spread:2,crouch:2.18,stand:4.2,jump:40.549999,jumpInitial:548.820007,ladder:152,land:.043,fire:72.230003,move:48.099998,reload:0,recoveryCrouch:.449927,recoveryCrouchFinal:.449927,recoveryStand:.8112,recoveryStandFinal:.8112,transitionStart:3,transitionEnd:10,recoilSeed:1454,recoilAngle:0,recoilVariance:60,recoilMagnitude:48.200001,recoilMagnitudeVariance:18};
const usp={speed:240,cycleTime:.17,jump:94.480003,jumpInitial:96.599998,crouch:3.68,stand:4.9,move:13.87,reload:0,recoveryCrouch:.291277,recoveryCrouchFinal:.291277,recoveryStand:.349532,recoveryStandFinal:.349532,transitionStart:0,transitionEnd:0,recoilSeed:5426,recoilAngle:0,recoilVariance:0,recoilMagnitudeVariance:0};
/** Original mode0/alt attribute consumers, values already converted to runtime units.
 * Glock mode1's command acceptance and queue scheduling remain separate. */
export const SOURCE_PISTOL_ACCURACY_PROFILES=Object.freeze({
 glock18:Object.freeze([profile({...glock,spread:2,crouch:4.2,fire:56,ladder:137,move:10,recoilMagnitude:18,recoilMagnitudeVariance:0}),profile({...glock,spread:15,crouch:3,fire:45,ladder:119.25,move:12.95,recoilMagnitude:30,recoilMagnitudeVariance:5})]as const),
 deagle:Object.freeze([profile(deagle),profile({...deagle,cycleTime:.3,jump:371.549988,land:.73})]as const),
 'usp-s':Object.freeze([profile({...usp,spread:2.5,fire:71,ladder:138.320007,land:.191,recoilMagnitude:29}),profile({...usp,spread:1.5,fire:52,ladder:119.9,land:.198,recoilMagnitude:23})]as const),
});
function getProfile(weapon:SourcePistolNumericWeapon,mode:SourcePistolMode){
 if(!Object.hasOwn(SOURCE_PISTOL_ACCURACY_PROFILES,weapon)||(mode!==0&&mode!==1))throw Error('Invalid Source pistol/mode');
 return SOURCE_PISTOL_ACCURACY_PROFILES[weapon][mode];
}
function seed(value:number,label:string){if(!Number.isInteger(value)||value< -2147483648||value>2147483647)throw Error('Invalid Source '+label+' seed');}
function clock(time:number,dt=0){if(!Number.isFinite(f(time))||!Number.isFinite(f(dt))||dt<0)throw Error('Invalid Source pistol clock');}
function accuracyInput(weapon:SourcePistolNumericWeapon,mode:SourcePistolMode,s:SourceAccuracyState,c:SourceAccuracyContext){
 const p=getProfile(weapon,mode),velocity=c.velocitySource??[0,0,0];
 if(!s||![s.penalty,s.recoilIndex,s.lastShotTime,s.lastUpdateTime,...velocity].every(x=>Number.isFinite(f(x)))||s.penalty<0||s.recoilIndex<0||s.recoilIndex>=2147483647||typeof c.grounded!=='boolean'||velocity.length!==3)throw Error('Invalid Source pistol accuracy state/context');
 for(const k of ['crouching','walking','ladder','reloading']as const)if(c[k]!==undefined&&typeof c[k]!=='boolean')throw Error('Invalid Source pistol accuracy flag');
 if('exoJump'in c&&c.exoJump)throw Error('ExoJump is outside ordinary pistol handling');
 return p;
}
export function sourcePistolRecoveryTime(weapon:SourcePistolNumericWeapon,mode:SourcePistolMode,s:SourceAccuracyState,c:SourceAccuracyContext){
 const p=accuracyInput(weapon,mode,s,c);
 if(c.ladder)return p.recoveryStand;if(!c.grounded)return f(4*p.recoveryCrouch);
 const base=c.crouching?p.recoveryCrouch:p.recoveryStand,final=c.crouching?p.recoveryCrouchFinal:p.recoveryStandFinal,index=Math.trunc(f(s.recoilIndex));
 if(final===0)return base;
 if(p.transitionStart===p.transitionEnd)return index<p.transitionEnd?base:final;
 const t=Math.max(0,Math.min(1,f(f(index-p.transitionStart)/f(p.transitionEnd-p.transitionStart))));
 return f(base+f(t*f(final-base)));
}
export function sourcePistolAccuracyTick(weapon:SourcePistolNumericWeapon,mode:SourcePistolMode,s:SourceAccuracyState,c:SourceAccuracyContext,time:number,dt:number):SourceAccuracyState{
 const p=accuracyInput(weapon,mode,s,c);clock(time,dt);time=f(time);dt=f(dt);
 let target=c.ladder?f(p.ladder+p.ladder):c.grounded?(c.crouching?p.crouch:p.stand):f(p.stand+p.jump);
 if(c.reloading)target=f(target+p.reload);
 const penalty=target>f(s.penalty)?target:f(target+f(f(Math.exp(f(-f(ln10/sourcePistolRecoveryTime(weapon,mode,s,c))*dt)))*f(f(s.penalty)-target)));
 let recoilIndex=f(s.recoilIndex);
 if(time>f(f(f(s.lastShotTime)+dt)+p.cycleTime))recoilIndex=f(recoilIndex*f(Math.exp(f(-f(2*ln10)*dt))));
 return {penalty,recoilIndex,lastShotTime:f(s.lastShotTime),lastUpdateTime:time};
}
export function sourcePistolInaccuracy(weapon:SourcePistolNumericWeapon,mode:SourcePistolMode,s:SourceAccuracyState,c:SourceAccuracyContext){
 const p=accuracyInput(weapon,mode,s,c),v=(c.velocitySource??[0,0,0]).map(f),lo=f(p.speed*f(.34)),hi=f(p.speed*f(.95));
 const speed=f(Math.sqrt(f(f(v[0]!*v[0]!)+f(v[1]!*v[1]!))));
 let t=Math.max(0,Math.min(1,f(f(speed-lo)/f(hi-lo))));if(!c.walking)t=f(Math.sqrt(f(Math.sqrt(t))));
 let value=f(f(s.penalty)+f(t*p.move));
 if(!c.grounded){
  const upper=f(Math.sqrt(f(301.993377))),lower=f(upper*f(.25));
  // Original d40563 interpolates apex -> initial. Glock/USP apex is zero;
  // Deagle's nonzero original attribute remains significant near jump apex.
  const apex=weapon==='deagle'?f(f(331.549988)*unit):0;
  const air=f(apex+f(f(f(f(Math.sqrt(Math.abs(v[2]!)))-lower)*f(p.jumpInitial-apex))/f(upper-lower)));
  value=f(value+Math.max(0,Math.min(f(p.jumpInitial+p.jumpInitial),air)));
 }
 return Math.min(value,1);
}
export function sourcePistolAccuracyDeploy(weapon:SourcePistolNumericWeapon,mode:SourcePistolMode,s:SourceAccuracyState,c:SourceAccuracyContext,time:number):SourceAccuracyState{
 accuracyInput(weapon,mode,s,c);clock(time);
 const t=Math.min(1,Math.max(0,f(f(f(time)-f(s.lastUpdateTime))/sourcePistolRecoveryTime(weapon,mode,s,c))));
 return {penalty:f(f(s.penalty)-f(t*f(s.penalty))),recoilIndex:0,lastShotTime:f(s.lastShotTime),lastUpdateTime:f(s.lastUpdateTime)};
}
function makeRecoil(p:Readonly<Profile>){
 const rng=new SourceUniformRandomStream(p.recoilSeed);
 return Array.from({length:64},()=>({angle:f(rng.randomFloat(-p.recoilVariance,p.recoilVariance)+p.recoilAngle),magnitude:f(rng.randomFloat(-p.recoilMagnitudeVariance,p.recoilMagnitudeVariance)+p.recoilMagnitude)}));
}
const recoilTables={deagle:SOURCE_PISTOL_ACCURACY_PROFILES.deagle.map(makeRecoil),glock18:SOURCE_PISTOL_ACCURACY_PROFILES.glock18.map(makeRecoil),'usp-s':SOURCE_PISTOL_ACCURACY_PROFILES['usp-s'].map(makeRecoil)};
/** Semi-auto ApplyRecoil uses current normal command prediction seed &63.
 * No full-auto interpolation/suppression. Even zero variance consumes a draw. */
export function sourcePistolRecoil(weapon:SourcePistolNumericWeapon,mode:SourcePistolMode,commandSeed:number){
 getProfile(weapon,mode);seed(commandSeed,'command');return {...recoilTables[weapon][mode]![commandSeed&63]!};
}
/** Normal pistol FX_FireBullets uses the same four-draw radial arithmetic;
 * original item comparisons exclude R8/Negev shaping for Glock and USP. */
export function sourcePistolSpread(weapon:SourcePistolNumericWeapon,mode:SourcePistolMode,serverSeed:number,inaccuracy:number){
 const p=getProfile(weapon,mode);seed(serverSeed,'server bullet');return sourceRifleSpread(serverSeed&255,inaccuracy,p.spread);
}
export type SourcePistolHandlingState={version:typeof SOURCE_PISTOL_HANDLING_VERSION;activeWeapon:SourcePistolWeapon;modes:Record<SourcePistolWeapon,SourcePistolMode>;weapons:Record<SourcePistolWeapon,SourceAccuracyState>;punch:SourcePunchState};
function valid(s:SourcePistolHandlingState){
 if(!s||s.version!==SOURCE_PISTOL_HANDLING_VERSION||!s.modes||!s.weapons)throw Error('Source pistol handling version/state mismatch');
 getProfile(s.activeWeapon,s.modes[s.activeWeapon]);
 for(const w of ['glock18','usp-s']as const)accuracyInput(w,s.modes[w],s.weapons[w],{grounded:true});
 if(!s.punch||![s.punch.angle,s.punch.velocity,s.punch.viewPunch].every(v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(f(x)))))throw Error('Invalid Source pistol punch state');
}
/** Caller supplies current accepted modes. USP mode1 is attached silencer;
 * do not change mode merely because a secondary button was pressed. */
export function createSourcePistolHandlingState(activeWeapon:SourcePistolWeapon,modes:Record<SourcePistolWeapon,SourcePistolMode>):SourcePistolHandlingState{
 const neutral=()=>({penalty:0,recoilIndex:0,lastShotTime:0,lastUpdateTime:0});
 const s:SourcePistolHandlingState={version:SOURCE_PISTOL_HANDLING_VERSION,activeWeapon,modes:{...modes},weapons:{glock18:neutral(),'usp-s':neutral()},punch:createSourcePunchState()};valid(s);return s;
}
export function sourcePistolHandlingMovementTick(s:SourcePistolHandlingState,dt:number):SourcePistolHandlingState{valid(s);return {...s,punch:sourcePunchTick(s.punch,dt)};}
export function sourcePistolHandlingWeaponTick(s:SourcePistolHandlingState,c:SourceAccuracyContext,time:number,dt:number):SourcePistolHandlingState{
 valid(s);const w=s.activeWeapon;return {...s,weapons:{...s.weapons,[w]:sourcePistolAccuracyTick(w,s.modes[w],s.weapons[w],c,time,dt)}};
}
export function sourcePistolHandlingTick(s:SourcePistolHandlingState,c:SourceAccuracyContext,time:number,dt:number){return sourcePistolHandlingWeaponTick(sourcePistolHandlingMovementTick(s,dt),c,time,dt);}
/** Same original active-weapon OnLand callback, current pistol mode attributes.
 * Caller dispatches once after collision from retained Source fall velocity;
 * use MovementTick -> OnLand -> WeaponTick when a landing occurs. */
export function sourcePistolHandlingOnLand(s:SourcePistolHandlingState,fallVelocitySource:number,commandSeed:number):SourcePistolHandlingState{
 valid(s);if(!Number.isFinite(f(fallVelocitySource))||fallVelocitySource<0)throw Error('Invalid Source pistol landing velocity');
 const w=s.activeWeapon,p=getProfile(w,s.modes[w]),before=s.weapons[w],random=sourceLandingSharedRandom(commandSeed);
 const increment=f(f(fallVelocitySource)*p.land),kick=f(f(Math.asin(Math.max(-1,Math.min(1,increment))))*f(11.459155082702637));
 return {...s,weapons:{...s.weapons,[w]:{penalty:f(f(before.penalty)+increment),recoilIndex:f(before.recoilIndex),lastShotTime:f(before.lastShotTime),lastUpdateTime:f(before.lastUpdateTime)}},punch:{
  angle:[f(f(s.punch.angle[0])+kick),f(f(s.punch.angle[1])+f(kick*f(random.value*f(.1)))),f(s.punch.angle[2])],velocity:s.punch.velocity.map(f)as[number,number,number],viewPunch:s.punch.viewPunch.map(f)as[number,number,number]}};
}
export type SourcePistolBulletStateEvent={source:'primary'|'queued';accuracyMode:SourcePistolMode;recoilMode:SourcePistolMode};
export type SourcePistolBulletEvent=SourcePistolBulletStateEvent&{mode:SourcePistolMode;scheduledTime:number};
function bulletEvent(s:SourcePistolHandlingState,e:SourcePistolBulletStateEvent){
 if(!e||!['primary','queued'].includes(e.source))throw Error('Invalid Source pistol accepted bullet source');
 getProfile(s.activeWeapon,e.accuracyMode);getProfile(s.activeWeapon,e.recoilMode);
 if(e.source==='queued'&&(s.activeWeapon!=='glock18'||e.recoilMode!==1))throw Error('Only original Glock queued mode1 recoil is supported');
 if(e.source==='primary'&&e.accuracyMode!==e.recoilMode)throw Error('Original primary modes must agree');
}
/** Deterministic accepted-event state, with normal command seed for recoil.
 * A queued Glock shot reads current accuracyMode even after a mode switch,
 * takes hard mode1 recoil, and DOES NOT write the primary notification time. */
export function sourcePistolHandlingAfterAcceptedBullet(s:SourcePistolHandlingState,time:number,commandSeed:number,event:SourcePistolBulletStateEvent):SourcePistolHandlingState{
 valid(s);clock(time);seed(commandSeed,'command');bulletEvent(s,event);
 const w=s.activeWeapon,before=s.weapons[w],p=getProfile(w,event.accuracyMode);
 return {...s,modes:{...s.modes,[w]:event.accuracyMode},weapons:{...s.weapons,[w]:{penalty:f(f(before.penalty)+p.fire),recoilIndex:f(f(before.recoilIndex)+1),lastShotTime:f(event.source==='primary'?time:before.lastShotTime),lastUpdateTime:f(before.lastUpdateTime)}},punch:sourcePunchImpulse(s.punch,sourcePistolRecoil(w,event.recoilMode,commandSeed))};
}
/** Convenience for a caller-accepted primary shot; never use for queued shots. */
export function sourcePistolHandlingAfterAcceptedShot(s:SourcePistolHandlingState,time:number,commandSeed:number):SourcePistolHandlingState{
 valid(s);const mode=s.modes[s.activeWeapon];return sourcePistolHandlingAfterAcceptedBullet(s,time,commandSeed,{source:'primary',accuracyMode:mode,recoilMode:mode});
}
/** Original successful DefaultReload branch adds one recoil index. It does
 * not imply a shot, penalty increment, recoil impulse or punch reset. */
export function sourcePistolHandlingAfterAcceptedReload(s:SourcePistolHandlingState):SourcePistolHandlingState{
 valid(s);const w=s.activeWeapon;return {...s,weapons:{...s.weapons,[w]:{...s.weapons[w],recoilIndex:f(f(s.weapons[w].recoilIndex)+1)}}};
}
/** Synchronize the original command result's aec timestamp after its events.
 * Primary notification also runs on some dry-fire paths; acceptedShot alone
 * cannot determine this stamp. Queued Glock bullets do not update it. */
export function sourcePistolHandlingPrimaryTime(s:SourcePistolHandlingState,lastShotTime:number):SourcePistolHandlingState{
 valid(s);clock(lastShotTime);const w=s.activeWeapon;return {...s,weapons:{...s.weapons,[w]:{...s.weapons[w],lastShotTime:f(lastShotTime)}}};
}
/** serverSeed is authority-owned SHA1 bullet seed. commandSeed is the normal
 * MD5 prediction seed for this accepted command; the two must not be conflated.
 * Uses BEFORE state, then advances accepted state once. */
export function sourcePistolHandlingBullet(s:SourcePistolHandlingState,c:SourceAccuracyContext,time:number,seeds:{commandSeed:number;serverSeed:number},event:SourcePistolBulletEvent){
 valid(s);bulletEvent(s,event);clock(time);clock(event.scheduledTime);seed(seeds.serverSeed,'server bullet');seed(seeds.commandSeed,'command');
 getProfile(s.activeWeapon,event.mode);
 if((event.source==='queued'&&event.mode!==1)||(event.source==='primary'&&event.mode!==event.accuracyMode))throw Error('Original pistol emitted bullet mode mismatch');
 const weapon=s.activeWeapon,before=s.weapons[weapon],inaccuracy=sourcePistolInaccuracy(weapon,event.accuracyMode,before,c),spread=getProfile(weapon,event.accuracyMode).spread;
 return {shot:{weapon,...event,...seeds,time,seedByte:seeds.serverSeed&255,inaccuracy,spread,recoilIndex:before.recoilIndex,punchAngles:sourceShotPunch(s.punch),offset:sourcePistolSpread(weapon,event.accuracyMode,seeds.serverSeed,inaccuracy)},state:sourcePistolHandlingAfterAcceptedBullet(s,time,seeds.commandSeed,event)};
}
/** Convenience for an ordinary accepted primary; queued callers use Bullet. */
export function sourcePistolHandlingShot(s:SourcePistolHandlingState,c:SourceAccuracyContext,time:number,seeds:{commandSeed:number;serverSeed:number}){
 valid(s);const mode=s.modes[s.activeWeapon];return sourcePistolHandlingBullet(s,c,time,seeds,{source:'primary',mode,accuracyMode:mode,recoilMode:mode,scheduledTime:time});
}
export function sourcePistolHandlingSwitch(s:SourcePistolHandlingState,weapon:SourcePistolWeapon,c:SourceAccuracyContext,time:number):SourcePistolHandlingState{
 valid(s);getProfile(weapon,s.modes[weapon]);if(weapon===s.activeWeapon)return s;
 return {...s,activeWeapon:weapon,weapons:{...s.weapons,[weapon]:sourcePistolAccuracyDeploy(weapon,s.modes[weapon],s.weapons[weapon],c,time)}};
}
/** COMPLETED USP animation event updates effective numeric mode; no accuracy
 * or punch reset. Secondary input and in-progress silencer timing are outside. */
export function sourcePistolHandlingUspMode(s:SourcePistolHandlingState,mode:SourcePistolMode):SourcePistolHandlingState{
 valid(s);getProfile('usp-s',mode);return {...s,modes:{...s.modes,'usp-s':mode}};
}
/** Apply the authoritative command's current active-weapon mode, including
 * mode carried by a weapon-tick marker. Does not reinterpret a raw button. */
export function sourcePistolHandlingMode(s:SourcePistolHandlingState,mode:SourcePistolMode):SourcePistolHandlingState{
 valid(s);getProfile(s.activeWeapon,mode);return {...s,modes:{...s.modes,[s.activeWeapon]:mode}};
}
