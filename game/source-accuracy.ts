import type {SourceRecoilWeapon} from './source-recoil.js';
const f=Math.fround,ln10=f(2.3025851249694824),unit=f(.001);
/** Original ordinary mode0 AK/M4A4, default ConVars, App740 build12426148.
 * Every velocity component is in original Source units/second, Z is up.
 * ExoJump, custom turning inaccuracy and alternate modes are not this contract. */
export type SourceAccuracyContext={grounded:boolean;crouching?:boolean;walking?:boolean;ladder?:boolean;reloading?:boolean;velocitySource?:readonly [number,number,number]};
export type SourceAccuracyState={penalty:number;recoilIndex:number;lastShotTime:number;lastUpdateTime:number};
type Profile={speed:number;cycleTime:number;spread:number;crouch:number;stand:number;jump:number;jumpInitial:number;ladder:number;land:number;fire:number;move:number;recoveryCrouch:number;recoveryCrouchFinal:number;recoveryStand:number;recoveryStandFinal:number};
function profile(p:Profile):Readonly<Profile>{
  const result={...p};for(const key of Object.keys(result)as(keyof Profile)[])result[key]=f(result[key]);
  for(const key of ['spread','crouch','stand','jump','jumpInitial','ladder','land','fire','move']as const)result[key]=f(result[key]*unit);
  return Object.freeze(result);
}
export const SOURCE_ACCURACY_PROFILES=Object.freeze({
  ak47:profile({speed:215,cycleTime:.1,spread:.6,crouch:4.81,stand:6.41,jump:140.759995,jumpInitial:100.940002,ladder:140,land:.242,fire:7.8,move:175.059998,recoveryCrouch:.305257,recoveryCrouchFinal:.419728,recoveryStand:.368,recoveryStandFinal:.506}),
  m4a4:profile({speed:225,cycleTime:.09,spread:.6,crouch:4.1,stand:4.9,jump:97.269997,jumpInitial:94.410004,ladder:110.994003,land:.192,fire:7,move:137.880005,recoveryCrouch:.2421,recoveryCrouchFinal:.332888,recoveryStand:.338941,recoveryStandFinal:.466044}),
});
function valid(weapon:SourceRecoilWeapon,s:SourceAccuracyState,c:SourceAccuracyContext){
  if(!Object.hasOwn(SOURCE_ACCURACY_PROFILES,weapon)||![s.penalty,s.recoilIndex,s.lastShotTime,s.lastUpdateTime,...(c.velocitySource??[0,0,0])].every(Number.isFinite)||s.penalty<0||s.recoilIndex<0||s.recoilIndex>=2147483647||typeof c.grounded!=='boolean')throw Error('Invalid Source accuracy input');
  if('exoJump'in c&&c.exoJump)throw Error('ExoJump is outside ordinary Source rifle accuracy contract');
  return SOURCE_ACCURACY_PROFILES[weapon];
}
function timeInput(time:number,dt=0){if(!Number.isFinite(time)||!Number.isFinite(dt)||dt<0)throw Error('Invalid Source accuracy clock');}
/** New weapon state. Deployment and the first tick are separate original operations. */
export function createSourceAccuracyState():SourceAccuracyState{return {penalty:0,recoilIndex:0,lastShotTime:0,lastUpdateTime:0};}
export function sourceRecoveryTime(weapon:SourceRecoilWeapon,s:SourceAccuracyState,c:SourceAccuracyContext):number{
  const p=valid(weapon,s,c);
  if(c.ladder)return p.recoveryStand;
  if(!c.grounded)return f(4*p.recoveryCrouch);
  const base=c.crouching?p.recoveryCrouch:p.recoveryStand,final=c.crouching?p.recoveryCrouchFinal:p.recoveryStandFinal;
  const t=Math.max(0,Math.min(1,f(f(Math.trunc(f(s.recoilIndex))-2)/3)));
  return f(base+f(t*f(final-base)));
}
export function sourceAccuracyTick(weapon:SourceRecoilWeapon,s:SourceAccuracyState,c:SourceAccuracyContext,time:number,dt:number):SourceAccuracyState{
  const p=valid(weapon,s,c);timeInput(time,dt);time=f(time);dt=f(dt);
  const target=c.ladder?f(p.ladder+p.ladder):c.grounded?(c.crouching?p.crouch:p.stand):f(p.stand+p.jump);
  // Both original rifles have reload penalty 0. No recoil reset on reload.
  const penalty=target>f(s.penalty)?target:f(target+f(f(Math.exp(f(-f(ln10/sourceRecoveryTime(weapon,s,c))*dt)))*f(f(s.penalty)-target)));
  let recoilIndex=f(s.recoilIndex);
  if(time>f(f(f(s.lastShotTime)+dt)+p.cycleTime))recoilIndex=f(recoilIndex*f(Math.exp(f(-f(2*ln10)*dt))));
  return {penalty,recoilIndex,lastShotTime:f(s.lastShotTime),lastUpdateTime:time};
}
export function sourceInaccuracy(weapon:SourceRecoilWeapon,s:SourceAccuracyState,c:SourceAccuracyContext):number{
  const p=valid(weapon,s,c),v=(c.velocitySource??[0,0,0]).map(f),lo=f(p.speed*f(.34)),hi=f(p.speed*f(.95));
  const speed=f(Math.sqrt(f(f(v[0]!*v[0]!)+f(v[1]!*v[1]!))));
  let t=Math.max(0,Math.min(1,f(f(speed-lo)/f(hi-lo))));
  if(!c.walking)t=f(Math.sqrt(f(Math.sqrt(t))));
  let value=f(f(s.penalty)+f(t*p.move));
  if(!c.grounded){
    const upper=f(Math.sqrt(f(301.993377))),lower=f(upper*f(.25));
    // Both original profiles have jump-apex 0. Multiply before divide as SSE.
    const air=f(f(f(f(Math.sqrt(Math.abs(v[2]!)))-lower)*p.jumpInitial)/f(upper-lower));
    value=f(value+Math.max(0,Math.min(f(p.jumpInitial+p.jumpInitial),air)));
  }
  return Math.min(value,1);
}
/** Invoke only after an accepted ordinary bullet used the BEFORE state. */
export function sourceAccuracyAfterShot(weapon:SourceRecoilWeapon,s:SourceAccuracyState,time:number):SourceAccuracyState{
  const p=valid(weapon,s,{grounded:true});timeInput(time);
  return {penalty:f(f(s.penalty)+p.fire),recoilIndex:f(f(s.recoilIndex)+1),lastShotTime:f(time),lastUpdateTime:f(s.lastUpdateTime)};
}
/** Default weapon_accuracy_reset_on_deploy=0: holstered recovery is linear,
 * then recoilIndex resets. Player punch belongs to the player and is retained. */
export function sourceAccuracyDeploy(weapon:SourceRecoilWeapon,s:SourceAccuracyState,c:SourceAccuracyContext,time:number):SourceAccuracyState{
  valid(weapon,s,c);timeInput(time);
  const t=Math.min(1,Math.max(0,f(f(f(time)-f(s.lastUpdateTime))/sourceRecoveryTime(weapon,s,c))));
  return {penalty:f(f(s.penalty)-f(t*f(s.penalty))),recoilIndex:0,lastShotTime:f(s.lastShotTime),lastUpdateTime:f(s.lastUpdateTime)};
}
