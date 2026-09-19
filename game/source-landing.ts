import {SOURCE_RIFLE_HANDLING_VERSION,type SourceRifleHandlingState} from './source-rifle-handling.js';
import {SOURCE_ACCURACY_PROFILES} from './source-accuracy.js';
import {SourceUniformRandomStream} from './source-spread.js';
const f=Math.fround;
export const SOURCE_LANDING_VERSION='csgo-rifle-landing-12426148-r1' as const;
/** Original SharedRandomFloat tag/additional seed. This uses the normal MD5
 * command seed, NOT the server's separate default SHA1 bullet spread seed. */
export function sourceLandingSharedRandom(commandSeed:number){
  if(!Number.isInteger(commandSeed)||commandSeed<0||commandSeed>0x7fffffff)throw Error('Invalid Source landing command seed');
  const tag='LandPunchAngleYaw',bytes=new Uint8Array(8+tag.length);new DataView(bytes.buffer).setUint32(0,commandSeed,true);
  for(let i=0;i<tag.length;i++)bytes[8+i]=tag.charCodeAt(i);
  // The complete 17-byte ASCII tag has no terminating NUL in the CRC stream.
  let crc=0xffffffff;
  const consume=(byte:number)=>{crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);};
  for(const byte of bytes)consume(byte);
  const seed=(crc^0xffffffff)>>>0,value=new SourceUniformRandomStream(seed|0).randomFloat(-1,1);
  return {seed,low:-1,high:1,value};
}
/** Execute once for an accepted ordinary static-world landing. Impact is the
 * stored original m_flFallVelocity (Source units/s), not post-KCC velocity.
 * Only active rifle penalty and player aim angle change. Generic fall damage,
 * stamina, water/moving bases and the separate landing view punch are outside
 * this weapon callback. Zero is legal for direct original callback fixtures. */
export function sourceRifleOnLand(s:SourceRifleHandlingState,fallVelocitySource:number,commandSeed:number):SourceRifleHandlingState{
  const p=SOURCE_ACCURACY_PROFILES[s.activeWeapon];
  if(s.version!==SOURCE_RIFLE_HANDLING_VERSION||!p||!Number.isFinite(fallVelocitySource)||fallVelocitySource<0)throw Error('Invalid Source rifle landing state');
  const accuracy=s.weapons[s.activeWeapon];
  if(!accuracy||![accuracy.penalty,accuracy.recoilIndex,accuracy.lastShotTime,accuracy.lastUpdateTime].every(Number.isFinite)||accuracy.penalty<0||![s.punch.angle,s.punch.velocity,s.punch.viewPunch].every(v=>v.length===3&&v.every(Number.isFinite)))throw Error('Invalid Source rifle landing state');
  const shared=sourceLandingSharedRandom(commandSeed),increment=f(f(fallVelocitySource)*p.land);
  const kick=f(f(Math.asin(Math.max(-1,Math.min(1,increment))))*f(11.459155082702637));
  return {...s,weapons:{...s.weapons,[s.activeWeapon]:{penalty:f(f(accuracy.penalty)+increment),recoilIndex:f(accuracy.recoilIndex),lastShotTime:f(accuracy.lastShotTime),lastUpdateTime:f(accuracy.lastUpdateTime)}},
    punch:{angle:[f(f(s.punch.angle[0])+kick),f(f(s.punch.angle[1])+f(kick*f(shared.value*f(.1)))),f(s.punch.angle[2])],velocity:s.punch.velocity.map(f)as[number,number,number],viewPunch:s.punch.viewPunch.map(f)as[number,number,number]}};
}
/** At native PlayerMove's fall-sample point, before that command's gravity and
 * collision. velocityZSource is the current Source Z-up velocity in units/s.
 * Keep the prior sample if ground categorization already found support. */
export function sourceFallVelocityBeforeMove(previous:number,groundedAtSample:boolean,velocityZSource:number):number{
  if(!Number.isFinite(previous)||!Number.isFinite(velocityZSource)||typeof groundedAtSample!=='boolean')throw Error('Invalid Source fall sample');
  return groundedAtSample?f(previous):f(-f(velocityZSource));
}
/** After movement/categorization, CheckFalling invokes OnLand for positive
 * stored fall velocity and clears it. Negative ascending samples are retained
 * by the original branch; do not manufacture a landing from a grounded tick. */
export function sourceFallVelocityAfterMove(fallVelocitySource:number,groundedAfterMove:boolean){
  if(!Number.isFinite(fallVelocitySource)||typeof groundedAfterMove!=='boolean')throw Error('Invalid Source fall transition');
  const fall=f(fallVelocitySource),landed=groundedAfterMove&&fall>0;
  return {fallVelocitySource:landed?0:fall,landedFallVelocitySource:landed?fall:null};
}
