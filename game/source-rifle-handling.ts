import {createSourceAccuracyState,sourceAccuracyTick,sourceAccuracyDeploy,sourceAccuracyAfterShot,sourceInaccuracy,SOURCE_ACCURACY_PROFILES,type SourceAccuracyContext,type SourceAccuracyState} from './source-accuracy.js';
import {createSourcePunchState,sourcePunchTick,sourcePunchImpulse,sourceShotPunch,type SourcePunchState} from './source-punch.js';
import {sourceRifleRecoil,type SourceRecoilWeapon} from './source-recoil.js';
import {sourceRifleSpread} from './source-spread.js';
/** Include this identity in the caller's simulation version and snapshots.
 * Ordinary mode0 rifles/default ConVars only. It is not an ammo/fire-timing,
 * reload animation, movement, damage, penetration or first-person owner. */
export const SOURCE_RIFLE_HANDLING_VERSION='csgo-rifle-handling-12426148-r1' as const;
export type SourceRifleHandlingState={version:typeof SOURCE_RIFLE_HANDLING_VERSION;activeWeapon:SourceRecoilWeapon;weapons:Record<SourceRecoilWeapon,SourceAccuracyState>;punch:SourcePunchState};
function valid(s:SourceRifleHandlingState){
  if(s.version!==SOURCE_RIFLE_HANDLING_VERSION||!Object.hasOwn(SOURCE_ACCURACY_PROFILES,s.activeWeapon)||!s.weapons.ak47||!s.weapons.m4a4)throw Error('Source rifle handling version/state mismatch');
}
export function createSourceRifleHandlingState(activeWeapon:SourceRecoilWeapon):SourceRifleHandlingState{
  if(!Object.hasOwn(SOURCE_ACCURACY_PROFILES,activeWeapon))throw Error('Unsupported Source rifle');
  return {version:SOURCE_RIFLE_HANDLING_VERSION,activeWeapon,weapons:{ak47:createSourceAccuracyState(),m4a4:createSourceAccuracyState()},punch:createSourcePunchState()};
}
/** Call once per authoritative command tick. Context is the actual current
 * owner motion/flags. Only the active weapon receives accuracy ticks; the
 * player's punch decays regardless of weapon. Caller owns the clock/cadence. */
export function sourceRifleHandlingTick(s:SourceRifleHandlingState,context:SourceAccuracyContext,time:number,dt:number):SourceRifleHandlingState{
  return sourceRifleHandlingWeaponTick(sourceRifleHandlingMovementTick(s,dt),context,time,dt);
}
/** Movement's punch decay occurs before movement collision/OnLand. */
export function sourceRifleHandlingMovementTick(s:SourceRifleHandlingState,dt:number):SourceRifleHandlingState{
  valid(s);return {...s,punch:sourcePunchTick(s.punch,dt)};
}
/** Weapon PostFrame occurs after movement/OnLand, before accepted firing.
 * Use this and MovementTick instead of Tick when a landing event intervenes. */
export function sourceRifleHandlingWeaponTick(s:SourceRifleHandlingState,context:SourceAccuracyContext,time:number,dt:number):SourceRifleHandlingState{
  valid(s);return {...s,weapons:{...s.weapons,[s.activeWeapon]:sourceAccuracyTick(s.activeWeapon,s.weapons[s.activeWeapon],context,time,dt)}};
}
/** Caller must already have accepted this shot (ammo, cadence, alive, reload).
 * serverSeed is authority-owned int32, never copied from network input. The
 * returned shot record contains the BEFORE state used for this actual bullet. */
export function sourceRifleHandlingShot(s:SourceRifleHandlingState,context:SourceAccuracyContext,time:number,serverSeed:number){
  valid(s);if(!Number.isInteger(serverSeed)||serverSeed< -2147483648||serverSeed>2147483647)throw Error('Invalid authoritative Source server seed');
  const weapon=s.activeWeapon,accuracy=s.weapons[weapon],inaccuracy=sourceInaccuracy(weapon,accuracy,context),spread=SOURCE_ACCURACY_PROFILES[weapon].spread;
  const seedByte=serverSeed&255;
  const shot={weapon,serverSeed,seedByte,inaccuracy,spread,recoilIndex:accuracy.recoilIndex,punchAngles:sourceShotPunch(s.punch),offset:sourceRifleSpread(seedByte,inaccuracy,spread)};
  return {state:sourceRifleHandlingAfterAcceptedShot(s,time),shot};
}
/** Predict only the deterministic state of an already accepted shot. No seed,
 * spread offset, ray or hit is manufactured. Server and prediction call this
 * exactly once at the same acceptance time; sourceRifleHandlingShot includes
 * this call, so the server must not advance it a second time. */
export function sourceRifleHandlingAfterAcceptedShot(s:SourceRifleHandlingState,time:number):SourceRifleHandlingState{
  valid(s);const weapon=s.activeWeapon,accuracy=s.weapons[weapon];
  const recoil=sourceRifleRecoil(weapon,Math.trunc(Math.fround(accuracy.recoilIndex)));
  return {...s,weapons:{...s.weapons,[weapon]:sourceAccuracyAfterShot(weapon,accuracy,time)},punch:sourcePunchImpulse(s.punch,recoil)};
}
/** Invoke at an accepted original deployment boundary, not when a key is
 * merely pressed. Holstered weapons retain their separate state and punch is
 * a player field. Switching to the same weapon does not manufacture a reset. */
export function sourceRifleHandlingSwitch(s:SourceRifleHandlingState,weapon:SourceRecoilWeapon,context:SourceAccuracyContext,time:number):SourceRifleHandlingState{
  valid(s);if(!Object.hasOwn(SOURCE_ACCURACY_PROFILES,weapon))throw Error('Unsupported Source rifle');
  if(weapon===s.activeWeapon)return s;
  return {...s,activeWeapon:weapon,weapons:{...s.weapons,[weapon]:sourceAccuracyDeploy(weapon,s.weapons[weapon],context,time)}};
}
