import type {SourceRecoilEntry} from './source-recoil.js';
const f=Math.fround;
export type SourceAngles=readonly [number,number,number];
/** Original QAngle [pitch,yaw,roll] in degrees; velocity degrees/second.
 * viewPunch is a separate visual-only angle, not part of bullet aim. */
export type SourcePunchState={angle:SourceAngles;velocity:SourceAngles;viewPunch:SourceAngles};
function vec(fn:(i:number)=>number):[number,number,number]{return [fn(0),fn(1),fn(2)];}
function valid(s:SourcePunchState){if(![s.angle,s.velocity,s.viewPunch].every(v=>v.length===3&&v.every(Number.isFinite)))throw Error('Invalid Source punch state');}
export function createSourcePunchState():SourcePunchState{return {angle:[0,0,0],velocity:[0,0,0],viewPunch:[0,0,0]};}
/** Original movement calls view-punch decay 712520 before aim-punch ba6f20.
 * View decay is exp18/linear0; aim decay is exp8/linear18 then trapezoidal
 * velocity integration with exp4.5. View punch never enters the shot basis. */
export function sourcePunchTick(s:SourcePunchState,dt:number):SourcePunchState{
  valid(s);if(!Number.isFinite(dt)||dt<0)throw Error('Invalid Source punch dt');dt=f(dt);
  const linear=f(18*dt),exp=f(Math.exp(f(-f(8*dt)))),decayed=vec(i=>f(f(s.angle[i]!)*exp));
  const length=f(Math.sqrt(f(f(f(decayed[0]*decayed[0])+f(decayed[1]*decayed[1]))+f(decayed[2]*decayed[2]))));
  const scale=length>linear?f(1-f(linear/length)):0,half=f(f(.5)*dt);
  const angle=vec(i=>f(f(decayed[i]!*scale)+f(f(s.velocity[i]!)*half)));
  const velDecay=f(Math.exp(f(-f(4.5)*dt))),velocity=vec(i=>f(f(s.velocity[i]!)*velDecay));
  const viewDecay=f(Math.exp(f(-f(18*dt)))),view=vec(i=>f(f(s.viewPunch[i]!)*viewDecay));
  const viewLength=f(Math.sqrt(f(f(f(view[0]*view[0])+f(view[1]*view[1]))+f(view[2]*view[2]))));
  return {angle:vec(i=>f(angle[i]!+f(velocity[i]!*half))),velocity,viewPunch:viewLength>0?view:[0,0,0]};
}
/** Original c70850, including weapon_recoil_view_punch_extra default .055. */
export function sourcePunchImpulse(s:SourcePunchState,recoil:SourceRecoilEntry):SourcePunchState{
  valid(s);if(!Number.isFinite(recoil.angle)||!Number.isFinite(recoil.magnitude)||recoil.magnitude<0)throw Error('Invalid Source recoil impulse');
  const radians=f(f(.01745329238474369)*f(recoil.angle)),cos=f(Math.cos(radians)),sin=f(Math.sin(radians)),mag=f(recoil.magnitude),extra=f(f(.055)*mag);
  return {angle:vec(i=>f(s.angle[i]!)),velocity:[f(f(s.velocity[0])+f(-cos*mag)),f(f(s.velocity[1])+f(-sin*mag)),f(s.velocity[2])],
    viewPunch:[f(f(s.viewPunch[0])-f(extra*cos)),f(f(s.viewPunch[1])-f(extra*sin)),f(s.viewPunch[2])]};
}
/** weapon_recoil_scale=2, ordinary player. This angle alters shot basis;
 * viewPunch is excluded. Caller maps Source QAngle to its world basis. */
export function sourceShotPunch(s:SourcePunchState):[number,number,number]{valid(s);return vec(i=>f(f(s.angle[i]!)*2));}
