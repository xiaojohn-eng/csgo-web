import type {SourceAngles,SourcePunchState} from './source-punch.js';
const f=Math.fround,deg=180/Math.PI,rad=f(Math.PI/180);
export type SourceBrowserBasis={forward:[number,number,number];right:[number,number,number];up:[number,number,number]};
/** Current browser convention: forward=(-sin(yaw)*cos(pitch),sin(pitch),
 * -cos(yaw)*cos(pitch)), angles in radians. Source QAngle is degrees, +pitch
 * looks down, +yaw rotates Source +X toward +Y. Punch must already be the
 * original sourceShotPunch (aim angle *2), not the separate viewPunch. */
export function sourceBrowserShotBasis(yaw:number,pitch:number,punch:SourceAngles):SourceBrowserBasis{
  if(![yaw,pitch,...punch].every(Number.isFinite)||punch.length!==3)throw Error('Invalid Source aim bridge input');
  return sourceAngleBasis([f(f(-pitch*deg)+f(punch[0])),f(f((yaw+Math.PI/2)*deg)+f(punch[1])),f(punch[2])]);
}
/** Original normal first-person camera: base + viewPunch + scaledAim*.45.
 * Defaults weapon_recoil_scale=2 and view_recoil_tracking=.45 are read from
 * this build's client. This is a visual basis, never a ballistic direction.
 * Use makeBasis(right,up,-forward) for a Three camera; no Euler roll guess. */
export function sourceBrowserCameraBasis(yaw:number,pitch:number,punch:SourcePunchState):SourceBrowserBasis{
  if(![yaw,pitch].every(Number.isFinite)||![punch.angle,punch.viewPunch].every(v=>v.length===3&&v.every(Number.isFinite)))throw Error('Invalid Source camera bridge input');
  const base=[f(-pitch*deg),f((yaw+Math.PI/2)*deg),0];
  const angles=base.map((v,i)=>f(f(v+f(punch.viewPunch[i]!))+f(f(f(punch.angle[i]!)*2)*f(.45))));
  return sourceAngleBasis(angles as[number,number,number]);
}
function sourceAngleBasis(angles:SourceAngles):SourceBrowserBasis{
  const [p,y,r]=angles.map(v=>f(v*rad));
  const sp=f(Math.sin(p!)),cp=f(Math.cos(p!)),sy=f(Math.sin(y!)),cy=f(Math.cos(y!)),sr=f(Math.sin(r!)),cr=f(Math.cos(r!));
  // Original AngleMatrix columns are forward/left/up. AngleVectors' right is
  // negative left. Convert each direction C(x,y,z)=(x,z,-y); no metre scaling.
  const forward:[number,number,number]=[f(cp*cy),f(cp*sy),-sp];
  const left:[number,number,number]=[f(f(f(sr*sp)*cy)-f(cr*sy)),f(f(f(sr*sp)*sy)+f(cr*cy)),f(sr*cp)];
  const up:[number,number,number]=[f(f(f(cr*sp)*cy)+f(sr*sy)),f(f(f(cr*sp)*sy)-f(sr*cy)),f(cr*cp)];
  return {forward:[forward[0],forward[2],-forward[1]],right:[-left[0],-left[2],left[1]],up:[up[0],up[2],-up[1]]};
}
