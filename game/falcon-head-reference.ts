/** Original C02 ACTION03 Idle0 bone calibration. Meters, actor forward -Z, full legal pitch. */
export type Vec3 = [number, number, number];
export type Point3 = { x: number; y: number; z: number };
const add = (a: Vec3, b: Vec3): Vec3 => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const rx = (v: Vec3,a: number): Vec3 => [v[0],v[1]*Math.cos(a)-v[2]*Math.sin(a),v[1]*Math.sin(a)+v[2]*Math.cos(a)];
const ry = (v: Vec3,a: number): Vec3 => [v[0]*Math.cos(a)+v[2]*Math.sin(a),v[1],-v[0]*Math.sin(a)+v[2]*Math.cos(a)];
const SPINE1: Vec3 = [7.519504175977103e-9,1.1684565719914994,.00856656213836247];
const SPINE2: Vec3 = [2.0493700308751617e-8,1.3212281044272172,.019688265737029996];
const HEAD_BONE: Vec3 = [2.7724071222743894e-8,1.587058380282887,-.008141723823510302];
const HEAD_ANCHOR: Vec3 = [-1.3254346023505725e-8,1.6842373307088123,-.006333916302626419];
// Mean of original Bip01_LEye / REye world positions, after body.rotation.y=PI.
const EYE_ANCHOR: Vec3 = [-9.646858933551328e-8,1.6860341745726086,-.09401088939060007];
export function falconPoseReferences(input: { yaw: number; pitch: number; blend: number; origin?: Point3 }) {
  const c = Math.max(0,Math.min(1,input.blend)), twist = -35*Math.PI/180;
  const spine2 = add(SPINE1,ry(sub(SPINE2,SPINE1),twist));
  const headBone = add(spine2,rx(ry(sub(HEAD_BONE,SPINE2),twist),-.15*c+.30*input.pitch));
  const head = add(headBone,rx(sub(HEAD_ANCHOR,HEAD_BONE),.45*input.pitch));
  const eye = add(headBone,rx(sub(EYE_ANCHOR,HEAD_BONE),.45*input.pitch));
  const pelvisShift: Vec3 = [0,(1.14-head[1])*c,.14*c];
  const origin = input.origin ?? {x:0,y:0,z:0};
  const world = (point: Vec3): Point3 => {
    const p = ry(add(point,pelvisShift),input.yaw);
    return {x:origin.x+p[0],y:origin.y+p[1],z:origin.z+p[2]};
  };
  return { head: world(head), eye: world(eye), chest: world(spine2), pelvisShift };
}
